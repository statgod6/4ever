import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SharedNotesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate user belongs to this connection.
   */
  private async validateConnectionMember(userId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.status !== 'accepted') throw new ForbiddenException('Connection is not active');
    if (conn.requesterId !== userId && conn.receiverId !== userId) {
      throw new ForbiddenException('Not a member of this connection');
    }
    return conn;
  }

  /**
   * Add a shared note to a connection.
   */
  async addNote(userId: string, connectionId: string, content: string, noteType = 'general') {
    await this.validateConnectionMember(userId, connectionId);

    const note = await this.prisma.sharedNote.create({
      data: { connectionId, authorId: userId, content, noteType },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return note;
  }

  /**
   * Get all shared notes for a connection.
   */
  async getNotes(userId: string, connectionId: string, noteType?: string) {
    await this.validateConnectionMember(userId, connectionId);

    return this.prisma.sharedNote.findMany({
      where: {
        connectionId,
        ...(noteType ? { noteType } : {}),
      },
      include: {
        author: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a shared note (author only).
   */
  async deleteNote(userId: string, noteId: string) {
    const note = await this.prisma.sharedNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId !== userId) throw new ForbiddenException('Only the author can delete this note');

    await this.prisma.sharedNote.delete({ where: { id: noteId } });
    return { deleted: true };
  }

  /**
   * Get shared relationship summary between two connected users.
   * Shows mutual notes, shared rituals, connection info.
   */
  async getSharedRelationship(userId: string, connectionId: string) {
    const conn = await this.validateConnectionMember(userId, connectionId);

    const [notes, noteCount] = await Promise.all([
      this.prisma.sharedNote.findMany({
        where: { connectionId },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.sharedNote.count({ where: { connectionId } }),
    ]);

    // Get connection partner info
    const partnerId = conn.requesterId === userId ? conn.receiverId : conn.requesterId;
    const partner = await this.prisma.user.findUnique({
      where: { id: partnerId },
      select: { id: true, name: true, phoneNumber: true },
    });

    // Get message count between users
    const messageCount = await this.prisma.directMessage.count({
      where: {
        OR: [
          { senderId: userId, receiverId: partnerId },
          { senderId: partnerId, receiverId: userId },
        ],
      },
    });

    return {
      connectionId: conn.id,
      connectedSince: conn.createdAt,
      partner,
      sharedNotes: notes,
      totalNotes: noteCount,
      totalMessages: messageCount,
      notesByType: {
        general: notes.filter((n) => n.noteType === 'general').length,
        ritual_log: notes.filter((n) => n.noteType === 'ritual_log').length,
        milestone: notes.filter((n) => n.noteType === 'milestone').length,
        memory: notes.filter((n) => n.noteType === 'memory').length,
      },
    };
  }
}
