import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { generateEmbedding } from '../../orchestration/graph/utils/embeddings';
import { DocumentStorageService } from './document-storage.service';
import * as pdfParseModule from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const { PDFParse } = pdfParseModule as any;

const SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'text/plain',
  'text/markdown',
];

/**
 * Parses, chunks, embeds, and persists user-uploaded documents for the
 * Knowledge Worker. Content is stored via DocumentStorageService; chunks go
 * into `kw_document_chunks` with pgvector(1536) embeddings.
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);
  private openRouterApiKey = '';

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private storage: DocumentStorageService,
  ) {
    this.openRouterApiKey = this.config.get<string>('OPENROUTER_API_KEY') || '';
  }

  /** End-to-end: validate → store → extract → chunk → embed → persist. */
  async ingest(userId: string, file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    if (file.size > 25 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 25MB limit');
    }

    const mime = file.mimetype || 'application/octet-stream';
    const name = file.originalname || 'document';
    const ext = name.toLowerCase().split('.').pop() || '';
    const effectiveMime = this.resolveMime(mime, ext);

    if (!SUPPORTED_MIME.includes(effectiveMime)) {
      throw new BadRequestException(
        `Unsupported file type: ${mime}. Supported: PDF, DOCX, XLSX/XLS, CSV, TXT, MD.`,
      );
    }

    // Extract text
    const text = await this.extract(file.buffer, effectiveMime);
    if (!text || text.trim().length < 20) {
      throw new BadRequestException('Document appears to be empty or could not be parsed.');
    }

    // Store raw file so users can re-download or regenerate chunks later
    const storagePath = await this.storage.put(userId, name, file.buffer);

    // Chunk
    const chunks = this.chunkText(text);

    // Create document row
    const doc = await (this.prisma as any).kwDocument.create({
      data: {
        userId,
        filename: name,
        mimeType: effectiveMime,
        fileSize: file.size,
        chunkCount: chunks.length,
        storagePath,
      },
    });

    // Embed + insert
    let embedded = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk, this.openRouterApiKey);
      if (embedding.length > 0) {
        embedded++;
        await this.prisma.$executeRaw`
          INSERT INTO kw_document_chunks (id, document_id, user_id, content, chunk_index, embedding, created_at)
          VALUES (gen_random_uuid()::text, ${doc.id}, ${userId}, ${chunk}, ${i}, ${embedding}::vector, NOW())
        `;
      } else {
        await this.prisma.$executeRaw`
          INSERT INTO kw_document_chunks (id, document_id, user_id, content, chunk_index, created_at)
          VALUES (gen_random_uuid()::text, ${doc.id}, ${userId}, ${chunk}, ${i}, NOW())
        `;
      }
    }

    this.logger.log(`Ingested ${name}: ${chunks.length} chunks, ${embedded} embedded`);

    return {
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      chunkCount: doc.chunkCount,
      createdAt: doc.createdAt,
    };
  }

  async listForUser(userId: string) {
    return (this.prisma as any).kwDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        fileSize: true,
        chunkCount: true,
        createdAt: true,
      },
    });
  }

  async deleteForUser(userId: string, documentId: string) {
    const doc = await (this.prisma as any).kwDocument.findFirst({
      where: { id: documentId, userId },
    });
    if (!doc) return { ok: false };
    // Chunks cascade via FK
    await (this.prisma as any).kwDocument.delete({ where: { id: doc.id } });
    if (doc.storagePath) await this.storage.delete(doc.storagePath);
    return { ok: true };
  }

  // ─────────── helpers ───────────

  private resolveMime(mime: string, ext: string): string {
    if (mime && mime !== 'application/octet-stream') return mime;
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'xls':
        return 'application/vnd.ms-excel';
      case 'csv':
        return 'text/csv';
      case 'md':
        return 'text/markdown';
      case 'txt':
        return 'text/plain';
      default:
        return mime;
    }
  }

  private async extract(buffer: Buffer, mime: string): Promise<string> {
    let text = '';
    if (mime === 'application/pdf') {
      const pdf = new PDFParse({ data: new Uint8Array(buffer) });
      const r = await pdf.getText();
      text = r.text || '';
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const r = await mammoth.extractRawText({ buffer });
      text = r.value || '';
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'text/csv'
    ) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) parts.push(`# Sheet: ${sheetName}\n\n${csv}`);
      }
      text = parts.join('\n\n');
    } else {
      text = buffer.toString('utf-8');
    }
    // Sanitize null bytes and non-printable chars for Postgres UTF-8 safety
    return text.replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
  }

  /**
   * Chunk text into ~800-token segments with ~100-token overlap.
   * Paragraph-first, sentence-fallback for oversized paragraphs.
   */
  private chunkText(text: string, targetTokens = 800, overlapTokens = 100): string[] {
    const charsPerToken = 4;
    const targetChars = targetTokens * charsPerToken;
    const overlapChars = overlapTokens * charsPerToken;

    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      if (para.length > targetChars * 1.5) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
        let sentenceChunk = '';
        for (const sentence of sentences) {
          if ((sentenceChunk + sentence).length > targetChars && sentenceChunk.length > 0) {
            chunks.push(sentenceChunk.trim());
            sentenceChunk = sentenceChunk.slice(-overlapChars) + sentence;
          } else {
            sentenceChunk += sentence;
          }
        }
        if (sentenceChunk.trim()) currentChunk = sentenceChunk.trim();
      } else if ((currentChunk + '\n\n' + para).length > targetChars && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = currentChunk.slice(-overlapChars) + '\n\n' + para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks.length > 0 ? chunks : [text.substring(0, targetChars)];
  }
}
