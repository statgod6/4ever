import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ONTOLOGY_EVENTS } from '../ontology/events';

// Standard include for message queries
const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true } },
  receiver: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true } },
  replyTo: {
    select: {
      id: true, content: true, senderId: true,
      sender: { select: { id: true, name: true } },
    },
  },
  reactions: {
    select: { id: true, emoji: true, userId: true, user: { select: { id: true, name: true } } },
  },
};

@Injectable()
export class MessagingService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  private readonly logger = new Logger('MessagingService');

  /**
   * Validate that two users have an accepted connection before messaging.
   */
  private async validateConnection(userA: string, userB: string) {
    const connection = await this.prisma.connection.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userA, receiverId: userB },
          { requesterId: userB, receiverId: userA },
        ],
      },
    });
    if (!connection) {
      throw new ForbiddenException('You are not connected with this user');
    }
    return connection;
  }

  /**
   * Send a direct message to a connected user.
   * Supports replies, message types, and metadata.
   */
  async sendMessage(
    senderId: string,
    receiverId: string,
    content: string,
    options?: { replyToId?: string; messageType?: string; metadata?: string },
  ) {
    if (senderId === receiverId) {
      throw new ForbiddenException('Cannot send a message to yourself');
    }
    await this.validateConnection(senderId, receiverId);

    const message = await this.prisma.directMessage.create({
      data: {
        senderId,
        receiverId,
        content,
        status: 'sent',
        replyToId: options?.replyToId || null,
        messageType: options?.messageType || 'text',
        metadata: options?.metadata || null,
      },
      include: MESSAGE_INCLUDE,
    });

    // Mediator messages are AI-generated — do not feed them to the ontology
    // or the bidirectional auto-log pipeline (would pollute both).
    const isMediator = options?.messageType === 'mediator';

    if (!isMediator) {
      // Per-send relational ontology emit: if the receiver matches a
      // RelationshipPerson of the sender, fire RELATIONAL_INPUT immediately.
      // Uses first-name contains match (RelationshipPerson has no phoneNumber col).
      this.emitRelationalOnSend(senderId, receiverId).catch((err) =>
        this.logger.warn(`Relational ontology emit failed: ${err.message}`),
      );

      // Fire-and-forget: check bidirectional exchange and auto-log
      this.logBidirectionalInteraction(senderId, receiverId).catch((err) =>
        this.logger.warn(`Auto-interaction logging failed: ${err.message}`),
      );
    }

    return message;
  }

  /**
   * Look up whether the receiver is also a RelationshipPerson of the sender
   * (prefer authoritative linkedUserId, fall back to first-name contains match)
   * and emit a RELATIONAL_INPUT ontology event. Skips silently on no match.
   */
  private async emitRelationalOnSend(senderId: string, receiverId: string) {
    // 1. Authoritative link first
    let matched = await this.prisma.relationshipPerson.findFirst({
      where: {
        userId: senderId,
        isActive: true,
        linkedUserId: receiverId,
      },
      select: { id: true },
    });

    // 2. Fallback: fuzzy first-name match
    if (!matched) {
      const receiverUser = await this.prisma.user.findUnique({
        where: { id: receiverId },
        select: { name: true },
      });
      if (!receiverUser?.name) return;

      const firstName = receiverUser.name.split(' ')[0];
      if (!firstName) return;

      matched = await this.prisma.relationshipPerson.findFirst({
        where: {
          userId: senderId,
          isActive: true,
          linkedUserId: null,
          name: { contains: firstName, mode: 'insensitive' },
        },
        select: { id: true },
      });
    }
    if (!matched) return;

    this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
      userId: senderId,
      eventType: 'message.sent',
      scopeId: matched.id,
      payload: { receiverId },
    });
  }

  /**
   * Edit a message (sender only, text messages only).
   */
  async editMessage(userId: string, messageId: string, newContent: string) {
    const msg = await this.prisma.directMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) throw new ForbiddenException('Can only edit your own messages');
    if (msg.deletedAt) throw new ForbiddenException('Message is deleted');

    return this.prisma.directMessage.update({
      where: { id: messageId },
      data: { content: newContent, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
  }

  /**
   * Delete a message. Soft-delete so UI can show "message deleted".
   */
  async deleteMessage(userId: string, messageId: string) {
    const msg = await this.prisma.directMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) throw new ForbiddenException('Can only delete your own messages');

    return this.prisma.directMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '' },
      include: MESSAGE_INCLUDE,
    });
  }

  /**
   * Add emoji reaction to a message.
   */
  async addReaction(userId: string, messageId: string, emoji: string) {
    const msg = await this.prisma.directMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Message not found');
    // User must be sender or receiver
    if (msg.senderId !== userId && msg.receiverId !== userId) {
      throw new ForbiddenException('Not part of this conversation');
    }

    // Upsert: toggle reaction (if exists, remove; if not, add)
    const existing = await this.prisma.messageReaction.findFirst({
      where: { messageId, userId, emoji },
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      return { action: 'removed', messageId, emoji, userId };
    }

    const reaction = await this.prisma.messageReaction.create({
      data: { messageId, userId, emoji },
      include: { user: { select: { id: true, name: true } } },
    });
    return { action: 'added', ...reaction };
  }

  /**
   * Get reactions for a message.
   */
  async getReactions(messageId: string) {
    return this.prisma.messageReaction.findMany({
      where: { messageId },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /**
   * Update message delivery status (sent -> delivered -> read).
   */
  async updateMessageStatus(messageId: string, status: 'delivered' | 'read') {
    return this.prisma.directMessage.update({
      where: { id: messageId },
      data: {
        status,
        ...(status === 'read' ? { isRead: true } : {}),
      },
    });
  }

  /**
   * Mark messages as delivered. When otherUserId is omitted, mark ALL pending
   * messages addressed to userId as delivered (used on socket connect).
   */
  async markAsDelivered(userId: string, otherUserId?: string) {
    const result = await this.prisma.directMessage.updateMany({
      where: {
        receiverId: userId,
        status: 'sent',
        ...(otherUserId ? { senderId: otherUserId } : {}),
      },
      data: { status: 'delivered' },
    });
    return { marked: result.count };
  }

  /**
   * Update user's last seen timestamp.
   */
  async updateLastSeen(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Get last seen for a user.
   */
  async getLastSeen(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });
    return { lastSeenAt: user?.lastSeenAt || null };
  }

  /**
   * Pin/unpin, mute/unmute, archive/unarchive a conversation.
   */
  async updateConversationSettings(
    userId: string,
    connectionId: string,
    settings: { pinned?: boolean; muted?: Date | null; archived?: boolean },
  ) {
    const conn = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Connection not found');

    const isRequester = conn.requesterId === userId;
    const isReceiver = conn.receiverId === userId;
    if (!isRequester && !isReceiver) throw new ForbiddenException('Not your connection');

    const data: any = {};
    if (settings.pinned !== undefined) {
      data[isRequester ? 'pinnedByRequester' : 'pinnedByReceiver'] = settings.pinned;
    }
    if (settings.muted !== undefined) {
      data[isRequester ? 'mutedByRequester' : 'mutedByReceiver'] = settings.muted;
    }
    if (settings.archived !== undefined) {
      data[isRequester ? 'archivedByRequester' : 'archivedByReceiver'] = settings.archived;
    }

    return this.prisma.connection.update({ where: { id: connectionId }, data });
  }

  /**
   * Search messages in a conversation.
   */
  async searchMessages(userId: string, otherUserId: string, query: string, take = 20) {
    return this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
        content: { contains: query, mode: 'insensitive' },
        deletedAt: null,
      },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Check if both users have exchanged messages since the last auto-logged
   * interaction. If yes, log a relationship note on BOTH sides.
   */
  private async logBidirectionalInteraction(userA: string, userB: string) {
    // Get both users' names for circle matching
    const [personA, personB] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userA }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: userB }, select: { name: true } }),
    ]);
    if (!personA || !personB) return;

    // Find each user's RelationshipPerson entry for the other:
    // prefer authoritative linkedUserId, fall back to fuzzy first-name match.
    const findCircleEntry = async (ownerId: string, otherUserId: string, otherName: string) => {
      const explicit = await this.prisma.relationshipPerson.findFirst({
        where: { userId: ownerId, isActive: true, linkedUserId: otherUserId },
        select: { id: true, name: true, createdAt: true },
      });
      if (explicit) return explicit;
      const firstName = otherName.split(' ')[0];
      if (!firstName) return null;
      return this.prisma.relationshipPerson.findFirst({
        where: {
          userId: ownerId,
          isActive: true,
          linkedUserId: null,
          name: { contains: firstName, mode: 'insensitive' },
        },
        select: { id: true, name: true, createdAt: true },
      });
    };
    const [circleEntryA, circleEntryB] = await Promise.all([
      findCircleEntry(userA, userB, personB.name),
      findCircleEntry(userB, userA, personA.name),
    ]);

    // If neither user has the other in their circle, nothing to log
    if (!circleEntryA && !circleEntryB) return;

    // Emit ontology events for whichever side(s) have a circle match
    if (circleEntryA) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId: userA,
        eventType: 'message.sent',
        scopeId: circleEntryA.id,
        payload: { counterpartUserId: userB },
      });
    }
    if (circleEntryB) {
      this.events.emit(ONTOLOGY_EVENTS.RELATIONAL_INPUT, {
        userId: userB,
        eventType: 'message.sent',
        scopeId: circleEntryB.id,
        payload: { counterpartUserId: userA },
      });
    }

    // Determine the "since" timestamp: the most recent auto-logged note on either side
    const lastAutoNotes = await Promise.all([
      circleEntryA ? this.prisma.relationshipNote.findFirst({
        where: { personId: circleEntryA.id, source: 'auto_dm' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }) : null,
      circleEntryB ? this.prisma.relationshipNote.findFirst({
        where: { personId: circleEntryB.id, source: 'auto_dm' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }) : null,
    ]);

    // Use the latest auto-logged time, or circle entry createdAt as fallback
    // (NOT epoch — that would catch all historical messages and cause false positives)
    const fallbackA = circleEntryA?.createdAt || new Date();
    const fallbackB = circleEntryB?.createdAt || new Date();
    const sinceA = lastAutoNotes[0]?.createdAt || fallbackA;
    const sinceB = lastAutoNotes[1]?.createdAt || fallbackB;
    const since = sinceA > sinceB ? sinceA : sinceB;

    // Check if both directions have messages since last log.
    // Exclude mediator messages — they are AI, not a real exchange.
    const [aToBCount, bToACount] = await Promise.all([
      this.prisma.directMessage.count({
        where: {
          senderId: userA,
          receiverId: userB,
          createdAt: { gt: since },
          messageType: { not: 'mediator' },
        },
      }),
      this.prisma.directMessage.count({
        where: {
          senderId: userB,
          receiverId: userA,
          createdAt: { gt: since },
          messageType: { not: 'mediator' },
        },
      }),
    ]);

    // Both sides must have sent at least 1 message — that's a real exchange
    if (aToBCount === 0 || bToACount === 0) return;

    const now = new Date();
    const totalMsgs = aToBCount + bToACount;
    const noteContent = `Exchanged ${totalMsgs} messages with each other (auto-detected bidirectional conversation).`;

    // Log on both sides in parallel
    const ops: Promise<any>[] = [];

    if (circleEntryA) {
      ops.push(
        this.prisma.relationshipNote.create({
          data: {
            personId: circleEntryA.id, content: noteContent,
            source: 'auto_dm', sentiment: 'positive', topic: 'messaging',
          },
        }),
        this.prisma.relationshipPerson.update({
          where: { id: circleEntryA.id },
          data: { lastInteractionAt: now, interactionCount: { increment: 1 } },
        }),
      );
    }

    if (circleEntryB) {
      ops.push(
        this.prisma.relationshipNote.create({
          data: {
            personId: circleEntryB.id, content: noteContent,
            source: 'auto_dm', sentiment: 'positive', topic: 'messaging',
          },
        }),
        this.prisma.relationshipPerson.update({
          where: { id: circleEntryB.id },
          data: { lastInteractionAt: now, interactionCount: { increment: 1 } },
        }),
      );
    }

    await Promise.all(ops);
    this.logger.log(`Auto-logged bidirectional interaction: ${personA.name} <-> ${personB.name} (${totalMsgs} msgs)`);
  }

  /**
   * Get paginated message history between two users.
   */
  async getConversation(userId: string, otherUserId: string, cursor?: string, take = 50) {
    // Per-user clear-history gate: find the connection (if any) and look up
    // the requesting user's own clearedAt timestamp. Messages older than that
    // are hidden from this user only — the other party still sees everything.
    const conn = await this.prisma.connection.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, receiverId: otherUserId },
          { requesterId: otherUserId, receiverId: userId },
        ],
      },
    });
    const myClearedAt: Date | null = conn
      ? (conn.requesterId === userId
          ? (conn as any).triChatClearedAtRequester
          : (conn as any).triChatClearedAtRecipient)
      : null;

    const where: any = {
      OR: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
      ...(myClearedAt ? { createdAt: { gt: myClearedAt } } : {}),
    };

    const messages = await this.prisma.directMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: MESSAGE_INCLUDE,
    });

    const hasMore = messages.length > take;
    if (hasMore) messages.pop();

    return {
      messages: messages.reverse(),
      hasMore,
      nextCursor: hasMore ? messages[0]?.id : null,
    };
  }

  /**
   * Get conversation list for a user with last message preview and unread count.
   *
   * Performance: constant-query regardless of connection count.
   *   1. connections
   *   2. raw `DISTINCT ON (other_id)` for last message per conversation
   *   3. `groupBy` for unread counts per sender
   * (previous implementation was O(N) queries on last-message + unread-count.)
   */
  async getConversationList(userId: string) {
    // 1. All accepted connections for this user
    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      include: {
        requester: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true, lastSeenAt: true } },
        receiver: { select: { id: true, name: true, phoneNumber: true, avatarUrl: true, lastSeenAt: true } },
      },
    });

    if (connections.length === 0) return [];

    const otherIds = connections.map((c) =>
      c.requesterId === userId ? c.receiverId : c.requesterId,
    );

    // 2. Last message per conversation via PostgreSQL DISTINCT ON. The
    //    "other party" is computed per row (not userId). One round-trip.
    const lastMessages = await this.prisma.$queryRaw<
      Array<{
        other_id: string;
        id: string;
        content: string;
        createdAt: Date;
        senderId: string;
        status: string;
        deletedAt: Date | null;
        messageType: string;
      }>
    >`
      SELECT DISTINCT ON (other_id)
        CASE WHEN "sender_id" = ${userId} THEN "receiver_id" ELSE "sender_id" END AS other_id,
        "id",
        "content",
        "created_at" AS "createdAt",
        "sender_id" AS "senderId",
        "status",
        "deleted_at" AS "deletedAt",
        "message_type" AS "messageType"
      FROM "direct_messages"
      WHERE ("sender_id" = ${userId} AND "receiver_id" = ANY(${otherIds}::text[]))
         OR ("receiver_id" = ${userId} AND "sender_id" = ANY(${otherIds}::text[]))
      ORDER BY other_id, "created_at" DESC
    `;
    const lastByOther = new Map(lastMessages.map((m) => [m.other_id, m]));

    // 3. Unread counts: one groupBy across all senders
    const unreadRows = await this.prisma.directMessage.groupBy({
      by: ['senderId'],
      where: {
        receiverId: userId,
        isRead: false,
        senderId: { in: otherIds },
      },
      _count: { _all: true },
    });
    const unreadBySender = new Map(
      unreadRows.map((r) => [r.senderId, r._count._all]),
    );

    // 4. Assemble
    const conversations = connections.map((conn) => {
      const otherUser =
        conn.requesterId === userId ? conn.receiver : conn.requester;
      const lm = lastByOther.get(otherUser.id);
      const isRequester = conn.requesterId === userId;
      return {
        connectionId: conn.id,
        user: { ...otherUser, lastSeenAt: otherUser['lastSeenAt'] || null },
        lastMessage: lm
          ? {
              content: lm.deletedAt ? '' : lm.content,
              createdAt: lm.createdAt,
              senderId: lm.senderId,
              status: lm.status,
              deletedAt: lm.deletedAt,
              messageType: lm.messageType,
            }
          : null,
        unreadCount: unreadBySender.get(otherUser.id) ?? 0,
        pinned: isRequester ? conn.pinnedByRequester : conn.pinnedByReceiver,
        muted: isRequester ? conn.mutedByRequester : conn.mutedByReceiver,
        archived: isRequester ? conn.archivedByRequester : conn.archivedByReceiver,
      };
    });

    // Sort by most recent message
    return conversations.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt?.getTime() || 0;
      const bTime = b.lastMessage?.createdAt?.getTime() || 0;
      return bTime - aTime;
    });
  }

  /**
   * Mark all messages from otherUser as read.
   */
  async markAsRead(userId: string, otherUserId: string) {
    const result = await this.prisma.directMessage.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: userId,
        isRead: false,
      },
      data: { isRead: true, status: 'read' },
    });
    return { marked: result.count };
  }

  /**
   * Get total unread message count for sidebar badge.
   */
  async getTotalUnread(userId: string) {
    const count = await this.prisma.directMessage.count({
      where: { receiverId: userId, isRead: false },
    });
    return { unread: count };
  }

  /**
   * Lightweight lookup used by the gateway to scope reaction broadcasts
   * to the two participants (sender + receiver).
   */
  async getMessageParties(messageId: string) {
    return this.prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { senderId: true, receiverId: true },
    });
  }
}
