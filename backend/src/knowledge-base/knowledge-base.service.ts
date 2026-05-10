import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { generateEmbedding } from '../orchestration/graph/utils/embeddings';
import { ONTOLOGY_EVENTS } from '../ontology/events';
import * as pdfParseModule from 'pdf-parse';

const { PDFParse } = pdfParseModule as any;

@Injectable()
export class KnowledgeBaseService {
  private openRouterApiKey: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private events: EventEmitter2,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY')!;
  }

  /**
   * Upload a PDF document, parse it, chunk the text, embed each chunk,
   * and store everything in the database.
   */
  async uploadDocument(
    userId: string,
    personaId: string,
    file: Express.Multer.File,
  ) {
    // Validate persona ownership
    const persona = await this.prisma.persona.findFirst({
      where: { id: personaId, userId },
    });
    if (!persona) throw new NotFoundException('Persona not found');

    // Limit: 1 document per persona
    const existingCount = await this.prisma.personaDocument.count({
      where: { personaId, userId },
    });
    if (existingCount >= 1) {
      throw new BadRequestException('Limit reached: only 1 document per persona. Delete the existing one first.');
    }

    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Only PDF files are supported');
    }

    // Parse PDF using pdf-parse v2 API
    const pdf = new PDFParse({ data: new Uint8Array(file.buffer) });
    const result = await pdf.getText();
    // Sanitize: remove null bytes and non-printable chars that break PostgreSQL UTF-8
    const text: string = (result.text || '').replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');

    if (!text || text.trim().length < 50) {
      throw new BadRequestException('PDF appears to be empty or too short');
    }

    // Chunk the text
    const chunks = this.chunkText(text);

    // Create document record
    const doc = await this.prisma.personaDocument.create({
      data: {
        personaId,
        userId,
        filename: file.originalname,
        fileSize: file.size,
        chunkCount: chunks.length,
      },
    });

    // Embed and store each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await generateEmbedding(chunkText, this.openRouterApiKey);

      if (embedding.length > 0) {
        await this.prisma.$executeRaw`
          INSERT INTO document_chunks (id, document_id, persona_id, content, chunk_index, embedding, created_at)
          VALUES (
            gen_random_uuid(),
            ${doc.id},
            ${personaId},
            ${chunkText},
            ${i},
            ${embedding}::vector,
            NOW()
          )
        `;
      } else {
        // Store without embedding if generation failed
        await this.prisma.$executeRaw`
          INSERT INTO document_chunks (id, document_id, persona_id, content, chunk_index, created_at)
          VALUES (
            gen_random_uuid(),
            ${doc.id},
            ${personaId},
            ${chunkText},
            ${i},
            NOW()
          )
        `;
      }
    }

    const docResult = {
      id: doc.id,
      filename: doc.filename,
      fileSize: doc.fileSize,
      chunkCount: chunks.length,
      createdAt: doc.createdAt,
    };

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'kb.document_uploaded',
      payload: { documentId: doc.id, filename: doc.filename, chunkCount: chunks.length, personaId },
    });

    return docResult;
  }

  /**
   * List all documents for a persona.
   */
  async getDocuments(userId: string, personaId: string) {
    // Validate persona ownership
    const persona = await this.prisma.persona.findFirst({
      where: { id: personaId, userId },
    });
    if (!persona) throw new NotFoundException('Persona not found');

    return this.prisma.personaDocument.findMany({
      where: { personaId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        fileSize: true,
        chunkCount: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete a document and its chunks (cascade).
   */
  async deleteDocument(userId: string, documentId: string) {
    const doc = await this.prisma.personaDocument.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.personaDocument.delete({
      where: { id: documentId },
    });

    this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
      userId,
      eventType: 'kb.document_deleted',
      payload: { documentId, filename: doc.filename },
    });

    return { deleted: true };
  }

  /**
   * Retrieve the most relevant chunks for a given query from a persona's knowledge base.
   * Uses cosine similarity via pgvector.
   */
  async retrieveRelevantChunks(
    personaId: string,
    query: string,
    topK = 5,
  ): Promise<string[]> {
    const embedding = await generateEmbedding(query, this.openRouterApiKey);
    if (embedding.length === 0) return [];

    const results = await this.prisma.$queryRaw<
      Array<{ content: string; similarity: number }>
    >`
      SELECT content, 1 - (embedding <=> ${embedding}::vector) AS similarity
      FROM document_chunks
      WHERE persona_id = ${personaId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT ${topK}
    `;

    // Filter by minimum similarity threshold
    return results
      .filter((r) => r.similarity > 0.3)
      .map((r) => r.content);
  }

  /**
   * Chunk text into segments of ~800 tokens with ~100 token overlap.
   * Strategy: split by paragraphs, merge small ones, split large ones at sentence boundaries.
   */
  private chunkText(text: string, targetTokens = 800, overlapTokens = 100): string[] {
    // Rough token estimation: ~4 chars per token
    const charsPerToken = 4;
    const targetChars = targetTokens * charsPerToken;
    const overlapChars = overlapTokens * charsPerToken;

    // Split into paragraphs
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      if (para.length > targetChars * 1.5) {
        // Large paragraph: flush current chunk, then split paragraph by sentences
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if ((sentenceChunk + sentence).length > targetChars && sentenceChunk.length > 0) {
            chunks.push(sentenceChunk.trim());
            // Overlap: keep last portion
            sentenceChunk = sentenceChunk.slice(-overlapChars) + sentence;
          } else {
            sentenceChunk += sentence;
          }
        }
        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk.trim();
        }
      } else if ((currentChunk + '\n\n' + para).length > targetChars && currentChunk.length > 0) {
        // Current chunk is full, push it and start new with overlap
        chunks.push(currentChunk.trim());
        const overlap = currentChunk.slice(-overlapChars);
        currentChunk = overlap + '\n\n' + para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text.substring(0, targetChars)];
  }
}
