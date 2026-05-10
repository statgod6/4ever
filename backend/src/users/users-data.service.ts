import { Injectable, Logger } from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GDPR / App Store "Data Export" + "Account Deletion" implementation.
 *
 * These endpoints are *legally mandatory* before the app can ship publicly:
 *   - Apple Guideline 5.1.1(v) requires an in-app way to delete an account.
 *   - Google Play Data Safety requires a user-facing delete path.
 *   - GDPR Art. 15 / 20 require export in a machine-readable format.
 *
 * The export is best-effort: every collection is fetched with try/catch so
 * a single broken table doesn't deny the user their data. Deletion relies
 * on Prisma / Postgres `onDelete: Cascade` for most tables; models without
 * an FK (OntologyEvent, OntologySnapshot) and phone-keyed OtpCode are
 * handled manually before the final `user.delete()`.
 */
@Injectable()
export class UsersDataService {
  private readonly logger = new Logger(UsersDataService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Collect the user's full data set and return a single JSON-serializable
   * object. Binary content (avatar, KW uploaded documents) is NOT included
   * here — only metadata — to keep the response size sane. A follow-up P6
   * "export v2" will bundle binaries into a zip once we move to S3.
   */
  async exportAll(userId: string): Promise<Record<string, any>> {
    const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err: any) {
        this.logger.warn(`[export:${label}] ${err?.message || err}`);
        return null;
      }
    };

    const [
      user,
      context,
      thoughts,
      personas,
      personaDocuments,
      personaChatMessages,
      memories,
      insightReports,
      dayPlans,
      dailyCheckIns,
      actionItems,
      coreChatMessages,
      coreChatSummaries,
      dimensionRatings,
      dimensionSignals,
      relationships,
      rituals,
      lifeEvents,
      tensions,
      connectionsSent,
      connectionsReceived,
      messagesSent,
      messagesReceived,
      messageReactions,
      sharedNotes,
      profileChangeLogs,
      kwConversations,
      kwDocuments,
      consents,
      tokenQuota,
      llmUsageRecent,
      ontologySnapshots,
    ] = await Promise.all([
      safe('user', () =>
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
            subscriptionTier: true,
            subscriptionExpiresAt: true,
            relationshipHealthOptIn: true,
          },
        }),
      ),
      safe('context', () => this.prisma.userContext.findUnique({ where: { userId } })),
      safe('thoughts', () =>
        this.prisma.thought.findMany({
          where: { userId },
          include: { threads: { include: { messages: true, runs: true, summary: true } } },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      safe('personas', () => this.prisma.persona.findMany({ where: { userId } })),
      safe('personaDocuments', () =>
        this.prisma.personaDocument.findMany({ where: { userId } }),
      ),
      safe('personaChatMessages', () =>
        this.prisma.personaChatMessage.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('memories', () =>
        this.prisma.memory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      ),
      safe('insightReports', () =>
        this.prisma.insightReport.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      safe('dayPlans', () =>
        this.prisma.dayPlan.findMany({
          where: { userId },
          include: { tasks: true },
          orderBy: { date: 'desc' },
        }),
      ),
      safe('dailyCheckIns', () =>
        this.prisma.dailyCheckIn.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
        }),
      ),
      safe('actionItems', () =>
        this.prisma.actionItem.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      safe('coreChatMessages', () =>
        this.prisma.coreChatMessage.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('coreChatSummaries', () =>
        this.prisma.coreChatSummary.findMany({
          where: { userId },
          orderBy: { sessionStart: 'asc' },
        }),
      ),
      safe('dimensionRatings', () =>
        this.prisma.dimensionRating.findMany({
          where: { userId },
          orderBy: { weekStart: 'asc' },
        }),
      ),
      safe('dimensionSignals', () =>
        this.prisma.dimensionSignal.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('relationships', () =>
        this.prisma.relationshipPerson.findMany({
          where: { userId },
          include: { notes: true },
        }),
      ),
      safe('rituals', () => this.prisma.relationshipRitual.findMany({ where: { userId } })),
      safe('lifeEvents', () => this.prisma.lifeEvent.findMany({ where: { userId } })),
      safe('tensions', () => this.prisma.tensionEntry.findMany({ where: { userId } })),
      safe('connectionsSent', () =>
        this.prisma.connection.findMany({ where: { requesterId: userId } }),
      ),
      safe('connectionsReceived', () =>
        this.prisma.connection.findMany({ where: { receiverId: userId } }),
      ),
      safe('messagesSent', () =>
        this.prisma.directMessage.findMany({
          where: { senderId: userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('messagesReceived', () =>
        this.prisma.directMessage.findMany({
          where: { receiverId: userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('messageReactions', () =>
        this.prisma.messageReaction.findMany({ where: { userId } }),
      ),
      safe('sharedNotes', () =>
        this.prisma.sharedNote.findMany({ where: { authorId: userId } }),
      ),
      safe('profileChangeLogs', () =>
        this.prisma.profileChangeLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      safe('kwConversations', () =>
        this.prisma.kwConversation.findMany({
          where: { userId },
          include: { messages: true },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      safe('kwDocuments', () =>
        this.prisma.kwDocument.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      safe('consents', () => this.prisma.consent.findMany({ where: { userId } })),
      safe('tokenQuota', () => this.prisma.tokenQuota.findUnique({ where: { userId } })),
      // Limit llmUsage to last 1000 records; historical cost telemetry is
      // noisy and not user-facing.
      safe('llmUsageRecent', () =>
        this.prisma.llmUsage.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 1000,
        }),
      ),
      safe('ontologySnapshots', () =>
        this.prisma.ontologySnapshot.findMany({ where: { userId } }),
      ),
    ]);

    return {
      exportMeta: {
        generatedAt: new Date().toISOString(),
        schemaVersion: '2026-05-10',
        notes:
          'Machine-readable export of all personal data associated with this ' +
          '4Ever account. Binary assets (avatar, uploaded documents) are ' +
          'referenced by URL / metadata only.',
      },
      user,
      context,
      thoughts,
      personas,
      personaDocuments,
      personaChatMessages,
      memories,
      insightReports,
      dayPlans,
      dailyCheckIns,
      actionItems,
      coreChatMessages,
      coreChatSummaries,
      dimensionRatings,
      dimensionSignals,
      relationships,
      rituals,
      lifeEvents,
      tensions,
      connectionsSent,
      connectionsReceived,
      messagesSent,
      messagesReceived,
      messageReactions,
      sharedNotes,
      profileChangeLogs,
      kwConversations,
      kwDocuments,
      consents,
      tokenQuota,
      llmUsageRecent,
      ontologySnapshots,
    };
  }

  /**
   * Cascade-delete the user and all owned data. Run inside a single
   * transaction so a mid-delete crash leaves the database in a consistent
   * state (either the user is still fully there, or fully gone).
   *
   * Must-handle-manually (no FK cascade):
   *   - OntologyEvent, OntologySnapshot — scoped by userId column only
   *   - OtpCode — keyed by phoneNumber, not userId
   *
   * Must-handle-on-disk:
   *   - avatar file under /uploads/avatars/*
   *   - KW uploaded documents (kw_documents.storagePath)
   *
   * Returns a small audit receipt the caller can show in the UI.
   */
  async deleteAccount(userId: string): Promise<{
    deleted: true;
    userId: string;
    phoneNumber: string | null;
    filesRemoved: number;
    rowsCascade: Record<string, number>;
  }> {
    // Snapshot what we need before transaction (file paths + phone for OTP cleanup).
    const snapshot = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        avatarUrl: true,
        kwDocuments: { select: { storagePath: true } },
        personaDocuments: { select: { id: true } },
      },
    });
    if (!snapshot) {
      // Already gone — idempotent.
      return {
        deleted: true,
        userId,
        phoneNumber: null,
        filesRemoved: 0,
        rowsCascade: {},
      };
    }

    // 1. Remove on-disk files (best-effort — don't abort the delete on fs errors).
    let filesRemoved = 0;
    const tryUnlink = (p: string) => {
      try {
        if (existsSync(p)) {
          unlinkSync(p);
          filesRemoved += 1;
        }
      } catch (err: any) {
        this.logger.warn(`[deleteAccount] unlink failed: ${p} ${err?.message || err}`);
      }
    };
    if (snapshot.avatarUrl) {
      const rel = snapshot.avatarUrl.replace(/^\/+/, '');
      tryUnlink(join(__dirname, '..', '..', rel));
    }
    for (const doc of snapshot.kwDocuments) {
      if (!doc.storagePath) continue;
      // storagePath may be absolute or relative — try both.
      tryUnlink(doc.storagePath);
      tryUnlink(join(__dirname, '..', '..', doc.storagePath));
    }

    // 2. Database cascade inside a transaction.
    const rowsCascade: Record<string, number> = {};
    await this.prisma.$transaction(async (tx) => {
      // No-FK scoped-by-userId tables
      const evts = await tx.ontologyEvent.deleteMany({ where: { userId } });
      rowsCascade.ontologyEvents = evts.count;
      const snaps = await tx.ontologySnapshot.deleteMany({ where: { userId } });
      rowsCascade.ontologySnapshots = snaps.count;
      // Phone-keyed auth artifacts
      if (snapshot.phoneNumber) {
        const otps = await tx.otpCode.deleteMany({
          where: { phoneNumber: snapshot.phoneNumber },
        });
        rowsCascade.otpCodes = otps.count;
      }
      // Finally, the User row — Prisma / Postgres handle the rest via
      // onDelete: Cascade (thoughts, memories, messages, reactions,
      // dim_ratings, relationships, rituals, tensions, plans, check-ins,
      // action_items, personas, kw_*, llm_usage, token_quota, consents, …).
      await tx.user.delete({ where: { id: userId } });
    });

    return {
      deleted: true,
      userId,
      phoneNumber: snapshot.phoneNumber,
      filesRemoved,
      rowsCascade,
    };
  }
}
