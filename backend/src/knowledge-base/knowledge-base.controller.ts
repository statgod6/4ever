import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('knowledge-base')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(private knowledgeBaseService: KnowledgeBaseService) {}

  @Post(':personaId/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
    }),
  )
  async uploadDocument(
    @Param('personaId') personaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.knowledgeBaseService.uploadDocument(
      req.user.userId,
      personaId,
      file,
    );
  }

  @Get(':personaId/documents')
  async getDocuments(
    @Param('personaId') personaId: string,
    @Request() req,
  ) {
    return this.knowledgeBaseService.getDocuments(req.user.userId, personaId);
  }

  @Delete('documents/:documentId')
  async deleteDocument(
    @Param('documentId') documentId: string,
    @Request() req,
  ) {
    return this.knowledgeBaseService.deleteDocument(
      req.user.userId,
      documentId,
    );
  }
}
