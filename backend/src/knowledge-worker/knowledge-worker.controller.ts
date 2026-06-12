import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PremiumGuard } from '../auth/premium.guard';
import { KnowledgeWorkerService } from './knowledge-worker.service';
import { DocumentExtractionService } from './services/document-extraction.service';
import { DocumentStorageService } from './services/document-storage.service';
import { KwStreamDto } from './dto/kw-stream.dto';
import { UsageService } from '../usage/usage.service';

/**
 * Knowledge Worker endpoints — gated to premium subscribers.
 * Mirrors the SSE streaming contract used by /orchestration/core-chat/stream.
 */
@Controller('knowledge-worker')
@UseGuards(JwtAuthGuard, PremiumGuard)
export class KnowledgeWorkerController {
  private readonly logger = new Logger(KnowledgeWorkerController.name);

  constructor(
    private kw: KnowledgeWorkerService,
    private docs: DocumentExtractionService,
    private usage: UsageService,
  ) {}

  // ───────── Conversations ─────────

  @Get('conversations')
  async listConversations(@Request() req) {
    return this.kw.listConversations(req.user.userId);
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @Request() req) {
    return this.kw.getMessages(req.user.userId, id);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string, @Request() req) {
    return this.kw.deleteConversation(req.user.userId, id);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('stream')
  async stream(@Body() body: KwStreamDto, @Request() req, @Res() res: Response) {
    // Enforce monthly token cap before opening the (expensive) KW pipeline.
    // PremiumGuard already blocked free-tier callers; this stops a premium
    // user from burning through unbounded OpenRouter spend in one afternoon.
    await this.usage.checkQuota(req.user.userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const iter = this.kw.stream(
        req.user.userId,
        body?.message || '',
        body?.conversationId,
      );
      for await (const event of iter) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      res.write(
        `event: response\ndata: ${JSON.stringify({ text: 'Sorry, I encountered an error. Please try again.' })}\n\n`,
      );
      res.write(`event: done\ndata: {}\n\n`);
    }
    res.end();
  }

  // ───────── Documents ─────────

  @SkipThrottle()
  @Post('documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      return await this.docs.ingest(req.user.userId, file);
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Upload failed for user ${req.user.userId}: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException('Document processing failed. Please try again.');
    }
  }

  @Get('documents')
  async listDocuments(@Request() req) {
    return this.docs.listForUser(req.user.userId);
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string, @Request() req) {
    return this.docs.deleteForUser(req.user.userId, id);
  }

  // ───────── Generated file download ─────────
  // NOTE: This route is intentionally served by a SEPARATE public controller
  // (KnowledgeWorkerAssetsController below) so browser <img src> tags and
  // <a> download links work without needing to inject a Bearer token. Access
  // is protected by the UUID in the filename, which is unguessable.
}

/**
 * Authenticated file download controller — serves generated files via
 * signed URLs (S3) or local file streaming (dev fallback).
 *
 * Replaces the old public KnowledgeWorkerAssetsController. Now requires
 * JWT authentication so only the owning user can access their files.
 */
@Controller('knowledge-worker')
@UseGuards(JwtAuthGuard)
export class KnowledgeWorkerAssetsController {
  constructor(private storage: DocumentStorageService) {}

  // Accepts: <uuid>.<ext>, <prefix>-<uuid>.<ext>, <uuid>_<suffix>.<ext>
  private static readonly FILENAME_RE =
    /^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}\.[a-zA-Z0-9]{1,8}$/;
  private static readonly UUID_RE =
    /[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}|[a-f0-9]{16,}/i;

  @Get('generated/:filename')
  async downloadGenerated(
    @Param('filename') filename: string,
    @Request() req,
    @Res() res: Response,
  ) {
    // Prevent path traversal
    if (
      !filename ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..') ||
      filename.includes('\0')
    ) {
      throw new BadRequestException('Invalid filename');
    }
    if (
      !KnowledgeWorkerAssetsController.FILENAME_RE.test(filename) ||
      !KnowledgeWorkerAssetsController.UUID_RE.test(filename)
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const userId = req.user.userId;

    // Try S3 signed URL first
    const s3Key = `kw-generated/${userId}/${filename}`;
    const signedUrl = await this.storage.signedDownloadUrl(s3Key);
    if (signedUrl) {
      return res.redirect(302, signedUrl);
    }

    // Local fallback — serve from filesystem (dev only)
    const rootDir = path.resolve(process.cwd(), 'uploads', 'kw-generated');
    const filePath = path.join(rootDir, userId, filename);

    // Ensure resolved path is within the root directory (prevent traversal)
    if (!filePath.startsWith(rootDir)) {
      throw new BadRequestException('Invalid file path');
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    const ext = filename.toLowerCase().split('.').pop();
    let mime = 'application/octet-stream';
    let disposition: 'inline' | 'attachment' = 'attachment';
    if (ext === 'pdf') {
      mime = 'application/pdf';
    } else if (ext === 'docx') {
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === 'xlsx') {
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (ext === 'pptx') {
      mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (ext === 'png') {
      mime = 'image/png';
      disposition = 'inline';
    } else if (ext === 'jpg' || ext === 'jpeg') {
      mime = 'image/jpeg';
      disposition = 'inline';
    } else if (ext === 'svg') {
      mime = 'image/svg+xml';
      disposition = 'inline';
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  }
}
