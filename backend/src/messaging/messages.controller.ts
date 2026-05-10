import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessagingService } from './messaging.service';
import { MediatorService } from './mediator.service';
import { EditMessageDto } from './dto/edit-message.dto';
import { AddReactionDto } from './dto/add-reaction.dto';
import { ConversationSettingsDto } from './dto/conversation-settings.dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly mediatorService: MediatorService,
  ) {}

  @Get('conversations')
  getConversationList(@Request() req) {
    return this.messagingService.getConversationList(req.user.userId);
  }

  @Get('unread')
  getTotalUnread(@Request() req) {
    return this.messagingService.getTotalUnread(req.user.userId);
  }

  @Get(':userId')
  getConversation(
    @Request() req,
    @Param('userId') otherUserId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.messagingService.getConversation(req.user.userId, otherUserId, cursor);
  }

  @Get(':userId/search')
  searchMessages(
    @Request() req,
    @Param('userId') otherUserId: string,
    @Query('q') query: string,
  ) {
    return this.messagingService.searchMessages(req.user.userId, otherUserId, query);
  }

  @Post(':userId/read')
  markAsRead(@Request() req, @Param('userId') otherUserId: string) {
    return this.messagingService.markAsRead(req.user.userId, otherUserId);
  }

  // --- Message Actions ---

  @Put(':messageId/edit')
  editMessage(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messagingService.editMessage(req.user.userId, messageId, dto.content);
  }

  @Delete(':messageId')
  deleteMessage(@Request() req, @Param('messageId') messageId: string) {
    return this.messagingService.deleteMessage(req.user.userId, messageId);
  }

  // --- Reactions ---

  @Post(':messageId/reactions')
  addReaction(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() dto: AddReactionDto,
  ) {
    return this.messagingService.addReaction(req.user.userId, messageId, dto.emoji);
  }

  @Get(':messageId/reactions')
  getReactions(@Param('messageId') messageId: string) {
    return this.messagingService.getReactions(messageId);
  }

  // --- Conversation Settings ---

  @Put('conversation/:connectionId/settings')
  updateConversationSettings(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Body() dto: ConversationSettingsDto,
  ) {
    return this.messagingService.updateConversationSettings(
      req.user.userId,
      connectionId,
      {
        pinned: dto.pinned,
        muted: dto.mutedUntil ? new Date(dto.mutedUntil) : dto.mutedUntil === null ? null : undefined,
        archived: dto.archived,
      },
    );
  }

  // --- Last Seen ---

  @Get('user/:userId/last-seen')
  getLastSeen(@Param('userId') userId: string) {
    return this.messagingService.getLastSeen(userId);
  }

  // --- Tri-Chat Mediator ---

  @Post('conversation/:connectionId/tri-chat/toggle')
  toggleTriChat(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.mediatorService.toggleTriChat(
      req.user.userId,
      connectionId,
      !!body?.enabled,
    );
  }

  @Get('conversation/:connectionId/tri-chat/status')
  getTriChatStatus(
    @Request() req,
    @Param('connectionId') connectionId: string,
  ) {
    return this.mediatorService.getTriChatStatus(req.user.userId, connectionId);
  }

  @Post('conversation/:connectionId/summon-mediator')
  summonMediator(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Body() body?: { sessionId?: string; replyText?: string },
  ) {
    // REST fallback — drains the stream and returns the final message.
    // Preferred path is the websocket `summon_mediator` event for live streaming.
    return this.mediatorService.summonMediatorSync(
      req.user.userId,
      connectionId,
      {
        sessionId: body?.sessionId,
        replyText: body?.replyText,
      },
    );
  }

  @Post('conversation/:connectionId/mediator-session/:sessionId/reply')
  replyToMediator(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { text: string },
  ) {
    return this.mediatorService.summonMediatorSync(
      req.user.userId,
      connectionId,
      { sessionId, replyText: body?.text || '' },
    );
  }

  @Post('conversation/:connectionId/mediator-session/:sessionId/end')
  endMediatorSession(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.mediatorService.endMediatorSession(
      req.user.userId,
      connectionId,
      sessionId,
    );
  }

  @Post('conversation/:connectionId/clear-history')
  clearMyHistory(
    @Request() req,
    @Param('connectionId') connectionId: string,
  ) {
    return this.mediatorService.clearMyHistory(
      req.user.userId,
      connectionId,
    );
  }

  @Put('conversation/:connectionId/mediator-name')
  renameMediator(
    @Request() req,
    @Param('connectionId') connectionId: string,
    @Body() body: { name: string },
  ) {
    return this.mediatorService.renameMediator(
      req.user.userId,
      connectionId,
      body?.name || '',
    );
  }

  @Post(':messageId/mediator-action/:actionIndex/accept')
  acceptMediatorAction(
    @Request() req,
    @Param('messageId') messageId: string,
    @Param('actionIndex') actionIndex: string,
  ) {
    const idx = Number.parseInt(actionIndex, 10);
    return this.mediatorService.acceptMediatorAction(
      req.user.userId,
      messageId,
      Number.isNaN(idx) ? -1 : idx,
    );
  }
}
