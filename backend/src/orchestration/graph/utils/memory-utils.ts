import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateEmbedding } from './embeddings';

const logger = new Logger('MemoryUtils');

export interface StoreMemoryParams {
  userId: string;
  content: string;
  memoryType: string;
  importanceScore: number;
  sourceThreadId?: string | null;
  source: 'thought' | 'core_chat' | 'persona_reply' | 'manual';
  category?: string | null;
}

export interface StoreMemoryResult {
  stored: boolean;
  memoryId: string | null;
  reason?: string;
}

/**
 * Stores a memory with deduplication.
 *
 * Before creating a new memory, checks for semantically similar existing
 * memories (cosine similarity > 0.92). If a near-duplicate is found:
 *   - If the existing one has higher importance, skip (return duplicate).
 *   - If the new one is more important or more detailed, update the existing.
 * Otherwise, creates the new memory with its embedding.
 */
export async function storeMemoryWithDedup(
  prisma: PrismaService,
  openRouterApiKey: string,
  params: StoreMemoryParams,
): Promise<StoreMemoryResult> {
  const { userId, content, memoryType, importanceScore, sourceThreadId, source, category } = params;

  try {
    // 1. Generate embedding for the new memory
    const embedding = await generateEmbedding(content.substring(0, 1000), openRouterApiKey);

    if (embedding.length > 0) {
      // 2. Check for near-duplicates (cosine similarity > 0.92)
      const vectorStr = `[${embedding.join(',')}]`;
      const duplicates: any[] = await prisma.$queryRawUnsafe(
        `SELECT m.id, m.content, m.importance_score AS "importanceScore",
                1 - (me.embedding <=> $1::vector) AS similarity
         FROM memories m
         JOIN memory_embeddings me ON me.memory_id = m.id
         WHERE m.user_id = $2 AND m.status = 'active'
         ORDER BY me.embedding <=> $1::vector
         LIMIT 1`,
        vectorStr,
        userId,
      );

      if (duplicates.length > 0 && duplicates[0].similarity > 0.92) {
        const existing = duplicates[0];

        if (existing.importanceScore >= importanceScore && existing.content.length >= content.length) {
          // Existing memory is equal or better — skip
          logger.debug(`Skipped duplicate memory (similarity ${(existing.similarity * 100).toFixed(0)}%): "${content.substring(0, 50)}..."`);
          return { stored: false, memoryId: existing.id, reason: 'duplicate' };
        }

        // New memory is more important or more detailed — update the existing one
        const updateData: any = {};
        if (importanceScore > existing.importanceScore) {
          updateData.importanceScore = importanceScore;
        }
        if (content.length > existing.content.length) {
          updateData.content = content;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.memory.update({
            where: { id: existing.id },
            data: updateData,
          });

          // Re-generate embedding if content changed
          if (updateData.content) {
            const newEmbedding = await generateEmbedding(content, openRouterApiKey);
            if (newEmbedding.length > 0) {
              const newVectorStr = `[${newEmbedding.join(',')}]`;
              await prisma.$executeRawUnsafe(
                `UPDATE memory_embeddings SET embedding = $1::vector WHERE memory_id = $2`,
                newVectorStr,
                existing.id,
              );
            }
          }

          logger.debug(`Updated existing memory ${existing.id} (similarity ${(existing.similarity * 100).toFixed(0)}%)`);
        }
        return { stored: false, memoryId: existing.id, reason: 'merged' };
      }

      // 3. No duplicate — create new memory
      const memory = await prisma.memory.create({
        data: {
          userId,
          memoryType,
          content,
          importanceScore,
          sourceThreadId: sourceThreadId || null,
          source,
          category: category || null,
        },
      });

      // Store embedding
      await prisma.$executeRawUnsafe(
        `INSERT INTO memory_embeddings (id, memory_id, embedding, created_at) VALUES (gen_random_uuid(), $1, $2::vector, NOW())`,
        memory.id,
        vectorStr,
      );

      logger.debug(`Stored new memory: "${content.substring(0, 50)}..." [${memoryType}]`);
      return { stored: true, memoryId: memory.id };
    }

    // Embedding generation failed — store without dedup check
    const memory = await prisma.memory.create({
      data: {
        userId,
        memoryType,
        content,
        importanceScore,
        sourceThreadId: sourceThreadId || null,
        source,
        category: category || null,
      },
    });

    logger.warn(`Stored memory without embedding (embedding generation failed): "${content.substring(0, 50)}..."`);
    return { stored: true, memoryId: memory.id };
  } catch (error: any) {
    logger.error(`Failed to store memory: ${error.message}`);
    // Fallback: store without dedup
    try {
      const memory = await prisma.memory.create({
        data: {
          userId,
          memoryType,
          content,
          importanceScore,
          sourceThreadId: sourceThreadId || null,
          source,
          category: category || null,
        },
      });
      return { stored: true, memoryId: memory.id };
    } catch (innerErr: any) {
      logger.error(`Fallback memory storage also failed: ${innerErr.message}`);
      return { stored: false, memoryId: null, reason: 'error' };
    }
  }
}

/**
 * Fires-and-forgets access tracking for retrieved memories.
 */
export function trackMemoryAccess(prisma: PrismaService, memoryIds: string[]): void {
  if (memoryIds.length === 0) return;

  const placeholders = memoryIds.map((_, i) => `$${i + 1}`).join(', ');
  prisma.$executeRawUnsafe(
    `UPDATE memories SET last_accessed_at = NOW(), access_count = access_count + 1 WHERE id IN (${placeholders})`,
    ...memoryIds,
  ).catch((err) => {
    logger.warn(`Failed to track memory access: ${err.message}`);
  });
}

/**
 * Logs a profile field change to the audit trail.
 */
export async function logProfileChange(
  prisma: PrismaService,
  userId: string,
  field: string,
  oldValue: string | null,
  newValue: string,
  source: 'core_chat' | 'manual' | 'thought_analysis',
): Promise<void> {
  try {
    await prisma.profileChangeLog.create({
      data: { userId, field, oldValue: oldValue || null, newValue, source },
    });
  } catch (err: any) {
    logger.warn(`Failed to log profile change: ${err.message}`);
  }
}
