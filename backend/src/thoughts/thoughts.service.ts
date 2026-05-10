import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateThoughtDto } from './dto/create-thought.dto';
import { UpdateThoughtDto } from './dto/update-thought.dto';
import { generateEmbedding } from '../orchestration/graph/utils/embeddings';
import { ONTOLOGY_EVENTS } from '../ontology/events';

@Injectable()
export class ThoughtsService {
  private openRouterApiKey: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private events: EventEmitter2,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
  }

  async create(userId: string, createThoughtDto: CreateThoughtDto) {
    const thought = await this.prisma.thought.create({
      data: {
        userId,
        title: createThoughtDto.title,
        rawText: createThoughtDto.rawText,
        thoughtType: createThoughtDto.thoughtType,
        status: 'open',
      },
    });

    // Create initial thread
    const thread = await this.prisma.thoughtThread.create({
      data: {
        thoughtId: thought.id,
        threadKey: `thread-${thought.id}`,
      },
    });

    // Add initial user message
    await this.prisma.message.create({
      data: {
        threadId: thread.id,
        role: 'user',
        content: createThoughtDto.rawText,
      },
    });

    // Fire-and-forget: generate thought embedding for clustering
    this.generateThoughtEmbedding(thought.id, thought.title, thought.rawText);

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'thought.created',
      payload: { thoughtId: thought.id, thoughtType: thought.thoughtType },
    });

    return thought;
  }

  /**
   * Generate and store a vector embedding for a thought (for recurring topic detection).
   * Runs async — does not block thought creation.
   */
  private async generateThoughtEmbedding(thoughtId: string, title: string, rawText: string) {
    try {
      const text = `${title} ${rawText}`.substring(0, 8000);
      const embedding = await generateEmbedding(text, this.openRouterApiKey);
      if (embedding.length > 0) {
        const vectorStr = `[${embedding.join(',')}]`;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO thought_embeddings (id, thought_id, embedding, created_at) VALUES (gen_random_uuid(), $1, $2::vector, NOW())`,
          thoughtId,
          vectorStr,
        );
      }
    } catch (error) {
      console.error('Failed to generate thought embedding:', error);
    }
  }

  async findAll(userId: string, take = 20, skip = 0) {
    const [items, total] = await Promise.all([
      this.prisma.thought.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(take, 100),
        skip,
        include: {
          _count: { select: { threads: true } },
        },
      }),
      this.prisma.thought.count({ where: { userId } }),
    ]);

    return {
      items,
      total,
      hasMore: skip + items.length < total,
    };
  }

  async findOne(userId: string, id: string) {
    const thought = await this.prisma.thought.findFirst({
      where: { id, userId },
      include: {
        threads: {
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
            },
            runs: {
              include: {
                persona: true,
              },
              orderBy: { createdAt: 'asc' },
            },
            summary: true,
          },
        },
      },
    });

    if (!thought) {
      throw new NotFoundException('Thought not found');
    }

    return thought;
  }

  async update(userId: string, id: string, updateThoughtDto: UpdateThoughtDto) {
    const thought = await this.prisma.thought.findFirst({
      where: { id, userId },
    });

    if (!thought) {
      throw new NotFoundException('Thought not found');
    }

    return this.prisma.thought.update({
      where: { id },
      data: {
        title: updateThoughtDto.title,
        rawText: updateThoughtDto.rawText,
        thoughtType: updateThoughtDto.thoughtType,
        status: updateThoughtDto.status,
      },
    });
  }

  async remove(userId: string, id: string) {
    const thought = await this.prisma.thought.findFirst({
      where: { id, userId },
    });

    if (!thought) {
      throw new NotFoundException('Thought not found');
    }

    return this.prisma.thought.delete({
      where: { id },
    });
  }

  async continueThread(userId: string, threadId: string, content: string) {
    const thread = await this.prisma.thoughtThread.findFirst({
      where: {
        id: threadId,
        thought: {
          userId,
        },
      },
    });

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    return this.prisma.message.create({
      data: {
        threadId,
        role: 'user',
        content,
      },
    });
  }
}
