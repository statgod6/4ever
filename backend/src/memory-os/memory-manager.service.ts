import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../prisma/prisma.service';
import { generateEmbedding } from '../orchestration/graph/utils/embeddings';

// ── Types ────────────────────────────────────────────────────────────────────

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'goal'
  | 'reflection'
  | 'relationship'
  | 'identity'
  | 'skill'
  | 'episode'
  | 'collective';

export type MemorySource = 'thought' | 'core_chat' | 'persona_reply' | 'manual' | 'system';

export interface StoreParams {
  userId: string;
  content: string;
  memoryType?: MemoryType;
  importanceScore?: number;
  sourceThreadId?: string | null;
  source?: MemorySource;
  category?: string | null;
  entities?: string[] | null;
  links?: Record<string, any> | null;
  emotion?: { valence: number; arousal: number } | null;
}

export interface StoreResult {
  stored: boolean;
  memoryId: string | null;
  reason?: string;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  memoryType: string;
  strength: number;
  confidence: number;
  importanceScore: number;
  createdAt: Date;
  source: string;
  entities: any;
  similarity?: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Memory Manager — single write/read path for the Memory OS.
 *
 * WRITE:  classify() → store() → entities extracted → embedding stored
 * READ:   retrieve() → composite ranking (similarity + strength + confidence + recency)
 * REINFORCE: reinforce() → strength bump on access
 * UPDATE: update() → content + re-embed + entity refresh
 * ARCHIVE: archive() → soft-delete with reason
 */
@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);
  private openRouterApiKey: string;
  private defaultModel: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_DEFAULT_MODEL') || 'deepseek/deepseek-v3.2';
  }

  // ── 1. CLASSIFY ──────────────────────────────────────────────────────────

  /**
   * LLM-based classification of memory type from raw content.
   * Returns the most appropriate MemoryType.
   */
  async classify(content: string): Promise<MemoryType> {
    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.1,
        maxTokens: 64,
        apiKey: this.openRouterApiKey,
      });

      const response = await model.invoke([
        {
          role: 'system',
          content: `Classify this memory into exactly ONE type. Respond with ONLY the type name, nothing else.
Types:
- episodic: a specific experience or event that happened
- semantic: a fact about the user (preference, trait, knowledge)
- procedural: a workflow or recurring process
- goal: an objective, aspiration, or target
- reflection: a learned insight or lesson
- relationship: information about a specific person/relationship
- identity: who the user is (roles, self-concept)
- skill: a capability or competence
- collective: a synthesized understanding across multiple facts`,
        },
        { role: 'user', content: `Memory: "${content.substring(0, 300)}"` },
      ]);

      const text = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content))
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, '');

      const validTypes: MemoryType[] = [
        'episodic', 'semantic', 'procedural', 'goal', 'reflection',
        'relationship', 'identity', 'skill', 'collective',
      ];

      for (const t of validTypes) {
        if (text.includes(t)) return t;
      }
      return 'semantic'; // safe default
    } catch {
      return 'semantic';
    }
  }

  // ── 2. STORE ─────────────────────────────────────────────────────────────

  /**
   * Store a memory with deduplication, entity extraction, and embedding.
   * Single write path for all memory creation.
   */
  async store(params: StoreParams): Promise<StoreResult> {
    const {
      userId, content, sourceThreadId, source = 'core_chat',
      category = null, links = null, emotion = null,
    } = params;

    // Auto-classify if type not provided
    const memoryType = params.memoryType || await this.classify(content);
    const importanceScore = params.importanceScore ?? this.defaultImportance(memoryType);

    try {
      // 1. Generate embedding
      const embedding = await generateEmbedding(content.substring(0, 1000), this.openRouterApiKey);

      if (embedding.length > 0) {
        // 2. Dedup check — cosine similarity > 0.92
        const vectorStr = `[${embedding.join(',')}]`;
        const duplicates: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT m.id, m.content, m.importance_score AS "importanceScore",
                  m.strength, m.confidence,
                  1 - (me.embedding <=> $1::vector) AS similarity
           FROM memories m
           JOIN memory_embeddings me ON me.memory_id = m.id
           WHERE m.user_id = $2 AND m.status = 'active'
           ORDER BY me.embedding <=> $1::vector
           LIMIT 1`,
          vectorStr, userId,
        );

        if (duplicates.length > 0 && duplicates[0].similarity > 0.92) {
          const existing = duplicates[0];

          if (existing.importanceScore >= importanceScore && existing.content.length >= content.length) {
            this.logger.debug(`Skipped duplicate (sim ${(existing.similarity * 100).toFixed(0)}%): "${content.substring(0, 50)}..."`);
            return { stored: false, memoryId: existing.id, reason: 'duplicate' };
          }

          // New is better — update existing
          const updateData: any = {};
          if (importanceScore > existing.importanceScore) updateData.importanceScore = importanceScore;
          if (content.length > existing.content.length) updateData.content = content;

          if (Object.keys(updateData).length > 0) {
            await this.prisma.memory.update({ where: { id: existing.id }, data: updateData });
            if (updateData.content) {
              const newEmb = await generateEmbedding(content, this.openRouterApiKey);
              if (newEmb.length > 0) {
                await this.prisma.$executeRawUnsafe(
                  `UPDATE memory_embeddings SET embedding = $1::vector WHERE memory_id = $2`,
                  `[${newEmb.join(',')}]`, existing.id,
                );
              }
            }
          }
          return { stored: false, memoryId: existing.id, reason: 'merged' };
        }

        // 3. Extract entities (fire-and-forget for non-blocking store)
        const entities = params.entities || await this.extractEntities(content);

        // 4. Create new memory
        const memory = await this.prisma.memory.create({
          data: {
            userId,
            memoryType,
            content,
            importanceScore,
            sourceThreadId: sourceThreadId || null,
            source,
            category,
            confidence: importanceScore, // initial confidence = importance
            strength: 1.0,
            lastReinforcedAt: new Date(),
            entities: entities || undefined,
            links: links || undefined,
            emotion: emotion || undefined,
          },
        });

        // 5. Store embedding
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO memory_embeddings (id, memory_id, embedding, created_at)
           VALUES (gen_random_uuid(), $1, $2::vector, NOW())`,
          memory.id, vectorStr,
        );

        this.logger.debug(`Stored [${memoryType}]: "${content.substring(0, 60)}..." (importance ${importanceScore.toFixed(2)})`);
        return { stored: true, memoryId: memory.id };
      }

      // Embedding failed — store without dedup
      const memory = await this.prisma.memory.create({
        data: {
          userId, memoryType, content, importanceScore,
          sourceThreadId: sourceThreadId || null, source, category,
          confidence: importanceScore, strength: 1.0,
          lastReinforcedAt: new Date(),
        },
      });
      this.logger.warn(`Stored without embedding: "${content.substring(0, 50)}..."`);
      return { stored: true, memoryId: memory.id };

    } catch (error: any) {
      this.logger.error(`Store failed: ${error.message}`);
      // Fallback: store bare minimum
      try {
        const memory = await this.prisma.memory.create({
          data: { userId, memoryType, content, importanceScore, source, category },
        });
        return { stored: true, memoryId: memory.id };
      } catch (innerErr: any) {
        this.logger.error(`Fallback store also failed: ${innerErr.message}`);
        return { stored: false, memoryId: null, reason: 'error' };
      }
    }
  }

  // ── 3. RETRIEVE ──────────────────────────────────────────────────────────

  /**
   * Composite ranking retrieval.
   * Ranking = 0.4*similarity + 0.25*strength + 0.15*confidence + 0.1*importance + 0.1*recency
   */
  async retrieve(
    userId: string,
    query: string,
    opts?: { limit?: number; types?: MemoryType[]; excludeIds?: string[] },
  ): Promise<RetrievedMemory[]> {
    const limit = opts?.limit || 10;
    const queryEmbedding = await generateEmbedding(query.substring(0, 1000), this.openRouterApiKey);

    if (queryEmbedding.length > 0) {
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      let whereClause = `m.user_id = $2 AND m.status = 'active'`;
      const params: any[] = [vectorStr, userId];
      let paramIdx = 3;

      if (opts?.types && opts.types.length > 0) {
        whereClause += ` AND m.memory_type = ANY($${paramIdx})`;
        params.push(opts.types);
        paramIdx++;
      }

      if (opts?.excludeIds && opts.excludeIds.length > 0) {
        whereClause += ` AND m.id != ALL($${paramIdx})`;
        params.push(opts.excludeIds);
        paramIdx++;
      }

      const results: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT m.id, m.content, m.memory_type AS "memoryType",
                m.strength, m.confidence, m.importance_score AS "importanceScore",
                m.created_at AS "createdAt", m.source, m.entities,
                1 - (me.embedding <=> $1::vector) AS similarity
         FROM memories m
         JOIN memory_embeddings me ON me.memory_id = m.id
         WHERE ${whereClause}
         ORDER BY (
           0.40 * (1 - (me.embedding <=> $1::vector))
           + 0.25 * m.strength
           + 0.15 * m.confidence
           + 0.10 * m.importance_score
           + 0.10 * GREATEST(1.0 - EXTRACT(EPOCH FROM (NOW() - m.last_accessed_at)) / 2592000.0, 0.0)
         ) DESC
         LIMIT ${paramIdx === 3 ? '$3' : `$${paramIdx}`}`,
        ...params, limit,
      );

      if (results.length > 0) {
        // Fire-and-forget reinforcement
        this.reinforce(userId, results.map(r => r.id)).catch(() => {});
        return results.map(r => ({
          id: r.id, content: r.content, memoryType: r.memoryType,
          strength: r.strength, confidence: r.confidence,
          importanceScore: r.importanceScore, createdAt: r.createdAt,
          source: r.source, entities: r.entities, similarity: r.similarity,
        }));
      }
    }

    // Fallback: importance + strength based
    const memories = await this.prisma.memory.findMany({
      where: { userId, status: 'active' },
      orderBy: [{ importanceScore: 'desc' }, { strength: 'desc' }],
      take: limit,
    });

    if (memories.length > 0) {
      this.reinforce(userId, memories.map(m => m.id)).catch(() => {});
    }

    return memories.map(m => ({
      id: m.id, content: m.content, memoryType: m.memoryType,
      strength: m.strength, confidence: m.confidence,
      importanceScore: m.importanceScore, createdAt: m.createdAt,
      source: m.source, entities: m.entities,
    }));
  }

  // ── 4. REINFORCE ─────────────────────────────────────────────────────────

  /**
   * Bump strength and confidence on access. Called automatically after retrieval.
   */
  async reinforce(userId: string, memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    try {
      const placeholders = memoryIds.map((_, i) => `$${i + 1}`).join(', ');
      await this.prisma.$executeRawUnsafe(
        `UPDATE memories SET
           last_accessed_at = NOW(),
           access_count = access_count + 1,
           last_reinforced_at = NOW(),
           strength = LEAST(strength * 1.05, 2.0),
           confidence = LEAST(confidence + 0.01, 1.0)
         WHERE id IN (${placeholders})`,
        ...memoryIds,
      );
    } catch (err: any) {
      this.logger.warn(`Reinforce failed: ${err.message}`);
    }
  }

  // ── 5. UPDATE ────────────────────────────────────────────────────────────

  /**
   * Update an existing memory's content, re-embed, and refresh entities.
   */
  async update(userId: string, query: string, newContent: string): Promise<{ updated: boolean; oldContent?: string }> {
    try {
      const embedding = await generateEmbedding(query.substring(0, 1000), this.openRouterApiKey);
      if (embedding.length === 0) return { updated: false };

      const vectorStr = `[${embedding.join(',')}]`;
      const matches: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT m.id, m.content, 1 - (me.embedding <=> $1::vector) AS similarity
         FROM memories m
         JOIN memory_embeddings me ON me.memory_id = m.id
         WHERE m.user_id = $2 AND m.status = 'active'
         ORDER BY me.embedding <=> $1::vector LIMIT 1`,
        vectorStr, userId,
      );

      if (matches.length === 0 || matches[0].similarity < 0.5) return { updated: false };

      const old = matches[0];
      const newEntities = await this.extractEntities(newContent);

      await this.prisma.memory.update({
        where: { id: old.id },
        data: { content: newContent, entities: newEntities || undefined, updatedAt: new Date() },
      });

      // Re-embed
      const newEmb = await generateEmbedding(newContent.substring(0, 1000), this.openRouterApiKey);
      if (newEmb.length > 0) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE memory_embeddings SET embedding = $1::vector WHERE memory_id = $2`,
          `[${newEmb.join(',')}]`, old.id,
        );
      }

      return { updated: true, oldContent: old.content };
    } catch (err: any) {
      this.logger.error(`Update failed: ${err.message}`);
      return { updated: false };
    }
  }

  // ── 6. ARCHIVE ───────────────────────────────────────────────────────────

  /**
   * Soft-delete a memory (status = 'archived').
   */
  async archive(userId: string, query: string): Promise<{ archived: boolean; content?: string }> {
    try {
      const embedding = await generateEmbedding(query.substring(0, 1000), this.openRouterApiKey);
      if (embedding.length === 0) return { archived: false };

      const vectorStr = `[${embedding.join(',')}]`;
      const matches: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT m.id, m.content, 1 - (me.embedding <=> $1::vector) AS similarity
         FROM memories m
         JOIN memory_embeddings me ON me.memory_id = m.id
         WHERE m.user_id = $2 AND m.status = 'active'
         ORDER BY me.embedding <=> $1::vector LIMIT 1`,
        vectorStr, userId,
      );

      if (matches.length === 0 || matches[0].similarity < 0.5) return { archived: false };

      const mem = matches[0];
      await this.prisma.memory.update({
        where: { id: mem.id },
        data: { status: 'archived' },
      });

      return { archived: true, content: mem.content };
    } catch (err: any) {
      this.logger.error(`Archive failed: ${err.message}`);
      return { archived: false };
    }
  }

  // ── 7. GET BY TYPE ───────────────────────────────────────────────────────

  /**
   * Fetch memories of a specific type, sorted by importance.
   * Used by Context Builder for always-inject layers.
   */
  async getByType(
    userId: string,
    type: MemoryType,
    opts?: { limit?: number; minStrength?: number },
  ): Promise<RetrievedMemory[]> {
    const limit = opts?.limit || 10;
    const minStrength = opts?.minStrength || 0;

    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        status: 'active',
        memoryType: type,
        strength: { gte: minStrength },
      },
      orderBy: [{ importanceScore: 'desc' }, { strength: 'desc' }],
      take: limit,
    });

    return memories.map(m => ({
      id: m.id, content: m.content, memoryType: m.memoryType,
      strength: m.strength, confidence: m.confidence,
      importanceScore: m.importanceScore, createdAt: m.createdAt,
      source: m.source, entities: m.entities,
    }));
  }

  // ── 8. COUNT ─────────────────────────────────────────────────────────────

  async countActive(userId: string): Promise<number> {
    return this.prisma.memory.count({ where: { userId, status: 'active' } });
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────

  private defaultImportance(type: MemoryType): number {
    const defaults: Record<MemoryType, number> = {
      goal: 0.85, identity: 0.80, relationship: 0.70,
      episodic: 0.60, semantic: 0.55, procedural: 0.65,
      reflection: 0.60, skill: 0.55, episode: 0.50,
      collective: 0.75,
    };
    return defaults[type] || 0.5;
  }

  /**
   * Extract named entities from memory content using LLM.
   * Returns array of entity strings or null.
   */
  private async extractEntities(content: string): Promise<string[] | null> {
    try {
      const model = new ChatOpenRouter({
        model: this.defaultModel,
        temperature: 0.1,
        maxTokens: 128,
        apiKey: this.openRouterApiKey,
      });

      const response = await model.invoke([
        {
          role: 'system',
          content: 'Extract key named entities (people, places, organizations, concepts) from this text. Return ONLY a JSON array of strings. If no entities, return [].',
        },
        { role: 'user', content: content.substring(0, 300) },
      ]);

      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed.filter((e: any) => typeof e === 'string') : null;
    } catch {
      return null;
    }
  }
}
