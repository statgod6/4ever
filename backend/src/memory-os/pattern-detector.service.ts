import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryManagerService } from './memory-manager.service';
import { generateEmbedding } from '../orchestration/graph/utils/embeddings';

/**
 * Pattern Detector — discovers recurring behavioral patterns from memories.
 *
 * Triggered after every 20 new memories (similar to consolidation).
 * Uses LLM to identify trends, habits, and behavioral patterns.
 * Deactivates patterns with no supporting evidence in last 60 days.
 */
@Injectable()
export class PatternDetectorService {
  private readonly logger = new Logger(PatternDetectorService.name);
  private openRouterApiKey: string;
  private defaultModel: string;

  // Trigger pattern detection every N new memories
  private readonly TRIGGER_EVERY = 20;

  // Minimum similarity to consider a pattern as duplicate
  private readonly DUPLICATE_THRESHOLD = 0.85;

  // Deactivate patterns with no new evidence in N days
  private readonly STALE_DAYS = 60;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private memoryManager: MemoryManagerService,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
  }

  /**
   * Check if pattern detection should run based on memory count.
   * Called after each memory store operation.
   */
  async maybeDetectPatterns(userId: string): Promise<void> {
    try {
      const count = await this.memoryManager.countActive(userId);
      if (count > 0 && count % this.TRIGGER_EVERY === 0) {
        this.logger.log(`Memory count hit ${count} — triggering pattern detection`);
        await this.detectPatterns(userId);
      }
    } catch (error: any) {
      this.logger.warn(`Pattern detection check failed: ${error.message}`);
    }
  }

  /**
   * Main pattern detection:
   * 1. Fetch last 50 memories across all types
   * 2. Send to LLM for pattern identification
   * 3. Create new patterns or update existing ones
   * 4. Deactivate stale patterns
   */
  async detectPatterns(userId: string): Promise<{
    patternsFound: number;
    patternsUpdated: number;
    patternsDeactivated: number;
  }> {
    this.logger.log(`Starting pattern detection for user ${userId}`);

    try {
      // Fetch recent memories
      const memories = await this.prisma.memory.findMany({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, content: true, memoryType: true, createdAt: true },
      });

      if (memories.length < 5) {
        return { patternsFound: 0, patternsUpdated: 0, patternsDeactivated: 0 };
      }

      // LLM pattern discovery
      const discovered = await this.discoverPatterns(memories);

      let patternsFound = 0;
      let patternsUpdated = 0;

      for (const pattern of discovered) {
        const result = await this.storeOrUpdatePattern(userId, pattern, memories);
        if (result === 'created') patternsFound++;
        else if (result === 'updated') patternsUpdated++;
      }

      // Deactivate stale patterns
      const patternsDeactivated = await this.deactivateStalePatterns(userId);

      this.logger.log(
        `Pattern detection complete: ${patternsFound} found, ${patternsUpdated} updated, ${patternsDeactivated} deactivated`,
      );

      return { patternsFound, patternsUpdated, patternsDeactivated };
    } catch (error: any) {
      this.logger.error(`Pattern detection failed: ${error.message}`);
      return { patternsFound: 0, patternsUpdated: 0, patternsDeactivated: 0 };
    }
  }

  /**
   * Use LLM to identify behavioral patterns from recent memories.
   */
  private async discoverPatterns(
    memories: Array<{ id: string; content: string; memoryType: string; createdAt: Date }>,
  ): Promise<Array<{ pattern: string; evidenceIds: string[] }>> {
    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.2,
        maxTokens: 512,
        apiKey: this.openRouterApiKey,
      });

      const memoryList = memories
        .map((m, i) => `[${i}] (${m.memoryType}, ${new Date(m.createdAt).toLocaleDateString()}) ${m.content.substring(0, 120)}`)
        .join('\n');

      const response = await model.invoke([
        {
          role: 'system',
          content: `You are a behavioral pattern analyst. Examine these personal memories and identify recurring behavioral patterns, habits, preferences, or trends.

For each pattern, provide:
- A concise description (1 sentence)
- The indices of memories that support this pattern

Only identify patterns that have at least 2 supporting memories. Be specific and actionable.

Respond with ONLY a JSON array. Each item: {"pattern": "description", "evidenceIndices": [0, 3, 7]}
If no patterns found, respond with: []`,
        },
        { role: 'user', content: `Memories:\n${memoryList}` },
      ]);

      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      let parsed: any[];
      try {
        parsed = JSON.parse(text);
      } catch {
        const match = text.match(/\[[\s\S]*\]/);
        parsed = match ? JSON.parse(match[0]) : [];
      }

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(p => typeof p.pattern === 'string' && Array.isArray(p.evidenceIndices))
        .map(p => ({
          pattern: p.pattern,
          evidenceIds: p.evidenceIndices
            .filter((i: number) => memories[i] !== undefined)
            .map((i: number) => memories[i].id),
        }))
        .filter(p => p.pattern.length > 10 && p.evidenceIds.length >= 2);
    } catch (error: any) {
      this.logger.error(`Pattern discovery LLM call failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Store a new pattern or update existing one if similar.
   */
  private async storeOrUpdatePattern(
    userId: string,
    pattern: { pattern: string; evidenceIds: string[] },
    memories: Array<{ id: string }>,
  ): Promise<'created' | 'updated' | 'skipped'> {
    try {
      // Check for existing similar pattern using embedding similarity
      const embedding = await generateEmbedding(pattern.pattern.substring(0, 500), this.openRouterApiKey);

      if (embedding.length > 0) {
        const vectorStr = `[${embedding.join(',')}]`;

        // Check existing active patterns for duplicates
        const existingPatterns = await this.prisma.memoryPattern.findMany({
          where: { userId, isActive: true },
        });

        for (const existing of existingPatterns) {
          // Simple text similarity check (avoid expensive embedding for each pattern)
          const similarity = this.textSimilarity(pattern.pattern, existing.pattern);
          if (similarity > this.DUPLICATE_THRESHOLD) {
            // Update existing pattern — add new evidence, bump confidence
            const existingEvidence = Array.isArray(existing.evidence) ? existing.evidence as string[] : [];
            const newEvidence = [...new Set([...existingEvidence, ...pattern.evidenceIds])];
            const newConfidence = Math.min(
              existing.confidence + (0.05 * pattern.evidenceIds.length),
              1.0,
            );

            await this.prisma.memoryPattern.update({
              where: { id: existing.id },
              data: {
                evidence: newEvidence,
                confidence: newConfidence,
              },
            });

            return 'updated';
          }
        }
      }

      // Create new pattern
      await this.prisma.memoryPattern.create({
        data: {
          userId,
          pattern: pattern.pattern,
          evidence: pattern.evidenceIds,
          confidence: Math.min(0.3 + (0.1 * pattern.evidenceIds.length), 1.0),
        },
      });

      return 'created';
    } catch (error: any) {
      this.logger.warn(`Pattern store/update failed: ${error.message}`);
      return 'skipped';
    }
  }

  /**
   * Deactivate patterns with no supporting evidence in the last 60 days.
   */
  private async deactivateStalePatterns(userId: string): Promise<number> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.STALE_DAYS);

      const activePatterns = await this.prisma.memoryPattern.findMany({
        where: { userId, isActive: true },
      });

      let deactivated = 0;

      for (const pattern of activePatterns) {
        const evidenceIds = Array.isArray(pattern.evidence) ? pattern.evidence as string[] : [];
        if (evidenceIds.length === 0) continue;

        // Check if any evidence memory was created recently
        const recentEvidence = await this.prisma.memory.count({
          where: {
            id: { in: evidenceIds },
            createdAt: { gte: cutoff },
          },
        });

        if (recentEvidence === 0) {
          await this.prisma.memoryPattern.update({
            where: { id: pattern.id },
            data: { isActive: false },
          });
          deactivated++;
        }
      }

      return deactivated;
    } catch (error: any) {
      this.logger.error(`Stale pattern deactivation failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Simple text similarity using Jaccard coefficient on word sets.
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}
