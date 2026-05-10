import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EmotionalOntology,
  EmotionalOntologySchema,
} from '../schemas/emotional.schema';
import { synthesizeJson } from './llm.util';

@Injectable()
export class EmotionalSynthesizer {
  private readonly logger = new Logger(EmotionalSynthesizer.name);
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

  async synthesize(userId: string): Promise<EmotionalOntology | null> {
    const start = Date.now();

    const since7 = new Date();
    since7.setDate(since7.getDate() - 7);
    const since7Date = new Date(
      Date.UTC(since7.getFullYear(), since7.getMonth(), since7.getDate()),
    );

    const [checkIns, activeTensions, coolingTensions] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: { userId, date: { gte: since7Date } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.tensionEntry.findMany({
        where: { userId, status: 'active' },
        orderBy: [{ intensity: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        include: { person: { select: { name: true } } },
      }),
      this.prisma.tensionEntry.findMany({
        where: { userId, status: 'cooling_down' },
        orderBy: { coolDownUntil: 'asc' },
        take: 10,
      }),
    ]);

    const previous = await this.loadPrevious(userId);

    // Deterministic pre-computation to guide the LLM.
    const moodAvg = avg(checkIns.map((c) => c.mood));
    const energyAvg = avg(checkIns.map((c) => c.energy));
    const moodTrend = trend(checkIns.map((c) => c.mood));
    const energyTrend = trend(checkIns.map((c) => c.energy));

    const systemPrompt = `You are synthesizing the user's current "Emotional" ontology. Output strict JSON:
{
  "currentWeather": "calm" | "pressured" | "low" | "elevated" | "turbulent",
  "moodTrend7d": "improving" | "stable" | "declining",
  "energyTrend7d": "improving" | "stable" | "declining",
  "activeTensions": Array<{ "id": string, "title": string, "intensity": 1..10, "personName": string|null }> (max 10),
  "cooldownsExpiring": Array<{ "id": string, "title": string, "expiresAt": ISO8601 }> (max 10),
  "dominantTheme": string|null (e.g. "overwork guilt", "grief", "optimism"),
  "recommendedFocus": string (one actionable, compassionate line)
}
Use only provided facts. currentWeather must reflect tension intensity, mood, and energy together.`;

    const parts: string[] = [];
    parts.push(
      `## Trends (7d)\nmood avg=${moodAvg}/5 trend=${moodTrend}\nenergy avg=${energyAvg}/5 trend=${energyTrend}`,
    );
    if (checkIns.length > 0) {
      parts.push('\n## Check-ins');
      for (const c of checkIns) {
        const d = c.date.toISOString().substring(0, 10);
        const note = c.note ? ` — "${c.note}"` : '';
        parts.push(`- ${d}: mood ${c.mood}/5, energy ${c.energy}/5${note}`);
      }
    }
    if (activeTensions.length > 0) {
      parts.push('\n## Active tensions');
      for (const t of activeTensions) {
        const person = (t as any).person ? ` with ${(t as any).person.name}` : '';
        parts.push(
          `- id=${t.id} intensity=${t.intensity}/10 "${t.title}"${person} — ${String(t.description).substring(0, 120)}`,
        );
      }
    }
    if (coolingTensions.length > 0) {
      parts.push('\n## Cooling-down tensions');
      for (const t of coolingTensions) {
        parts.push(
          `- id=${t.id} "${t.title}" expiresAt=${t.coolDownUntil?.toISOString() || 'n/a'}`,
        );
      }
    }
    if (previous) {
      parts.push('\n## Previous snapshot (refine, do not wholesale replace)');
      parts.push(JSON.stringify(previous));
    }
    parts.push('\nProduce the Emotional ontology JSON now.');

    const result = await synthesizeJson(
      this.apiKey,
      this.model,
      EmotionalOntologySchema,
      systemPrompt,
      parts.join('\n'),
    );

    if (!result) {
      this.logger.warn(
        `Emotional synthesis failed for user ${userId} — keeping previous`,
      );
      return previous;
    }

    // Overwrite deterministic fields with DB truth
    result.activeTensions = activeTensions.map((t) => ({
      id: t.id,
      title: t.title,
      intensity: t.intensity,
      personName: (t as any).person?.name ?? null,
    }));
    result.cooldownsExpiring = coolingTensions
      .filter((t) => t.coolDownUntil)
      .map((t) => ({
        id: t.id,
        title: t.title,
        expiresAt: t.coolDownUntil!.toISOString(),
      }));
    result.moodTrend7d = moodTrend;
    result.energyTrend7d = energyTrend;

    await this.persist(userId, result);
    this.logger.log(
      `Emotional synthesis for user ${userId} in ${Date.now() - start}ms`,
    );
    return result;
  }

  private async loadPrevious(userId: string): Promise<EmotionalOntology | null> {
    const row = await this.prisma.ontologySnapshot
      .findUnique({
        where: {
          userId_domain_scopeId: { userId, domain: 'emotional', scopeId: '' },
        },
      })
      .catch(() => null);
    if (!row) return null;
    try {
      return EmotionalOntologySchema.parse(JSON.parse(row.data));
    } catch {
      return null;
    }
  }

  private async persist(
    userId: string,
    data: EmotionalOntology,
  ): Promise<void> {
    const now = new Date();
    const json = JSON.stringify(data);

    const pending = await this.prisma.ontologyEvent.findMany({
      where: { userId, domain: 'emotional', processed: false },
      select: { id: true },
    });
    const eventIds = pending.map((e) => e.id);

    await this.prisma.ontologySnapshot.upsert({
      where: {
        userId_domain_scopeId: { userId, domain: 'emotional', scopeId: '' },
      },
      create: {
        userId,
        domain: 'emotional',
        scopeId: '',
        version: 1,
        data: json,
        confidence: 0.7,
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

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

function trend(xs: number[]): 'improving' | 'stable' | 'declining' {
  // xs is ordered newest-first. Compare first half (recent) vs second half (older).
  if (xs.length < 3) return 'stable';
  const mid = Math.floor(xs.length / 2);
  const recent = xs.slice(0, mid);
  const older = xs.slice(mid);
  const rAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const oAvg = older.reduce((a, b) => a + b, 0) / older.length;
  if (rAvg - oAvg > 0.4) return 'improving';
  if (oAvg - rAvg > 0.4) return 'declining';
  return 'stable';
}
