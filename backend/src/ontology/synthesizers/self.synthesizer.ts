import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SelfOntology, SelfOntologySchema } from '../schemas/self.schema';
import { synthesizeJson } from './llm.util';

@Injectable()
export class SelfSynthesizer {
  private readonly logger = new Logger(SelfSynthesizer.name);
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

  /** Build + persist the Self snapshot for a user. */
  async synthesize(userId: string): Promise<SelfOntology | null> {
    const start = Date.now();

    const [userContext, recentThoughts, recentInsights, recentMemories] =
      await Promise.all([
        this.prisma.userContext.findUnique({ where: { userId } }),
        this.prisma.thought.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: {
            title: true,
            rawText: true,
            thoughtType: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.insightReport.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { title: true, content: true, createdAt: true },
        }),
        this.prisma.memory.findMany({
          where: { userId, status: 'active' },
          orderBy: { importanceScore: 'desc' },
          take: 20,
          select: { memoryType: true, content: true, importanceScore: true },
        }),
      ]);

    const previous = await this.loadPrevious(userId);

    const systemPrompt = `You synthesize a stable "Self" ontology for a user — who they are, what they value, where they're going. Output strict JSON:
{
  "identity": { "displayName": string|null, "role": string|null, "background": string|null, "situation": string|null },
  "values": string[] (top 3-5 inferred values),
  "traits": Array<{ "trait": string, "confidence": 0..1 }> (max 8),
  "activeGoals": Array<{ "title": string, "horizon": string|null, "confidence": 0..1 }> (max 6),
  "pendingDecisions": string[] (max 6),
  "oneLineTrajectory": string (one sentence: what phase they're in and where they're heading),
  "lastReviewedAt": ISO8601
}
Only use what the evidence supports. Prefer low confidence over fabrication. Refine previous snapshot when provided.`;

    const parts: string[] = [];
    if (userContext) {
      parts.push('## Self-reported context');
      if (userContext.name) parts.push(`- Name: ${userContext.name}`);
      if (userContext.role) parts.push(`- Role: ${userContext.role}`);
      if (userContext.background)
        parts.push(`- Background: ${userContext.background}`);
      if (userContext.situation)
        parts.push(`- Situation: ${userContext.situation}`);
      if (userContext.goals) parts.push(`- Goals: ${userContext.goals}`);
      if (userContext.values) parts.push(`- Values: ${userContext.values}`);
      if (userContext.currentProjects)
        parts.push(`- Current projects: ${userContext.currentProjects}`);
      if (userContext.pendingDecisions)
        parts.push(`- Pending decisions: ${userContext.pendingDecisions}`);
      if (userContext.freeformContext)
        parts.push(`- Freeform: ${userContext.freeformContext}`);
    }

    if (recentThoughts.length > 0) {
      parts.push('\n## Recent thoughts (newest first)');
      for (const t of recentThoughts) {
        const date = t.createdAt.toISOString().substring(0, 10);
        const text = t.rawText.substring(0, 200).replace(/\s+/g, ' ');
        parts.push(
          `- [${t.thoughtType}/${t.status}] ${date} "${t.title}" — ${text}`,
        );
      }
    }

    if (recentInsights.length > 0) {
      parts.push('\n## Recent insights');
      for (const i of recentInsights) {
        parts.push(
          `- ${i.title}: ${i.content.substring(0, 300).replace(/\s+/g, ' ')}`,
        );
      }
    }

    if (recentMemories.length > 0) {
      parts.push('\n## Top active memories');
      for (const m of recentMemories) {
        parts.push(
          `- (${m.memoryType}, importance=${m.importanceScore.toFixed(2)}) ${m.content.substring(0, 200)}`,
        );
      }
    }

    if (previous) {
      parts.push('\n## Previous Self snapshot (refine, do not wholesale replace)');
      parts.push(JSON.stringify(previous));
    }

    parts.push('\nProduce the Self ontology JSON now.');

    const result = await synthesizeJson(
      this.apiKey,
      this.model,
      SelfOntologySchema,
      systemPrompt,
      parts.join('\n'),
    );

    if (!result) {
      this.logger.warn(
        `Self synthesis failed for user ${userId} — keeping previous`,
      );
      return previous;
    }

    // Ensure identity.displayName falls back to user context name if LLM dropped it.
    if (!result.identity.displayName && userContext?.name) {
      result.identity.displayName = userContext.name;
    }
    result.lastReviewedAt = new Date().toISOString();

    await this.persist(userId, result);
    this.logger.log(
      `Self synthesis for user ${userId} in ${Date.now() - start}ms`,
    );
    return result;
  }

  private async loadPrevious(userId: string): Promise<SelfOntology | null> {
    const row = await this.prisma.ontologySnapshot
      .findUnique({
        where: {
          userId_domain_scopeId: { userId, domain: 'self', scopeId: '' },
        },
      })
      .catch(() => null);
    if (!row) return null;
    try {
      return SelfOntologySchema.parse(JSON.parse(row.data));
    } catch {
      return null;
    }
  }

  private async persist(userId: string, data: SelfOntology): Promise<void> {
    const now = new Date();
    const json = JSON.stringify(data);

    const pending = await this.prisma.ontologyEvent.findMany({
      where: { userId, domain: 'self', processed: false },
      select: { id: true },
    });
    const eventIds = pending.map((e) => e.id);

    await this.prisma.ontologySnapshot.upsert({
      where: {
        userId_domain_scopeId: { userId, domain: 'self', scopeId: '' },
      },
      create: {
        userId,
        domain: 'self',
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
