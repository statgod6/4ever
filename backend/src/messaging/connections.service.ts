import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const USER_BRIEF_SELECT = { id: true, name: true, phoneNumber: true, avatarUrl: true } as const;

@Injectable()
export class ConnectionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Search users by phone or name (exclude self).
   */
  async searchUsers(query: string, currentUserId: string) {
    if (!query || query.trim().length < 2) return [];

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        OR: [
          { phoneNumber: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: USER_BRIEF_SELECT,
      take: 20,
    });

    if (users.length === 0) return [];

    // Batch fetch all connections involving these users
    const userIds = users.map((u) => u.id);
    const connections = await this.prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: currentUserId, receiverId: { in: userIds } },
          { requesterId: { in: userIds }, receiverId: currentUserId },
        ],
      },
    });

    // Build lookup: userId -> connection
    const connMap = new Map<string, { status: string; id: string }>();
    for (const conn of connections) {
      const otherId = conn.requesterId === currentUserId ? conn.receiverId : conn.requesterId;
      connMap.set(otherId, { status: conn.status, id: conn.id });
    }

    return users.map((user) => {
      const conn = connMap.get(user.id);
      return {
        ...user,
        connectionStatus: conn?.status || null,
        connectionId: conn?.id || null,
      };
    });
  }

  /**
   * Send a connection request.
   */
  async sendRequest(requesterId: string, receiverId: string) {
    if (requesterId === receiverId) {
      throw new ConflictException('Cannot connect with yourself');
    }

    // Check if connection already exists in either direction
    const existing = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId, receiverId },
          { requesterId: receiverId, receiverId: requesterId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'accepted') {
        throw new ConflictException('Already connected');
      }
      if (existing.status === 'pending') {
        throw new ConflictException('Connection request already pending');
      }
      if (existing.status === 'rejected') {
        // Allow re-requesting after rejection
        return this.prisma.connection.update({
          where: { id: existing.id },
          data: { status: 'pending', requesterId, receiverId },
          include: {
            receiver: { select: USER_BRIEF_SELECT },
          },
        });
      }
    }

    return this.prisma.connection.create({
      data: { requesterId, receiverId, status: 'pending' },
      include: {
        receiver: { select: USER_BRIEF_SELECT },
      },
    });
  }

  /**
   * Send invite by phone — finds user or returns error.
   */
  async sendInviteByPhone(requesterId: string, phoneNumber: string) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: USER_BRIEF_SELECT,
    });

    if (!user) {
      throw new NotFoundException('No user found with that phone number. Invite them to join 4Ever!');
    }

    return this.sendRequest(requesterId, user.id);
  }

  /**
   * Accept a connection request.
   */
  async acceptRequest(userId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.receiverId !== userId) throw new NotFoundException('Connection not found');
    if (conn.status !== 'pending') throw new ConflictException('Request is not pending');

    const updated = await this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: 'accepted' },
      include: {
        requester: { select: USER_BRIEF_SELECT },
        receiver: { select: USER_BRIEF_SELECT },
      },
    });

    // Mirror each user into the other's Circle so both sides see the contact.
    // Idempotent — skips if a RelationshipPerson already links to the other user.
    await this.ensureMirrorCircleEntries(
      updated.requester,
      updated.receiver,
    );

    return updated;
  }

  /**
   * Ensure both users have a RelationshipPerson entry linking to the other.
   * Used after accepting a connection so both sides see each other in Circle.
   */
  private async ensureMirrorCircleEntries(
    a: { id: string; name: string; phoneNumber: string | null },
    b: { id: string; name: string; phoneNumber: string | null },
  ) {
    await Promise.all([
      this.ensureCircleEntry(a.id, b),
      this.ensureCircleEntry(b.id, a),
    ]);
  }

  private async ensureCircleEntry(
    ownerId: string,
    other: { id: string; name: string; phoneNumber: string | null },
  ) {
    // Already linked by user id — nothing to do.
    const existingByLink = await this.prisma.relationshipPerson.findFirst({
      where: { userId: ownerId, linkedUserId: other.id },
      select: { id: true },
    });
    if (existingByLink) return;

    // Already added manually by phone number — just link it.
    if (other.phoneNumber) {
      const last10 = other.phoneNumber.replace(/\D/g, '').slice(-10);
      if (last10.length >= 7) {
        const existingByPhone = await this.prisma.relationshipPerson.findFirst({
          where: {
            userId: ownerId,
            linkedUserId: null,
            OR: [
              { phoneNumber: other.phoneNumber },
              { phoneNumber: { endsWith: last10 } },
            ],
          },
          select: { id: true },
        });
        if (existingByPhone) {
          await this.prisma.relationshipPerson.update({
            where: { id: existingByPhone.id },
            data: { linkedUserId: other.id },
          });
          return;
        }
      }
    }

    // Create a fresh Circle entry.
    await this.prisma.relationshipPerson.create({
      data: {
        userId: ownerId,
        name: other.name || 'Contact',
        relationship: 'Contact',
        linkedUserId: other.id,
        phoneNumber: other.phoneNumber ?? null,
      },
    });
  }

  /**
   * Reject a connection request.
   */
  async rejectRequest(userId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.receiverId !== userId) throw new NotFoundException('Connection not found');

    return this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: 'rejected' },
    });
  }

  /**
   * Get all accepted connections.
   */
  async getConnections(userId: string) {
    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      include: {
        requester: { select: USER_BRIEF_SELECT },
        receiver: { select: USER_BRIEF_SELECT },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return connections.map((conn) => ({
      id: conn.id,
      user: conn.requesterId === userId ? conn.receiver : conn.requester,
      connectedAt: conn.updatedAt,
    }));
  }

  /**
   * Get incoming pending requests.
   */
  async getPendingRequests(userId: string) {
    return this.prisma.connection.findMany({
      where: { receiverId: userId, status: 'pending' },
      include: {
        requester: { select: USER_BRIEF_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Remove a connection.
   */
  async removeConnection(userId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.requesterId !== userId && conn.receiverId !== userId) {
      throw new NotFoundException('Connection not found');
    }

    await this.prisma.connection.delete({ where: { id: connectionId } });
    return { deleted: true };
  }

  /**
   * Resolve a 4Ever user by a single phone number input.
   * Handles variants: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, or plain 10-digit XXXXXXXXXX.
   * Matches by exact variants first, then falls back to last-10-digits suffix match.
   * Returns {user, connectionStatus, connectionId} — null user means not on 4Ever.
   */
  async resolvePhone(userId: string, phoneInput: string) {
    if (!phoneInput || typeof phoneInput !== 'string') {
      return { user: null, connectionStatus: null, connectionId: null };
    }
    // Strip everything except digits and leading +
    const cleaned = phoneInput.trim().replace(/[\s\-()]/g, '');
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length < 7) {
      return { user: null, connectionStatus: null, connectionId: null };
    }
    const last10 = digitsOnly.slice(-10);

    // Build candidate variants to probe for exact match.
    const variants = new Set<string>();
    variants.add(cleaned);
    variants.add(digitsOnly);
    variants.add('+' + digitsOnly);
    variants.add(last10);
    variants.add('+91' + last10);
    variants.add('91' + last10);
    variants.add('0' + last10);

    // Single query: exact match on any variant OR suffix endsWith last10 (catches all country-code formats).
    const user = await this.prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [
          { phoneNumber: { in: Array.from(variants) } },
          { phoneNumber: { endsWith: last10 } },
        ],
      },
      select: USER_BRIEF_SELECT,
    });

    if (!user) return { user: null, connectionStatus: null, connectionId: null };

    const conn = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId: userId, receiverId: user.id },
          { requesterId: user.id, receiverId: userId },
        ],
      },
      select: { id: true, status: true, requesterId: true, receiverId: true },
    });

    return {
      user,
      connectionStatus: conn?.status || null,
      connectionId: conn?.id || null,
      iAmRequester: conn ? conn.requesterId === userId : null,
    };
  }

  /**
   * Discover which phone contacts are registered on 4Ever.
   * Accepts array of phone numbers, returns matching users with connection status.
   */
  async discoverContacts(userId: string, phoneNumbers: string[]) {
    if (!phoneNumbers || phoneNumbers.length === 0) return [];

    // Normalize all phone numbers
    const normalized = phoneNumbers.map((p) => {
      let cleaned = p.replace(/[\s\-\(\)]/g, '');
      if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
      return cleaned;
    });

    // Find users matching these phone numbers (exclude self)
    const users = await this.prisma.user.findMany({
      where: {
        phoneNumber: { in: normalized },
        id: { not: userId },
      },
      select: USER_BRIEF_SELECT,
    });

    if (users.length === 0) return [];

    // Batch fetch connection statuses
    const userIds = users.map((u) => u.id);
    const connections = await this.prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, receiverId: { in: userIds } },
          { requesterId: { in: userIds }, receiverId: userId },
        ],
      },
    });

    const connMap = new Map<string, { status: string; id: string }>();
    for (const conn of connections) {
      const otherId = conn.requesterId === userId ? conn.receiverId : conn.requesterId;
      connMap.set(otherId, { status: conn.status, id: conn.id });
    }

    return users.map((user) => {
      const conn = connMap.get(user.id);
      return {
        ...user,
        connectionStatus: conn?.status || null,
        connectionId: conn?.id || null,
      };
    });
  }
}
