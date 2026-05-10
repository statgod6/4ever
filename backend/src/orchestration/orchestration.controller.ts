import { Controller, Post, Get, Put, Delete, Body, Param, Query, UseGuards, Request, Res, UploadedFile, UseInterceptors, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { OrchestrationService } from './orchestration.service';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('orchestration')
@UseGuards(JwtAuthGuard)
export class OrchestrationController {
  constructor(
    private orchestrationService: OrchestrationService,
    private memoryConsolidation: MemoryConsolidationService,
  ) {}

  @Post('analyze')
  async analyzeThought(
    @Body('thoughtId') thoughtId: string,
    @Body('personaIds') personaIds: string[],
    @Request() req,
  ) {
    return this.orchestrationService.analyzeThought(
      req.user.userId,
      thoughtId,
      personaIds,
    );
  }

  @Post('reply-persona')
  async replyToPersona(
    @Body('thoughtId') thoughtId: string,
    @Body('personaId') personaId: string,
    @Body('message') message: string,
    @Request() req,
  ) {
    return this.orchestrationService.replyToPersona(
      req.user.userId,
      thoughtId,
      personaId,
      message,
    );
  }

  @Post('reply-persona/stream')
  async replyToPersonaStream(
    @Body('thoughtId') thoughtId: string,
    @Body('personaId') personaId: string,
    @Body('message') message: string,
    @Request() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = this.orchestrationService.replyToPersonaStream(
        req.user.userId,
        thoughtId,
        personaId,
        message,
      );

      for await (const event of stream) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      res.write(`event: response\ndata: ${JSON.stringify({ text: 'Sorry, I encountered an error. Please try again.' })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
    }

    res.end();
  }

  @Post('quick-chat')
  async quickChat(
    @Body('message') message: string,
    @Body('personaId') personaId: string | undefined,
    @Request() req,
  ) {
    return this.orchestrationService.quickChat(
      req.user.userId,
      message,
      personaId,
    );
  }

  @Post('core-chat')
  async coreChat(
    @Body('message') message: string,
    @Request() req,
  ) {
    return this.orchestrationService.coreChat(
      req.user.userId,
      message,
    );
  }

  @Post('core-chat/stream')
  async coreChatStream(
    @Body('message') message: string,
    @Request() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = this.orchestrationService.coreChatStream(
        req.user.userId,
        message,
      );

      for await (const event of stream) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      res.write(`event: response\ndata: ${JSON.stringify({ text: 'Sorry, I encountered an error. Please try again.' })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
    }

    res.end();
  }

  @Get('core-chat/history')
  async getCoreChatHistory(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orchestrationService.getCoreChatHistory(
      req.user.userId,
      limit ? +limit : undefined,
      cursor,
    );
  }

  @Delete('core-chat/history')
  async clearCoreChatHistory(@Request() req) {
    return this.orchestrationService.clearCoreChatHistory(req.user.userId);
  }

  @Post('core-chat/new-session')
  async newCoreChatSession(@Request() req) {
    return this.orchestrationService.newCoreChatSession(req.user.userId);
  }

  // =================== VOICE (STT + TTS) ===================

  @Post('voice/transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async transcribeVoice(
    @UploadedFile() file: any,
    @Request() req,
  ) {
    if (!file || !file.buffer) {
      throw new HttpException('No audio file uploaded', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.orchestrationService.transcribeAudio(
        file.buffer,
        file.mimetype || 'audio/m4a',
      );
      return result;
    } catch (err: any) {
      throw new HttpException(
        err?.message || 'Transcription failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('voice/speak')
  async synthesizeVoice(
    @Body('text') text: string,
    @Body('voice') voice: string | undefined,
    @Request() req,
    @Res() res: Response,
  ) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new HttpException('text is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const audio = await this.orchestrationService.synthesizeSpeech(text, voice || 'nova');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audio.length.toString());
      res.setHeader('Cache-Control', 'no-store');
      res.end(audio);
    } catch (err: any) {
      throw new HttpException(
        err?.message || 'TTS failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // =================== PERSONA DIRECT CHAT ===================

  @Post('persona-chat/stream')
  async personaDirectChatStream(
    @Body('personaId') personaId: string,
    @Body('message') message: string,
    @Request() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = this.orchestrationService.personaDirectChatStream(
        req.user.userId,
        personaId,
        message,
      );

      for await (const event of stream) {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      res.write(`event: response\ndata: ${JSON.stringify({ text: 'Sorry, I encountered an error. Please try again.' })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
    }

    res.end();
  }

  @Get('persona-chat/:personaId/history')
  async getPersonaChatHistory(
    @Param('personaId') personaId: string,
    @Request() req,
  ) {
    return this.orchestrationService.getPersonaChatHistory(req.user.userId, personaId);
  }

  @Delete('persona-chat/:personaId/history')
  async clearPersonaChatHistory(
    @Param('personaId') personaId: string,
    @Request() req,
  ) {
    return this.orchestrationService.clearPersonaChatHistory(req.user.userId, personaId);
  }

  // =================== MEMORY MANAGEMENT ===================

  @Get('memories')
  async listMemories(
    @Request() req,
    @Query('status') status?: string,
    @Query('memoryType') memoryType?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orchestrationService.listMemories(req.user.userId, {
      status, memoryType, source,
      limit: limit ? +limit : undefined,
      cursor,
    });
  }

  @Get('memories/search')
  async searchMemories(
    @Request() req,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    return this.orchestrationService.searchMemories(
      req.user.userId,
      query,
      limit ? +limit : undefined,
    );
  }

  @Get('memories/stats')
  async getMemoryStats(@Request() req) {
    return this.orchestrationService.getMemoryStats(req.user.userId);
  }

  @Post('memories')
  async createMemory(
    @Body('content') content: string,
    @Body('memoryType') memoryType: string,
    @Body('category') category: string,
    @Request() req,
  ) {
    return this.orchestrationService.createMemory(
      req.user.userId, content, memoryType || 'fact', category,
    );
  }

  @Put('memories/:id')
  async updateMemory(
    @Param('id') id: string,
    @Body('content') content: string,
    @Request() req,
  ) {
    return this.orchestrationService.updateMemory(req.user.userId, id, content);
  }

  @Delete('memories/:id')
  async deleteMemory(
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.orchestrationService.deleteMemory(req.user.userId, id);
  }

  @Post('memories/consolidate')
  async consolidateMemories(@Request() req) {
    return this.memoryConsolidation.consolidateMemories(req.user.userId);
  }

  @Get('profile-changelog')
  async getProfileChangelog(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orchestrationService.getProfileChangelog(
      req.user.userId,
      limit ? +limit : undefined,
      cursor,
    );
  }

  @Get('session-summaries')
  async getSessionSummaries(
    @Request() req,
    @Query('limit') limit?: string,
  ) {
    return this.orchestrationService.getSessionSummaries(
      req.user.userId,
      limit ? +limit : undefined,
    );
  }
}
