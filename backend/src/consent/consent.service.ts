import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tracks user acceptance of the four launch-required legal notices:
 *   - privacy_policy   (GDPR / App Store privacy)
 *   - terms_of_service (binding contract)
 *   - ai_disclosure    (AI usage + data sharing with LLM providers)
 *   - age_confirmation (COPPA 13+ attestation)
 *
 * One row per (userId, kind, version) preserves the full audit trail so we
 * can prove lawful basis at any point in time and force re-acceptance when
 * we ship a new policy version (simply bump CURRENT_VERSIONS and the
 * `isAccepted` check starts returning false for older rows).
 *
 * Enforcement is currently *reporting only* — mobile onboarding (P6) will
 * record acceptance and any dormant violations are flagged. Once the mobile
 * screens are live, flip CONSENT_ENFORCE=true in prod to block LLM calls
 * from users who haven't acked — done via UsageService, not scattered per
 * endpoint, so there's a single chokepoint.
 */
@Injectable()
export class ConsentService {
  // Bump any of these to force re-acceptance across the fleet.
  static readonly CURRENT_VERSIONS = {
    privacy_policy: '2026-05-01',
    terms_of_service: '2026-05-01',
    ai_disclosure: '2026-05-01',
    age_confirmation: '2026-05-01',
  } as const;

  static readonly REQUIRED_KINDS = [
    'privacy_policy',
    'terms_of_service',
    'ai_disclosure',
    'age_confirmation',
  ] as const;

  constructor(private prisma: PrismaService) {}

  /**
   * Record acceptance. Idempotent on (userId, kind, version): if the user
   * taps Accept twice we don't spam the audit log.
   */
  async record(
    userId: string,
    kind: string,
    opts: { version?: string; ipAddress?: string | null; userAgent?: string | null } = {},
  ) {
    const version =
      opts.version || (ConsentService.CURRENT_VERSIONS as any)[kind] || '1.0.0';
    return this.prisma.consent.upsert({
      where: { userId_kind_version: { userId, kind, version } },
      create: {
        userId,
        kind,
        version,
        ipAddress: opts.ipAddress || null,
        userAgent: opts.userAgent || null,
      },
      update: {}, // already recorded; keep original acceptedAt
    });
  }

  /**
   * Return the user's consent state, including which required notices are
   * still outstanding. Mobile calls this on app-launch and shows the legal
   * screen if `missing` is non-empty.
   */
  async getStatus(userId: string) {
    const rows = await this.prisma.consent.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
    });
    const acceptedByKind = new Map<string, { version: string; acceptedAt: Date }>();
    for (const r of rows) {
      const existing = acceptedByKind.get(r.kind);
      if (!existing || r.acceptedAt > existing.acceptedAt) {
        acceptedByKind.set(r.kind, { version: r.version, acceptedAt: r.acceptedAt });
      }
    }
    const missing: string[] = [];
    for (const kind of ConsentService.REQUIRED_KINDS) {
      const current = (ConsentService.CURRENT_VERSIONS as any)[kind];
      const accepted = acceptedByKind.get(kind);
      if (!accepted || accepted.version !== current) missing.push(kind);
    }
    return {
      accepted: Object.fromEntries(acceptedByKind),
      currentVersions: ConsentService.CURRENT_VERSIONS,
      missing,
      isComplete: missing.length === 0,
    };
  }

  /** Quick predicate used by guards / UsageService. */
  async hasAcceptedCurrent(userId: string, kind: string): Promise<boolean> {
    const version = (ConsentService.CURRENT_VERSIONS as any)[kind];
    if (!version) return true; // unknown kind — don't block
    const row = await this.prisma.consent.findUnique({
      where: { userId_kind_version: { userId, kind, version } },
    });
    return !!row;
  }
}
