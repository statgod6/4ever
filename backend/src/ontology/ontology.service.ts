import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SelfOntology } from './schemas/self.schema';
import { RelationalOntology } from './schemas/relational.schema';
import { EmotionalOntology } from './schemas/emotional.schema';
import { OntologyDomain } from './events';

export interface ComposedOntology {
  self: SelfOntology | null;
  emotional: EmotionalOntology | null;
  relational: RelationalOntology[];
  staleness: { self: boolean; emotional: boolean; relational: boolean };
  lastSynthesizedAt: {
    self: string | null;
    emotional: string | null;
  };
}

/**
 * Public read API for ontology snapshots. Consumers (Core Chat, Personas,
 * Home endpoint) call this instead of touching ontology_snapshots directly.
 */
@Injectable()
export class OntologyService {
  private readonly logger = new Logger(OntologyService.name);
  private readonly STALE_MS = 24 * 60 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  async getSelf(userId: string): Promise<SelfOntology | null> {
    const row = await this.prisma.ontologySnapshot
      .findUnique({
        where: { userId_domain_scopeId: { userId, domain: 'self', scopeId: '' } },
      })
      .catch(() => null);
    if (!row) return null;
    try {
      // Skip Zod validation on read path — data is trusted (written by us).
      return JSON.parse(row.data) as SelfOntology;
    } catch {
      return null;
    }
  }

  async getEmotional(userId: string): Promise<EmotionalOntology | null> {
    const row = await this.prisma.ontologySnapshot
      .findUnique({
        where: {
          userId_domain_scopeId: { userId, domain: 'emotional', scopeId: '' },
        },
      })
      .catch(() => null);
    if (!row) return null;
    try {
      return JSON.parse(row.data) as EmotionalOntology;
    } catch {
      return null;
    }
  }

  /**
   * Return relational snapshots for a user. If personIds supplied, only those.
   * Otherwise returns the top N by lastInteractionAt (from the snapshot data).
   */
  async getRelational(
    userId: string,
    options?: { personIds?: string[]; limit?: number },
  ): Promise<RelationalOntology[]> {
    const where: any = { userId, domain: 'relational' };
    if (options?.personIds && options.personIds.length > 0) {
      where.scopeId = { in: options.personIds };
    }
    const rows = await this.prisma.ontologySnapshot
      .findMany({
        where,
        orderBy: { synthesizedAt: 'desc' },
        take: options?.limit ?? 8,
      })
      .catch(() => []);

    const result: RelationalOntology[] = [];
    for (const r of rows) {
      try {
        result.push(JSON.parse(r.data) as RelationalOntology);
      } catch {
        // skip corrupted snapshot
      }
    }
    return result;
  }

  /** Combined view used by Core Chat + Home endpoint. */
  async compose(
    userId: string,
    opts?: { relationalPersonIds?: string[]; relationalLimit?: number },
  ): Promise<ComposedOntology> {
    const [self, emotional, relationalAll, selfRow, emoRow] = await Promise.all([
      this.getSelf(userId),
      this.getEmotional(userId),
      this.getRelational(userId, {
        personIds: opts?.relationalPersonIds,
        limit: opts?.relationalLimit ?? 5,
      }),
      this.prisma.ontologySnapshot
        .findUnique({
          where: { userId_domain_scopeId: { userId, domain: 'self', scopeId: '' } },
          select: { synthesizedAt: true },
        })
        .catch(() => null),
      this.prisma.ontologySnapshot
        .findUnique({
          where: {
            userId_domain_scopeId: { userId, domain: 'emotional', scopeId: '' },
          },
          select: { synthesizedAt: true },
        })
        .catch(() => null),
    ]);

    const now = Date.now();
    return {
      self,
      emotional,
      relational: relationalAll,
      staleness: {
        self:
          !selfRow ||
          now - selfRow.synthesizedAt.getTime() > this.STALE_MS,
        emotional:
          !emoRow ||
          now - emoRow.synthesizedAt.getTime() > this.STALE_MS,
        relational: relationalAll.length === 0,
      },
      lastSynthesizedAt: {
        self: selfRow?.synthesizedAt.toISOString() ?? null,
        emotional: emoRow?.synthesizedAt.toISOString() ?? null,
      },
    };
  }

  /** Format a ComposedOntology into labeled prompt blocks for LLM context. */
  formatForPrompt(composed: ComposedOntology): string[] {
    const blocks: string[] = [];

    if (composed.self) {
      const s = composed.self;
      const parts: string[] = [];
      if (s.identity.displayName) parts.push(`Name: ${s.identity.displayName}`);
      if (s.identity.role) parts.push(`Role: ${s.identity.role}`);
      if (s.identity.situation) parts.push(`Situation: ${s.identity.situation}`);
      if (s.identity.background) parts.push(`Background: ${s.identity.background}`);
      if (s.values.length) parts.push(`Values: ${s.values.join(', ')}`);
      if (s.traits.length)
        parts.push(
          `Traits: ${s.traits.map((t) => `${t.trait} (${t.confidence.toFixed(2)})`).join(', ')}`,
        );
      if (s.activeGoals.length)
        parts.push(
          `Active goals: ${s.activeGoals.map((g) => g.title).join('; ')}`,
        );
      if (s.pendingDecisions.length)
        parts.push(`Pending decisions: ${s.pendingDecisions.join('; ')}`);
      if (s.oneLineTrajectory)
        parts.push(`Trajectory: ${s.oneLineTrajectory}`);
      if (parts.length > 0) blocks.push(`--- Self ---\n${parts.join('\n')}`);
    }

    if (composed.emotional) {
      const e = composed.emotional;
      const parts: string[] = [];
      parts.push(`Current weather: ${e.currentWeather}`);
      parts.push(`Mood trend 7d: ${e.moodTrend7d}`);
      parts.push(`Energy trend 7d: ${e.energyTrend7d}`);
      if (e.activeTensions.length > 0) {
        parts.push(
          `Active tensions:\n` +
            e.activeTensions
              .map(
                (t) =>
                  `  - "${t.title}" (intensity ${t.intensity}/10${t.personName ? `, with ${t.personName}` : ''})`,
              )
              .join('\n'),
        );
      }
      if (e.cooldownsExpiring.length > 0) {
        parts.push(
          `Cooldowns expiring:\n` +
            e.cooldownsExpiring
              .map((c) => `  - "${c.title}" at ${c.expiresAt}`)
              .join('\n'),
        );
      }
      if (e.dominantTheme) parts.push(`Dominant theme: ${e.dominantTheme}`);
      if (e.recommendedFocus)
        parts.push(`Recommended focus: ${e.recommendedFocus}`);
      blocks.push(`--- Emotional State ---\n${parts.join('\n')}`);
    }

    if (composed.relational.length > 0) {
      const lines = composed.relational.map((r) => {
        const trend = r.bondTrend;
        const topics = r.recurringTopics.slice(0, 3).join(', ');
        const friction = r.unresolvedFriction.slice(0, 2).join('; ');
        const base = `- ${r.name} [${r.relationship}] bond=${r.bondStrength.toFixed(2)} trend=${trend}`;
        const details: string[] = [];
        if (topics) details.push(`topics: ${topics}`);
        if (friction) details.push(`friction: ${friction}`);
        if (r.predictedNextInteraction)
          details.push(`next: ${r.predictedNextInteraction}`);
        if (r.suggestedRitual) details.push(`ritual: ${r.suggestedRitual}`);
        return details.length > 0 ? `${base}\n    ${details.join(' | ')}` : base;
      });
      blocks.push(
        `--- Relationships (Top ${composed.relational.length}) ---\n${lines.join('\n')}`,
      );
    }

    return blocks;
  }

  /** Compact snapshot for Home screen card. */
  async getHomeSnapshot(userId: string): Promise<any> {
    const composed = await this.compose(userId, { relationalLimit: 8 });
    const drifting = composed.relational.filter((r) => r.bondTrend === 'drifting');

    const topPeople = [...composed.relational]
      .sort((a, b) => b.bondStrength - a.bondStrength)
      .slice(0, 3)
      .map((r) => ({
        personId: r.personId,
        name: r.name,
        bondStrength: r.bondStrength,
        bondTrend: r.bondTrend,
        driftRiskDays: r.driftRiskDays,
        suggestedRitual: r.suggestedRitual ?? null,
      }));

    const identity = composed.self
      ? {
          displayName: composed.self.identity.displayName ?? null,
          role: composed.self.identity.role ?? null,
          situation: composed.self.identity.situation ?? null,
        }
      : null;

    const activeGoals = (composed.self?.activeGoals || []).map((g) => ({
      title: g.title,
      horizon: g.horizon ?? null,
    }));

    return {
      trajectory: composed.self?.oneLineTrajectory || '',
      weather: composed.emotional?.currentWeather || 'calm',
      moodTrend: composed.emotional?.moodTrend7d || 'stable',
      energyTrend: composed.emotional?.energyTrend7d || 'stable',
      dominantTheme: composed.emotional?.dominantTheme ?? null,
      recommendedFocus: composed.emotional?.recommendedFocus || '',
      topTensions: composed.emotional?.activeTensions.slice(0, 3) || [],
      driftingPeople: drifting.slice(0, 3).map((r) => ({
        personId: r.personId,
        name: r.name,
        relationship: r.relationship,
      })),
      topPeople,
      identity,
      activeGoals,
      staleness: composed.staleness,
      lastSynthesizedAt: composed.lastSynthesizedAt,
    };
  }
}
