import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { logProfileChange } from '../orchestration/graph/utils/memory-utils';
import { ONTOLOGY_EVENTS } from '../ontology/events';

const USER_PUBLIC_SELECT = {
  id: true,
  phoneNumber: true,
  name: true,
  avatarUrl: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
    return user;
  }

  /**
   * Returns just the subscription status for premium gating.
   * Used by /users/me/subscription to power frontend tab visibility.
   */
  async getSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionTier: true,
        subscriptionExpiresAt: true,
      },
    });
    if (!user) return { tier: 'free', expiresAt: null, active: false };
    const tier: string = user.subscriptionTier || 'free';
    const expiresAt: Date | null = user.subscriptionExpiresAt || null;
    const active =
      tier === 'premium' &&
      (!expiresAt || expiresAt.getTime() > Date.now());
    return { tier, expiresAt, active };
  }

  /**
   * Admin-only utility: flip a user's subscription tier.
   * Expiry is optional; null means "never expires".
   */
  async setSubscriptionTier(
    userId: string,
    tier: 'free' | 'premium',
    expiresAt: Date | null = null,
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: tier,
        subscriptionExpiresAt: expiresAt,
      },
    });
    return this.getSubscription(userId);
  }

  async findByPhone(phoneNumber: string) {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
    });
  }

  async updateProfile(userId: string, data: { name?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_PUBLIC_SELECT,
    });
  }

  /**
   * Replace the user's avatar. Removes the previous file from disk if any,
   * then stores the new public URL on the user row.
   */
  async setAvatarUrl(userId: string, avatarUrl: string) {
    await this.removePreviousAvatarFile(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: USER_PUBLIC_SELECT,
    });
  }

  /**
   * Clear the user's avatar and remove the file from disk.
   */
  async clearAvatar(userId: string) {
    await this.removePreviousAvatarFile(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: USER_PUBLIC_SELECT,
    });
  }

  private async removePreviousAvatarFile(userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    if (!existing?.avatarUrl) return;
    // avatarUrl is stored as /uploads/avatars/<filename>. Strip the leading
    // slash and join against <backend>/uploads/... (main.ts static root).
    const relative = existing.avatarUrl.replace(/^\/+/, '');
    const filePath = join(__dirname, '..', '..', relative);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      // Best-effort cleanup; ignore failures (e.g. file already gone).
    }
  }

  async getContext(userId: string) {
    return this.prisma.userContext.findUnique({
      where: { userId },
    });
  }

  /**
   * v2 Mediator: toggle relationship-health opt-in. Returns new state.
   */
  async setRelationshipHealthOptIn(userId: string, enabled: boolean) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { relationshipHealthOptIn: enabled },
      select: { id: true, relationshipHealthOptIn: true },
    });
    return { userId: updated.id, relationshipHealthOptIn: updated.relationshipHealthOptIn };
  }

  async upsertContext(userId: string, data: {
    name?: string;
    age?: string;
    location?: string;
    role?: string;
    background?: string;
    currentProjects?: string;
    goals?: string;
    situation?: string;
    values?: string;
    pendingDecisions?: string;
    freeformContext?: string;
  }) {
    // Fetch existing context for audit trail
    const existing = await this.prisma.userContext.findUnique({ where: { userId } });

    const result = await this.prisma.userContext.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    // Log changes to audit trail
    const trackableFields = ['name', 'age', 'location', 'role', 'background', 'currentProjects', 'goals', 'situation', 'values', 'pendingDecisions', 'freeformContext'];
    let changed = false;
    for (const field of trackableFields) {
      const oldVal = existing ? (existing as any)[field] : null;
      const newVal = (data as any)[field];
      if (newVal !== undefined && newVal !== oldVal) {
        changed = true;
        logProfileChange(this.prisma, userId, field, oldVal || null, newVal || '', 'manual').catch(() => {});
      }
    }

    if (changed) {
      this.events.emit(ONTOLOGY_EVENTS.SELF_INPUT, {
        userId,
        eventType: 'user_context.updated',
        payload: {},
      });
    }

    return result;
  }
}
