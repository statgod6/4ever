import { PrismaService } from '../../../prisma/prisma.service';
import { ThoughtAnalysisStateType } from '../state';
import { generateEmbedding } from '../utils/embeddings';
import { trackMemoryAccess } from '../utils/memory-utils';

/**
 * Node: retrieve_memory
 * Fetches relevant long-term memories using semantic vector similarity search.
 * Falls back to importance-based retrieval if embeddings fail.
 */
export function createRetrieveMemoryNode(
  prisma: PrismaService,
  openRouterApiKey: string,
) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    // Build a search query from the current thought
    const searchText = `${state.thought.title} ${state.thought.rawText}`.substring(0, 1000);

    try {
      // Generate embedding for the current thought
      const queryEmbedding = await generateEmbedding(searchText, openRouterApiKey);

      if (queryEmbedding.length > 0) {
        // Composite ranking: similarity + importance + frequency + recency
        const vectorStr = `[${queryEmbedding.join(',')}]`;
        const results: any[] = await prisma.$queryRawUnsafe(
          `SELECT m.id, m.user_id AS "userId", m.memory_type AS "memoryType", m.content,
                  m.importance_score AS "importanceScore", m.source_thread_id AS "sourceThreadId",
                  m.created_at AS "createdAt", m.source,
                  1 - (me.embedding <=> $1::vector) AS similarity
           FROM memories m
           JOIN memory_embeddings me ON me.memory_id = m.id
           WHERE m.user_id = $2 AND m.status = 'active'
           ORDER BY (
             0.6 * (1 - (me.embedding <=> $1::vector))
             + 0.2 * m.importance_score
             + 0.1 * LEAST(m.access_count::float / 10.0, 1.0)
             + 0.1 * GREATEST(1.0 - EXTRACT(EPOCH FROM (NOW() - m.last_accessed_at)) / 2592000.0, 0.0)
           ) DESC
           LIMIT 10`,
          vectorStr,
          state.userId,
        );

        if (results.length > 0) {
          // Fire-and-forget access tracking
          trackMemoryAccess(prisma, results.map((r) => r.id));
          return { memories: results };
        }
      }
    } catch (error) {
      console.warn('Semantic memory search failed, falling back to importance-based:', error);
    }

    // Fallback: importance-based retrieval (original behavior)
    const memories = await prisma.memory.findMany({
      where: { userId: state.userId, status: 'active' },
      orderBy: [
        { importanceScore: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 10,
    });

    if (memories.length > 0) {
      trackMemoryAccess(prisma, memories.map((m) => m.id));
    }

    return { memories };
  };
}
