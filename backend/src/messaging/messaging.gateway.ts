import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagingService } from './messaging.service';
import { MediatorService } from './mediator.service';
import { requireJwtSecret } from '../auth/jwt-secret';

interface AuthSocket extends Socket {
  userId?: string;
}

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

// ─── Input limits (hard caps; DTO-level limits stay permissive on purpose) ──
const LIMITS = {
  content: 4000,
  emoji: 16,
  id: 64, // cuid/uuid length
  metadata: 8000,
};

// Per-event, per-user sliding-window caps (requests per 60s).
const RATE_LIMITS: Record<string, number> = {
  send_message: 60,
  edit_message: 30,
  delete_message: 20,
  toggle_reaction: 60,
  mark_read: 60,
  typing: 240, // 4/s
  get_online_status: 30,
  get_last_seen: 30,
  toggle_tri_chat: 20,
  summon_mediator: 12, // per 60s; hard per-connection cap lives in MediatorService
  reply_to_mediator: 12,
  end_mediator_session: 20,
  clear_chat_history: 10,
  rename_mediator: 10,
  accept_mediator_action: 30,
};

function getCorsOrigins(): string[] {
  return process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : DEFAULT_ORIGINS;
}

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    credentials: true,
  },
  namespace: '/ws',
})
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Track online users: userId -> Set<socketId>
  private onlineUsers = new Map<string, Set<string>>();

  // Rate-limit counters: "userId:event" -> { count, windowStart }
  private rateCounters = new Map<string, { count: number; ts: number }>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private messagingService: MessagingService,
    private mediatorService: MediatorService,
  ) {
    // Periodic cleanup of stale rate-limit entries to prevent unbounded growth
    setInterval(() => {
      const cutoff = Date.now() - 120_000;
      for (const [key, entry] of this.rateCounters) {
        if (entry.ts < cutoff) this.rateCounters.delete(key);
      }
    }, 120_000).unref?.();
  }

  // ─── Rate-limit & validation helpers ────────────────────────

  private checkRate(userId: string, event: string): boolean {
    const max = RATE_LIMITS[event];
    if (!max) return true;
    const key = `${userId}:${event}`;
    const now = Date.now();
    const entry = this.rateCounters.get(key);
    if (!entry || now - entry.ts > 60_000) {
      this.rateCounters.set(key, { count: 1, ts: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  }

  private isStr(v: unknown, max: number, { allowEmpty = false } = {}): v is string {
    if (typeof v !== 'string') return false;
    if (!allowEmpty && v.length === 0) return false;
    return v.length <= max;
  }

  private rejectRate(client: AuthSocket, event: string, clientTempId?: string) {
    client.emit('message_error', {
      error: `Rate limit exceeded for ${event}. Slow down.`,
      code: 'RATE_LIMIT',
      ...(clientTempId ? { clientTempId } : {}),
    });
  }

  private rejectInvalid(client: AuthSocket, detail: string, clientTempId?: string) {
    client.emit('message_error', {
      error: `Invalid payload: ${detail}`,
      code: 'INVALID_INPUT',
      ...(clientTempId ? { clientTempId } : {}),
    });
  }

  async handleConnection(client: AuthSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const secret = requireJwtSecret(this.configService);
      const payload = this.jwtService.verify(token, { secret });
      client.userId = payload.sub;

      // Join personal room for targeted events
      client.join(`user:${client.userId}`);

      // Track online status
      if (!this.onlineUsers.has(client.userId)) {
        this.onlineUsers.set(client.userId, new Set());
      }
      this.onlineUsers.get(client.userId)!.add(client.id);

      // Notify others this user is online
      client.broadcast.emit('user_online', { userId: client.userId });

      // Mark pending messages as delivered (for ALL senders to this user).
      this.messagingService.markAsDelivered(client.userId).catch(() => {});
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthSocket) {
    if (client.userId) {
      // Update last seen
      this.messagingService.updateLastSeen(client.userId).catch(() => {});

      const sockets = this.onlineUsers.get(client.userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.onlineUsers.delete(client.userId);
          // Notify others this user is offline with lastSeen
          client.broadcast.emit('user_offline', {
            userId: client.userId,
            lastSeenAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  /**
   * Check if a user is currently online.
   */
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  // ─── Send Message ────────────────────────────────────────────

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody()
    data: {
      receiverId: string;
      content: string;
      replyToId?: string;
      messageType?: string;
      metadata?: string;
      clientTempId?: string;
    },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.receiverId, LIMITS.id)) return this.rejectInvalid(client, 'receiverId', data.clientTempId);
    if (!this.isStr(data.content, LIMITS.content)) return this.rejectInvalid(client, `content (1..${LIMITS.content})`, data.clientTempId);
    if (data.replyToId !== undefined && !this.isStr(data.replyToId, LIMITS.id)) return this.rejectInvalid(client, 'replyToId', data.clientTempId);
    if (data.metadata !== undefined && !this.isStr(data.metadata, LIMITS.metadata, { allowEmpty: true })) return this.rejectInvalid(client, 'metadata', data.clientTempId);
    if (!this.checkRate(client.userId, 'send_message')) return this.rejectRate(client, 'send_message', data.clientTempId);

    try {
      const message = await this.messagingService.sendMessage(
        client.userId,
        data.receiverId,
        data.content,
        {
          replyToId: data.replyToId,
          messageType: data.messageType,
          metadata: data.metadata,
        },
      );

      // Send to receiver's room (no clientTempId — that's private to the sender)
      this.server
        .to(`user:${data.receiverId}`)
        .emit('new_message', message);

      // Confirm to sender with full message data + echo of clientTempId for temp swap
      client.emit('message_sent', { ...message, clientTempId: data.clientTempId });

      // If receiver is online, auto-mark as delivered
      if (this.isUserOnline(data.receiverId)) {
        await this.messagingService.updateMessageStatus(message.id, 'delivered');
        // Notify sender of delivery
        client.emit('message_status', {
          messageId: message.id,
          status: 'delivered',
        });
      }
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to send message',
        clientTempId: data.clientTempId,
      });
    }
  }

  // ─── Edit Message ────────────────────────────────────────────

  @SubscribeMessage('edit_message')
  async handleEditMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { messageId: string; content: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.messageId, LIMITS.id)) return this.rejectInvalid(client, 'messageId');
    if (!this.isStr(data.content, LIMITS.content)) return this.rejectInvalid(client, `content (1..${LIMITS.content})`);
    if (!this.checkRate(client.userId, 'edit_message')) return this.rejectRate(client, 'edit_message');

    try {
      const message = await this.messagingService.editMessage(
        client.userId,
        data.messageId,
        data.content,
      );

      // Notify both sender and receiver
      client.emit('message_edited', message);
      this.server
        .to(`user:${message.receiverId}`)
        .emit('message_edited', message);
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to edit message',
      });
    }
  }

  // ─── Delete Message ──────────────────────────────────────────

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { messageId: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.messageId, LIMITS.id)) return this.rejectInvalid(client, 'messageId');
    if (!this.checkRate(client.userId, 'delete_message')) return this.rejectRate(client, 'delete_message');

    try {
      const message = await this.messagingService.deleteMessage(
        client.userId,
        data.messageId,
      );

      const deleteEvent = {
        messageId: data.messageId,
        deletedAt: message.deletedAt,
      };

      // Notify both parties
      client.emit('message_deleted', deleteEvent);
      this.server
        .to(`user:${message.receiverId}`)
        .emit('message_deleted', deleteEvent);
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to delete message',
      });
    }
  }

  // ─── Reactions ───────────────────────────────────────────────

  @SubscribeMessage('toggle_reaction')
  async handleReaction(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.messageId, LIMITS.id)) return this.rejectInvalid(client, 'messageId');
    if (!this.isStr(data.emoji, LIMITS.emoji)) return this.rejectInvalid(client, `emoji (1..${LIMITS.emoji})`);
    if (!this.checkRate(client.userId, 'toggle_reaction')) return this.rejectRate(client, 'toggle_reaction');

    try {
      const result = await this.messagingService.addReaction(
        client.userId,
        data.messageId,
        data.emoji,
      );

      const reactionEvent = {
        messageId: data.messageId,
        emoji: data.emoji,
        userId: client.userId,
        action: result.action,
      };

      // Scope broadcast to sender + receiver rooms only (privacy).
      // addReaction already validated the user is part of the conversation.
      const message = await this.messagingService.getMessageParties(data.messageId);
      if (message) {
        this.server.to(`user:${message.senderId}`).emit('reaction_updated', reactionEvent);
        if (message.receiverId !== message.senderId) {
          this.server.to(`user:${message.receiverId}`).emit('reaction_updated', reactionEvent);
        }
      } else {
        // Fallback: at least deliver to the reacting client
        client.emit('reaction_updated', reactionEvent);
      }
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to toggle reaction',
      });
    }
  }

  // ─── Mark Read ───────────────────────────────────────────────

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { otherUserId: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return;
    if (!this.isStr(data.otherUserId, LIMITS.id)) return;
    if (!this.checkRate(client.userId, 'mark_read')) return;

    try {
      await this.messagingService.markAsRead(client.userId, data.otherUserId);

      // Notify the other user their messages were read
      this.server
        .to(`user:${data.otherUserId}`)
        .emit('messages_read', { readBy: client.userId });
    } catch {
      // silent
    }
  }

  // ─── Typing ──────────────────────────────────────────────────

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { receiverId: string; isTyping: boolean },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return;
    if (!this.isStr(data.receiverId, LIMITS.id)) return;
    if (typeof data.isTyping !== 'boolean') return;
    if (!this.checkRate(client.userId, 'typing')) return; // silent drop on typing floods

    this.server.to(`user:${data.receiverId}`).emit('user_typing', {
      userId: client.userId,
      isTyping: data.isTyping,
    });
  }

  // ─── Online Status ──────────────────────────────────────────

  @SubscribeMessage('get_online_status')
  handleGetOnlineStatus(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { userIds: string[] },
  ) {
    if (!client.userId) return;
    if (!data || !Array.isArray(data.userIds)) return;
    // Cap the batch to keep the response bounded
    const ids = data.userIds
      .filter((id) => this.isStr(id, LIMITS.id))
      .slice(0, 500);
    if (!this.checkRate(client.userId, 'get_online_status')) return;
    const statuses = ids.map((id) => ({
      userId: id,
      online: this.onlineUsers.has(id),
    }));
    client.emit('online_status', statuses);
  }

  // ─── Last Seen ──────────────────────────────────────────────

  @SubscribeMessage('get_last_seen')
  async handleGetLastSeen(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { userId: string },
  ) {
    if (!client.userId) return;
    if (!data || !this.isStr(data.userId, LIMITS.id)) return;
    if (!this.checkRate(client.userId, 'get_last_seen')) return;

    const result = await this.messagingService.getLastSeen(data.userId);
    client.emit('last_seen', {
      userId: data.userId,
      lastSeenAt: result.lastSeenAt,
      online: this.isUserOnline(data.userId),
    });
  }

  // ─── Tri-Chat: toggle ──────────────────────────────────────

  @SubscribeMessage('toggle_tri_chat')
  async handleToggleTriChat(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string; enabled: boolean },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (typeof data.enabled !== 'boolean') return this.rejectInvalid(client, 'enabled must be boolean');
    if (!this.checkRate(client.userId, 'toggle_tri_chat')) return this.rejectRate(client, 'toggle_tri_chat');

    try {
      const result = await this.mediatorService.toggleTriChat(
        client.userId,
        data.connectionId,
        data.enabled,
      );

      // Notify both parties so UI banners stay in sync.
      const payload = {
        connectionId: result.connectionId,
        byUserId: result.userId,
        enabled: result.enabled,
        bothEnabled: result.bothEnabled,
      };
      client.emit('tri_chat_toggled', payload);
      this.server.to(`user:${result.otherUserId}`).emit('tri_chat_toggled', payload);
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to toggle mediator',
        code: 'TRI_CHAT_TOGGLE_FAILED',
      });
    }
  }

  // ─── Tri-Chat: summon + stream ─────────────────────────────

  @SubscribeMessage('summon_mediator')
  async handleSummonMediator(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (!this.checkRate(client.userId, 'summon_mediator')) return this.rejectRate(client, 'summon_mediator');

    let messageId: string | undefined;
    let receiverId: string | undefined;
    try {
      const { message, stream } = await this.mediatorService.summonMediator(
        client.userId,
        data.connectionId,
      );
      messageId = message.id;
      receiverId = message.receiverId;

      // Emit placeholder so the bubble shows immediately on both sides.
      client.emit('new_message', message);
      this.server.to(`user:${receiverId}`).emit('new_message', message);

      const typingPayload = { connectionId: data.connectionId, messageId };
      client.emit('mediator_typing', typingPayload);
      this.server.to(`user:${receiverId}`).emit('mediator_typing', typingPayload);

      // Stream deltas to both parties in real time.
      for await (const delta of stream) {
        const chunk = { messageId, delta };
        client.emit('mediator_chunk', chunk);
        this.server.to(`user:${receiverId}`).emit('mediator_chunk', chunk);
      }

      const done = { connectionId: data.connectionId, messageId, sessionId: (message as any).mediatorSessionId };
      client.emit('mediator_complete', done);
      if (receiverId) {
        this.server.to(`user:${receiverId}`).emit('mediator_complete', done);
      }
    } catch (err: any) {
      const cancelledId = (err && (err as any).cancelledMessageId) || messageId;
      if ((err as any)?.placeholderCancelled && cancelledId) {
        const cancelPayload = { connectionId: data.connectionId, messageId: cancelledId };
        client.emit('mediator_cancelled', cancelPayload);
        if (receiverId) {
          this.server.to(`user:${receiverId}`).emit('mediator_cancelled', cancelPayload);
        }
      }
      const errPayload = {
        error: err.message || 'Mediator failed',
        code: 'MEDIATOR_FAILED',
        messageId,
        connectionId: data.connectionId,
      };
      client.emit('mediator_error', errPayload);
      if (receiverId) {
        this.server.to(`user:${receiverId}`).emit('mediator_error', errPayload);
      }
    }
  }

  // ─── Tri-Chat: reply to mediator within an active session ──

  @SubscribeMessage('reply_to_mediator')
  async handleReplyToMediator(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string; sessionId: string; text: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (!this.isStr(data.sessionId, LIMITS.id)) return this.rejectInvalid(client, 'sessionId');
    if (!this.isStr(data.text, LIMITS.content)) return this.rejectInvalid(client, 'text');
    if (!this.checkRate(client.userId, 'reply_to_mediator')) return this.rejectRate(client, 'reply_to_mediator');

    let messageId: string | undefined;
    let receiverId: string | undefined;
    try {
      const { message, replyMessage, stream, sessionId } = await this.mediatorService.summonMediator(
        client.userId,
        data.connectionId,
        { sessionId: data.sessionId, replyText: data.text },
      );
      messageId = message.id;
      receiverId = message.receiverId;

      // Broadcast the user's reply first so both sides see the reply bubble,
      // then broadcast the mediator placeholder that's about to stream.
      if (replyMessage) {
        client.emit('new_message', replyMessage);
        this.server.to(`user:${receiverId}`).emit('new_message', replyMessage);
      }

      // Emit mediator placeholder
      client.emit('new_message', message);
      this.server.to(`user:${receiverId}`).emit('new_message', message);

      const typingPayload = { connectionId: data.connectionId, messageId, sessionId };
      client.emit('mediator_typing', typingPayload);
      this.server.to(`user:${receiverId}`).emit('mediator_typing', typingPayload);

      for await (const delta of stream) {
        const chunk = { messageId, delta, sessionId };
        client.emit('mediator_chunk', chunk);
        this.server.to(`user:${receiverId}`).emit('mediator_chunk', chunk);
      }

      const done = { connectionId: data.connectionId, messageId, sessionId };
      client.emit('mediator_complete', done);
      if (receiverId) {
        this.server.to(`user:${receiverId}`).emit('mediator_complete', done);
      }
    } catch (err: any) {
      const cancelledId = (err && (err as any).cancelledMessageId) || messageId;
      if ((err as any)?.placeholderCancelled && cancelledId) {
        const cancelPayload = { connectionId: data.connectionId, messageId: cancelledId, sessionId: data.sessionId };
        client.emit('mediator_cancelled', cancelPayload);
        if (receiverId) {
          this.server.to(`user:${receiverId}`).emit('mediator_cancelled', cancelPayload);
        }
      }
      const errPayload = {
        error: err.message || 'Mediator reply failed',
        code: 'MEDIATOR_REPLY_FAILED',
        messageId,
        connectionId: data.connectionId,
      };
      client.emit('mediator_error', errPayload);
      if (receiverId) {
        this.server.to(`user:${receiverId}`).emit('mediator_error', errPayload);
      }
    }
  }

  // ─── Tri-Chat: end a mediator session ─────────────────────

  @SubscribeMessage('end_mediator_session')
  async handleEndMediatorSession(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string; sessionId: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (!this.isStr(data.sessionId, LIMITS.id)) return this.rejectInvalid(client, 'sessionId');
    if (!this.checkRate(client.userId, 'end_mediator_session')) return this.rejectRate(client, 'end_mediator_session');

    try {
      const result = await this.mediatorService.endMediatorSession(
        client.userId,
        data.connectionId,
        data.sessionId,
      );
      const payload = {
        connectionId: result.connectionId,
        sessionId: result.sessionId,
        topic: result.topic,
        summary: result.summary,
        endedByUserId: client.userId,
      };
      client.emit('mediator_session_ended', payload);
      this.server.to(`user:${result.otherUserId}`).emit('mediator_session_ended', payload);
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to end mediator session',
        code: 'MEDIATOR_END_FAILED',
      });
    }
  }

  // ─── Tri-Chat: one-sided clear chat history ───────────────

  @SubscribeMessage('clear_chat_history')
  async handleClearChatHistory(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (!this.checkRate(client.userId, 'clear_chat_history')) return this.rejectRate(client, 'clear_chat_history');

    try {
      const result = await this.mediatorService.clearMyHistory(
        client.userId,
        data.connectionId,
      );
      // One-sided: only echo to the user who cleared. Other party keeps their view.
      client.emit('chat_history_cleared', {
        connectionId: result.connectionId,
        clearedAt: result.clearedAt,
        summarized: result.summarized,
      });
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to clear chat history',
        code: 'CLEAR_HISTORY_FAILED',
      });
    }
  }

  // ─── Tri-Chat: rename mediator (shared, per-connection) ───

  @SubscribeMessage('rename_mediator')
  async handleRenameMediator(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { connectionId: string; name: string },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.connectionId, LIMITS.id)) return this.rejectInvalid(client, 'connectionId');
    if (typeof data.name !== 'string' || !data.name.trim()) return this.rejectInvalid(client, 'name');
    if (!this.checkRate(client.userId, 'rename_mediator')) return this.rejectRate(client, 'rename_mediator');

    try {
      const result = await this.mediatorService.renameMediator(
        client.userId,
        data.connectionId,
        data.name,
      );
      // Shared name — broadcast to both parties in the connection.
      const payload = {
        connectionId: result.connectionId,
        mediatorName: result.mediatorName,
      };
      client.emit('mediator_renamed', payload);
      if (result.otherUserId) {
        this.server.to(`user:${result.otherUserId}`).emit('mediator_renamed', payload);
      }
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to rename mediator',
        code: 'MEDIATOR_RENAME_FAILED',
      });
    }
  }

  // ─── Tri-Chat: accept a mediator action card ──────────────

  @SubscribeMessage('accept_mediator_action')
  async handleAcceptMediatorAction(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { messageId: string; actionIndex: number },
  ) {
    if (!client.userId) return;
    if (!data || typeof data !== 'object') return this.rejectInvalid(client, 'payload must be an object');
    if (!this.isStr(data.messageId, LIMITS.id)) return this.rejectInvalid(client, 'messageId');
    if (typeof data.actionIndex !== 'number' || !Number.isInteger(data.actionIndex)) {
      return this.rejectInvalid(client, 'actionIndex');
    }
    if (!this.checkRate(client.userId, 'accept_mediator_action')) return this.rejectRate(client, 'accept_mediator_action');

    try {
      const result = await this.mediatorService.acceptMediatorAction(
        client.userId,
        data.messageId,
        data.actionIndex,
      );
      const payload = {
        messageId: result.messageId,
        actionIndex: result.actionIndex,
        type: (result as any).type,
        acceptedByUserIds: (result as any).acceptedByUserIds,
        byUserId: client.userId,
      };
      client.emit('mediator_action_accepted', payload);
      if ((result as any).otherUserId) {
        this.server.to(`user:${(result as any).otherUserId}`).emit('mediator_action_accepted', payload);
      }
    } catch (err: any) {
      client.emit('message_error', {
        error: err.message || 'Failed to accept action',
        code: 'MEDIATOR_ACTION_ACCEPT_FAILED',
      });
    }
  }
}
