import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RelationalOntology,
  RelationalOntologySchema,
} from '../schemas/relational.schema';
import { synthesizeJson } from './llm.util';

@Injectable()
export class RelationalSynthesizer {
  private readonly logger = new Logger(RelationalSynthesizer.name);
  private apiKey: string;
  private model: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('OPENROUTER_API_KEY') || '';
    this.model =
      this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ||
      'deepseek/deepseek-v3.2';
  }

  /** Build + persist the Relational snapshot for one person. */
  async synthesize(
    userId: string,
    personId: string,
  ): Promise<RelationalOntology | null> {
    const start = Date.now();

    const person = await this.prisma.relationshipPerson.findFirst({
      where: { id: personId, userId },
    });
    if (!person) {
      this.logger.warn(
        `RelationshipPerson ${personId} not found for user ${userId}`,
      );
      return null;
    }

    const [notes, rituals, lifeEvents, tensions] = await Promise.all([
      this.prisma.relationshipNote.findMany({
        where: { personId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.prisma.relationshipRitual.findMany({
        where: { userId, personId, isActive: true },
      }),
      this.prisma.lifeEvent.findMany({
        where: { userId, personId },
        orderBy: { eventDate: 'desc' },
        take: 10,
      }),
      this.prisma.tensionEntry.findMany({
        where: { userId, personId, status: { in: ['active', 'cooling_down'] } },
        orderBy: [{ intensity: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const previous = await this.loadPrevious(userId, personId);

    // Deterministic signals
    const lastInteraction = person.lastInteractionAt;
    const daysSinceLast =
      lastInteraction
        ? Math.floor(
            (Date.now() - lastInteraction.getTime()) / (24 * 60 * 60 * 1000),
          )
        : 9999;
    const driftRiskDays = computeDriftRisk(person.relationship, daysSinceLast);

    const systemPrompt = `You synthesize the "Relational" ontology for ONE person in the user's life. Output strict JSON:
{
  "personId": string,
  "name": string,
  "relationship": string,
  "bondStrength": 0..1,
  "bondTrend": "strengthening" | "stable" | "drifting",
  "driftRiskDays": number (>=0),
  "loveLanguage": string|null,
  "recurringTopics": string[] (max 6),
  "unresolvedFriction": string[] (max 4, short phrases from tensions/notes),
  "predictedNextInteraction": string (one sentence),
  "suggestedRitual": string|null (only if none exists and one would help),
  "lastInteractionAt": ISO8601|null
}
Infer bondStrength from note frequency/sentiment, ritual adherence, unresolved tensions, and recency. Refine previous snapshot when provided.`;

    const parts: string[] = [];
    parts.push('## Person');
    parts.push(`- personId: ${person.id}`);
    parts.push(`- name: ${person.name}`);
    parts.push(`- relationship: ${person.relationship}`);
    if (person.description) parts.push(`- description: ${person.description}`);
    if (person.dynamic) parts.push(`- dynamic: ${person.dynamic}`);
    if (person.keyContext) parts.push(`- keyContext: ${person.keyContext}`);
    if (person.communicationStyle)
      parts.push(`- communicationStyle: ${person.communicationStyle}`);
    if (person.loveLanguage)
      parts.push(`- loveLanguage: ${person.loveLanguage}`);
    parts.push(
      `- lastInteractionAt: ${lastInteraction ? lastInteraction.toISOString() : 'never'}`,
    );
    parts.push(`- daysSinceLastInteraction: ${daysSinceLast}`);
    parts.push(`- interactionCount: ${person.interactionCount}`);
    parts.push(`- driftRiskDays (deterministic baseline): ${driftRiskDays}`);

    if (notes.length > 0) {
      parts.push('\n## Recent notes (newest first)');
      for (const n of notes) {
        const d = n.createdAt.toISOString().substring(0, 10);
        const s = n.sentiment ? `[${n.sentiment}]` : '';
        const t = n.topic ? `(${n.topic})` : '';
        parts.push(
          `- ${d} ${s}${t} ${n.content.substring(0, 180).replace(/\s+/g, ' ')}`,
        );
      }
    }

    if (rituals.length > 0) {
      parts.push('\n## Active rituals');
      for (const r of rituals) {
        const last = r.lastDoneAt ? r.lastDoneAt.toISOString().substring(0, 10) : 'never';
        parts.push(
          `- "${r.title}" (${r.frequency}) streak=${r.streak} lastDone=${last}`,
        );
      }
    }

    if (lifeEvents.length > 0) {
      parts.push('\n## Life events');
      for (const e of lifeEvents) {
        parts.push(
          `- ${e.eventDate.toISOString().substring(0, 10)} [${e.eventType}] ${e.title}${e.note ? ` — ${e.note}` : ''}`,
        );
      }
    }

    if (tensions.length > 0) {
      parts.push('\n## Open tensions with this person');
      for (const t of tensions) {
        parts.push(
          `- [${t.status}] intensity=${t.intensity}/10 "${t.title}" — ${t.description.substring(0, 160)}`,
        );
      }
    }

    if (previous) {
      parts.push('\n## Previous snapshot');
      parts.push(JSON.stringify(previous));
    }

    parts.push('\nProduce the Relational ontology JSON now.');

    const result = await synthesizeJson(
      this.apiKey,
      this.model,
      RelationalOntologySchema,
      systemPrompt,
      parts.join('\n'),
    );

    if (!result) {
      this.logger.warn(
        `Relational synthesis failed for ${userId}/${personId} — keeping previous`,
      );
      return previous;
    }

    // Overwrite deterministic fields with DB truth
    result.personId = person.id;
    result.name = person.name;
    result.relationship = person.relationship;
    result.loveLanguage = person.loveLanguage ?? result.loveLanguage ?? null;
    result.lastInteractionAt = lastInteraction
      ? lastInteraction.toISOString()
      : null;
    if (typeof result.driftRiskDays !== 'number' || result.driftRiskDays < 0) {
      result.driftRiskDays = driftRiskDays;
    }

    await this.persist(userId, personId, result);
    this.logger.log(
      `Relational synthesis for ${userId}/${personId} in ${Date.now() - start}ms`,
    );
    return result;
  }

  private async loadPrevious(
    userId: string,
    personId: string,
  ): Promise<RelationalOntology | null> {
    const row = await this.prisma.ontologySnapshot
      .findUnique({
        where: {
          userId_domain_scopeId: {
            userId,
            domain: 'relational',
            scopeId: personId,
          },
        },
      })
      .catch(() => null);
    if (!row) return null;
    try {
      return RelationalOntologySchema.parse(JSON.parse(row.data));
    } catch {
      return null;
    }
  }

  private async persist(
    userId: string,
    personId: string,
    data: RelationalOntology,
  ): Promise<void> {
    const now = new Date();
    const json = JSON.stringify(data);

    const pending = await this.prisma.ontologyEvent.findMany({
      where: {
        userId,
        domain: 'relational',
        scopeId: personId,
        processed: false,
      },
      select: { id: true },
    });
    const eventIds = pending.map((e) => e.id);

    await this.prisma.ontologySnapshot.upsert({
      where: {
        userId_domain_scopeId: {
          userId,
          domain: 'relational',
          scopeId: personId,
        },
      },
      create: {
        userId,
        domain: 'relational',
        scopeId: personId,
        version: 1,
        data: json,
        confidence: 0.65,
        synthesizedAt: now,
        sourceEventIds: eventIds.length > 0 ? JSON.stringify(eventIds) : null,
      },
      update: {
        data: json,
        version: { increment: 1 },
        synthesizedAt: now,
        sourceEventIds: eventIds.length > 0 ? JSON.stringify(eventIds) : null,
      },
    });

    if (eventIds.length > 0) {
      await this.prisma.ontologyEvent.updateMany({
        where: { id: { in: eventIds } },
        data: { processed: true },
      });
    }
  }
}

/**
 * Crude deterministic baseline — how many days of silence before drift risk
 * is meaningful. Close relationships drift faster.
 */
function computeDriftRisk(relationship: string, daysSinceLast: number): number {
  const rel = (relationship || '').toLowerCase();
  let threshold = 30;
  if (['partner', 'spouse'].some((k) => rel.includes(k))) threshold = 3;
  else if (['parent', 'mother', 'father', 'sibling', 'brother', 'sister'].some((k) => rel.includes(k)))
    threshold = 10;
  else if (['friend', 'best friend'].some((k) => rel.includes(k))) threshold = 14;
  else if (['colleague', 'mentor'].some((k) => rel.includes(k))) threshold = 21;
  return Math.max(0, daysSinceLast - threshold);
}
