import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-tier monthly token allowances. Tuned so one premium subscriber pays for
 * themselves at OpenRouter's deepseek-v3.2 pricing while giving free users a
 * generous but abuse-proof ceiling.
 *
 * Override per-user via TokenQuota.monthlyTokenCap for VIP / beta tester rows.
 */
const TIER_CAPS: Record<string, number> = {
  free: 200_000,        // ~50 Core Chat turns/month
  premium: 2_000_000,   // ~500 Core Chat turns/month
  unlimited: 1_000_000_000, // internal / founders
};

/**
 * Rough cost table (USD per 1K tokens). These are read-only safety estimates
 * for our own dashboards — we never bill based on them. Keep in sync with
 * OpenRouter's pricing page; worst-case over-estimation is preferred.
 */
const COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
  'deepseek/deepseek-v3.2': { prompt: 0.00014, completion: 0.00028 },
  'gpt-4o-mini-tts-2025-12-15': { prompt: 0.0006, completion: 0.012 },
  default: { prompt: 0.001, completion: 0.002 },
};

export interface LogUsageInput {
  userId: string;
  endpoint: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  success?: boolean;
  errorCode?: string;
  latencyMs?: number;
  provider?: string;
}

export interface QuotaStatus {
  tokensUsed: number;
  tokensCap: number;
  tokensRemaining: number;
  periodStart: Date;
  periodEnd: Date;
  tier: string;
  hardLocked: boolean;
  overLimit: boolean;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one LlmUsage row. Fire-and-forget by design — any failure here must
   * NEVER propagate into a user-facing error path. Also rolls the quota
   * counter forward in the same transaction.
   */
  async logUsage(input: LogUsageInput): Promise<void> {
    const prompt = input.promptTokens ?? 0;
    const completion = input.completionTokens ?? 0;
    const total = prompt + completion;
    const cost = this.estimateCostUsd(input.model, prompt, completion);

    try {
      await this.prisma.$transaction([
        this.prisma.llmUsage.create({
          data: {
            userId: input.userId,
            endpoint: input.endpoint,
            provider: input.provider ?? 'openrouter',
            model: input.model,
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total,
            estimatedCostUsd: cost,
            success: input.success ?? true,
            errorCode: input.errorCode,
            latencyMs: input.latencyMs,
          },
        }),
        // Increment the rolling counter. If no quota row exists yet, skip —
        // ensureQuota() will initialize it on the next checkQuota() call.
        this.prisma.tokenQuota.updateMany({
          where: { userId: input.userId },
          data: { tokensUsedPeriod: { increment: total } },
        }),
      ]);
    } catch (err: any) {
      // Logging must never break the request. Surface to ops via standard logger.
      this.logger.warn(`logUsage failed for user=${input.userId}: ${err?.message || err}`);
    }
  }

  /**
   * Check the caller's remaining quota. Throws ForbiddenException with a
   * machine-readable code when over the limit or hard-locked.
   *
   * Called BEFORE kicking off an LLM stream. O(1) — single upsert + read.
   * If `tier` is omitted, looks up User.subscriptionTier. Falls back to 'free'.
   */
  async checkQuota(userId: string, tier?: string): Promise<QuotaStatus> {
    const effectiveTier = tier ?? (await this.lookupTier(userId));
    const status = await this.ensureQuota(userId, effectiveTier);

    if (status.hardLocked) {
      throw new ForbiddenException({
        code: 'QUOTA_HARD_LOCKED',
        message: 'This account has been temporarily restricted. Please contact support.',
      });
    }
    if (status.overLimit) {
      throw new ForbiddenException({
        code: 'QUOTA_EXCEEDED',
        message:
          tier === 'free'
            ? 'You have reached your free monthly AI usage limit. Upgrade to Premium to continue.'
            : 'You have reached your monthly AI usage limit. It resets at the start of next month.',
        quota: {
          used: status.tokensUsed,
          cap: status.tokensCap,
          resetsAt: status.periodEnd,
        },
      });
    }
    return status;
  }

  /**
   * Read-only status for /users/me/subscription and admin dashboards. Does
   * NOT throw; always returns a populated row (creates one if missing).
   */
  async getStatus(userId: string, tier?: string): Promise<QuotaStatus> {
    const effectiveTier = tier ?? (await this.lookupTier(userId));
    return this.ensureQuota(userId, effectiveTier);
  }

  /**
   * Resolve the caller's subscription tier. Premium subscription expiry is
   * enforced here so an expired subscriber auto-drops to free-tier quotas
   * without any external cron.
   */
  private async lookupTier(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    });
    if (!user) return 'free';
    if (
      user.subscriptionTier &&
      user.subscriptionTier !== 'free' &&
      user.subscriptionExpiresAt &&
      user.subscriptionExpiresAt.getTime() < Date.now()
    ) {
      return 'free';
    }
    return user.subscriptionTier || 'free';
  }

  /**
   * Upsert the user's TokenQuota row and roll the monthly window if needed.
   * Resets the counter on the 1st of each calendar month (UTC) — simple and
   * predictable; fine-grained per-user billing windows come in P6 with Stripe.
   */
  private async ensureQuota(userId: string, tier: string): Promise<QuotaStatus> {
    const cap = TIER_CAPS[tier] ?? TIER_CAPS.free;
    const now = new Date();
    const periodStart = monthStartUtc(now);
    const periodEnd = monthEndUtc(now);

    const existing = await this.prisma.tokenQuota.findUnique({ where: { userId } });

    if (!existing) {
      const created = await this.prisma.tokenQuota.create({
        data: {
          userId,
          monthlyTokenCap: cap,
          tokensUsedPeriod: 0,
          periodStart,
          lastResetAt: now,
        },
      });
      return toStatus(created, cap, periodStart, periodEnd, tier);
    }

    // Rollover: new calendar month → reset counter and tier cap.
    if (existing.periodStart < periodStart) {
      const rolled = await this.prisma.tokenQuota.update({
        where: { userId },
        data: {
          tokensUsedPeriod: 0,
          periodStart,
          lastResetAt: now,
          monthlyTokenCap: cap,
        },
      });
      return toStatus(rolled, cap, periodStart, periodEnd, tier);
    }

    // Active period — if the user upgraded mid-month, honor the higher cap.
    const effectiveCap = Math.max(existing.monthlyTokenCap, cap);
    return toStatus(existing, effectiveCap, existing.periodStart, periodEnd, tier);
  }

  private estimateCostUsd(model: string, prompt: number, completion: number): number {
    const pricing = COST_PER_1K[model] ?? COST_PER_1K.default;
    const cost = (prompt / 1000) * pricing.prompt + (completion / 1000) * pricing.completion;
    // 6-decimal precision matches the Decimal column.
    return Math.round(cost * 1_000_000) / 1_000_000;
  }
}

function toStatus(
  row: { tokensUsedPeriod: number; hardLocked: boolean; periodStart: Date },
  cap: number,
  periodStart: Date,
  periodEnd: Date,
  tier: string,
): QuotaStatus {
  return {
    tokensUsed: row.tokensUsedPeriod,
    tokensCap: cap,
    tokensRemaining: Math.max(0, cap - row.tokensUsedPeriod),
    periodStart: row.periodStart,
    periodEnd,
    tier,
    hardLocked: row.hardLocked,
    overLimit: row.tokensUsedPeriod >= cap,
  };
}

function monthStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function monthEndUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
