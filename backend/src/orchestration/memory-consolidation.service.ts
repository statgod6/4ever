import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../prisma/prisma.service';
import { generateEmbedding } from './graph/utils/embeddings';
import { storeMemoryWithDedup } from './graph/utils/memory-utils';

/**
 * Memory Consolidation Engine.
 *
 * Periodically merges semantically similar memories into consolidated
 * summaries and resolves contradictions to prevent memory bloat and
 * ensure the agent's understanding stays coherent.
 */
@Injectable()
export class MemoryConsolidationService {
  private readonly logger = new Logger(MemoryConsolidationService.name);
  private openRouterApiKey: string;
  private defaultModel: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
  }

  /**
   * Main consolidation entry point.
   * Clusters semantically similar active memories, then:
   *  1. Merges clusters of 3+ into a single consolidated memory
   *  2. Detects and resolves contradictions within clusters
   */
  async consolidateMemories(userId: string): Promise<{
    clustersFound: number;
    memoriesConsolidated: number;
    contradictionsResolved: number;
  }> {
    this.logger.log(`Starting memory consolidation for user ${userId}`);

    // Fetch all active memories with embeddings
    const memories: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT m.id, m.content, m.memory_type AS "memoryType",
              m.importance_score AS "importanceScore",
              m.source_thread_id AS "sourceThreadId",
              m.source, m.created_at AS "createdAt"
       FROM memories m
       JOIN memory_embeddings me ON me.memory_id = m.id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY m.created_at ASC`,
      userId,
    );

    if (memories.length < 5) {
      this.logger.log(`Only ${memories.length} active memories — skipping consolidation`);
      return { clustersFound: 0, memoriesConsolidated: 0, contradictionsResolved: 0 };
    }

    // Build similarity clusters using pairwise cosine similarity
    const clusters = await this.buildClusters(userId, memories);
    let memoriesConsolidated = 0;
    let contradictionsResolved = 0;

    for (const cluster of clusters) {
      if (cluster.length < 3) continue;

      // 1. Check for contradictions first
      const contradictions = await this.detectContradictions(cluster);
      if (contradictions.length > 0) {
        for (const { keepId, removeIds } of contradictions) {
          for (const removeId of removeIds) {
            await this.prisma.memory.update({
              where: { id: removeId },
              data: { status: 'contradicted', supersededById: keepId },
            });
            contradictionsResolved++;
          }
        }
      }

      // 2. Get remaining active memories in this cluster
      const remaining = cluster.filter((m) =>
        !contradictions.some((c) => c.removeIds.includes(m.id)),
      );

      if (remaining.length < 3) continue;

      // 3. Consolidate cluster into one memory
      const consolidated = await this.synthesizeCluster(remaining);
      if (!consolidated) continue;

      // 4. Store the consolidated memory with dedup
      const result = await storeMemoryWithDedup(this.prisma, this.openRouterApiKey, {
        userId,
        content: consolidated.content,
        memoryType: consolidated.memoryType,
        importanceScore: Math.max(...remaining.map((m) => m.importanceScore)),
        source: 'core_chat',
        category: 'consolidated',
      });

      if (result.stored && result.memoryId) {
        // Mark old memories as consolidated
        for (const m of remaining) {
          await this.prisma.memory.update({
            where: { id: m.id },
            data: { status: 'consolidated', supersededById: result.memoryId },
          });
          memoriesConsolidated++;
        }
        this.logger.log(
          `Consolidated ${remaining.length} memories into one: "${consolidated.content.substring(0, 60)}..."`,
        );
      }
    }

    this.logger.log(
      `Consolidation complete: ${clusters.length} clusters, ${memoriesConsolidated} merged, ${contradictionsResolved} contradictions resolved`,
    );

    return {
      clustersFound: clusters.length,
      memoriesConsolidated,
      contradictionsResolved,
    };
  }

  /**
   * Clusters memories by semantic similarity (cosine > 0.80).
   * Uses a greedy approach: for each memory, find all similar memories
   * and group them. Skip memories already assigned to a cluster.
   */
  private async buildClusters(
    userId: string,
    memories: any[],
  ): Promise<any[][]> {
    const clusters: any[][] = [];
    const assigned = new Set<string>();

    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;

      // Find all memories similar to this one
      const embedding = await generateEmbedding(memory.content.substring(0, 500), this.openRouterApiKey);
      if (embedding.length === 0) continue;

      const vectorStr = `[${embedding.join(',')}]`;
      const similar: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT m.id, m.content, m.memory_type AS "memoryType",
                m.importance_score AS "importanceScore",
                m.created_at AS "createdAt",
                1 - (me.embedding <=> $1::vector) AS similarity
         FROM memories m
         JOIN memory_embeddings me ON me.memory_id = m.id
         WHERE m.user_id = $2 AND m.status = 'active' AND m.id != $3
         ORDER BY me.embedding <=> $1::vector
         LIMIT 20`,
        vectorStr,
        userId,
        memory.id,
      );

      const cluster = [memory];
      for (const s of similar) {
        if (s.similarity > 0.80 && !assigned.has(s.id)) {
          cluster.push(s);
          assigned.add(s.id);
        }
      }

      assigned.add(memory.id);
      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Uses LLM to detect contradictions within a memory cluster.
   * Returns pairs of (keepId, removeIds) for resolution.
   */
  private async detectContradictions(
    cluster: any[],
  ): Promise<Array<{ keepId: string; removeIds: string[] }>> {
    if (cluster.length < 2) return [];

    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.1,
        maxTokens: 512,
        apiKey: this.openRouterApiKey,
      });

      const memoryList = cluster
        .map((m, i) => `[${i}] (${new Date(m.createdAt).toLocaleDateString()}) ${m.content}`)
        .join('\n');

      const response = await model.invoke([
        {
          role: 'system',
          content: `You detect contradictions in a set of personal memories. Two memories contradict if they state opposite facts about the same topic (e.g., "User works at Google" vs "User just started at Meta").

For each contradiction found, specify which memory to KEEP (usually the most recent or most specific one) and which to REMOVE.

Respond with ONLY a JSON array. Each item: {"keepIndex": <number>, "removeIndices": [<number>, ...]}
If no contradictions, respond with: []`,
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
        .filter((c) => typeof c.keepIndex === 'number' && Array.isArray(c.removeIndices))
        .map((c) => ({
          keepId: cluster[c.keepIndex]?.id,
          removeIds: c.removeIndices
            .filter((i: number) => cluster[i]?.id)
            .map((i: number) => cluster[i].id),
        }))
        .filter((c) => c.keepId && c.removeIds.length > 0);
    } catch (error: any) {
      this.logger.warn(`Contradiction detection failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Uses LLM to synthesize a cluster of similar memories into one.
   */
  private async synthesizeCluster(
    cluster: any[],
  ): Promise<{ content: string; memoryType: string } | null> {
    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.2,
        maxTokens: 256,
        apiKey: this.openRouterApiKey,
      });

      const memoryList = cluster
        .map((m) => `- [${m.memoryType}] ${m.content}`)
        .join('\n');

      const response = await model.invoke([
        {
          role: 'system',
          content: `You are a memory consolidation assistant. Merge these related memories into ONE concise, comprehensive memory statement that preserves all important information. Return ONLY the merged memory text (1-3 sentences). No labels, no prefixes.`,
        },
        { role: 'user', content: `Memories to merge:\n${memoryList}` },
      ]);

      const content = typeof response.content === 'string'
        ? response.content.trim()
        : JSON.stringify(response.content).trim();

      if (!content || content.length < 10) return null;

      // Use the most common memory type in the cluster
      const typeCounts: Record<string, number> = {};
      for (const m of cluster) {
        typeCounts[m.memoryType] = (typeCounts[m.memoryType] || 0) + 1;
      }
      const memoryType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

      return { content, memoryType };
    } catch (error: any) {
      this.logger.error(`Memory synthesis failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if consolidation should be triggered based on memory count.
   * Called after each memory creation — triggers every 10th memory.
   */
  async maybeConsolidate(userId: string): Promise<void> {
    try {
      const count = await this.prisma.memory.count({
        where: { userId, status: 'active' },
      });

      if (count > 0 && count % 10 === 0) {
        this.logger.log(`Memory count hit ${count} — triggering consolidation`);
        await this.consolidateMemories(userId);
      }
    } catch (error: any) {
      this.logger.warn(`Consolidation check failed: ${error.message}`);
    }
  }
}
