import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SelfSynthesizer } from './synthesizers/self.synthesizer';
import { RelationalSynthesizer } from './synthesizers/relational.synthesizer';
import { EmotionalSynthesizer } from './synthesizers/emotional.synthesizer';
import { OntologyDomain } from './events';

type Key = string; // userId|domain|scopeId

/**
 * Coordinates synthesis across domains. Debounces rapid events into a single
 * synthesis run per (user, domain, scopeId) and runs a 6h cron as safety net.
 */
@Injectable()
export class OntologySynthesisService {
  private readonly logger = new Logger(OntologySynthesisService.name);
  private readonly debounceMs = 60_000;
  private readonly timers = new Map<Key, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private selfSynth: SelfSynthesizer,
    private relationalSynth: RelationalSynthesizer,
    private emotionalSynth: EmotionalSynthesizer,
  ) {}

  /** Schedule a debounced synthesis. Subsequent calls within the window reset the timer. */
  scheduleSynthesis(
    userId: string,
    domain: OntologyDomain,
    scopeId: string | null,
  ): void {
    const key = this.keyOf(userId, domain, scopeId);
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.runSynthesis(userId, domain, scopeId).catch((err) =>
        this.logger.error(
          `Debounced synthesis failed (${key}): ${err?.message || err}`,
        ),
      );
    }, this.debounceMs);

    this.timers.set(key, timer);
  }

  /** Run a specific synthesis now. Used by backfill and cron. */
  async runSynthesis(
    userId: string,
    domain: OntologyDomain,
    scopeId: string | null,
  ): Promise<void> {
    try {
      if (domain === 'self') {
        await this.selfSynth.synthesize(userId);
      } else if (domain === 'emotional') {
        await this.emotionalSynth.synthesize(userId);
      } else if (domain === 'relational') {
        if (!scopeId) {
          this.logger.warn(
            `runSynthesis(relational) called without scopeId for user ${userId}`,
          );
          return;
        }
        await this.relationalSynth.synthesize(userId, scopeId);
      }
    } catch (err: any) {
      this.logger.error(
        `Synthesis error (${domain}/${userId}/${scopeId}): ${err?.message || err}`,
      );
    }
  }

  /**
   * Cron fallback — every 6 hours, find users/domains with unprocessed events
   * or stale (>24h) snapshots, and run synthesis.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async cronFallback(): Promise<void> {
    this.logger.log('Ontology cron fallback: scanning for stale snapshots');

    // 1. Users with unprocessed events (group by user + domain + scopeId)
    const pending = await this.prisma.ontologyEvent
      .findMany({
        where: { processed: false },
        select: { userId: true, domain: true, scopeId: true },
      })
      .catch(() => []);

    const seen = new Set<Key>();
    for (const e of pending) {
      const key = this.keyOf(e.userId, e.domain as OntologyDomain, e.scopeId);
      if (seen.has(key)) continue;
      seen.add(key);
      await this.runSynthesis(
        e.userId,
        e.domain as OntologyDomain,
        e.scopeId,
      );
    }

    // 2. Snapshots older than 24h — refresh self + emotional for active users
    const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleSnaps = await this.prisma.ontologySnapshot
      .findMany({
        where: { synthesizedAt: { lt: staleCutoff }, domain: { in: ['self', 'emotional'] } },
        select: { userId: true, domain: true, scopeId: true },
        take: 200,
      })
      .catch(() => []);

    for (const s of staleSnaps) {
      const key = this.keyOf(s.userId, s.domain as OntologyDomain, s.scopeId);
      if (seen.has(key)) continue;
      seen.add(key);
      await this.runSynthesis(
        s.userId,
        s.domain as OntologyDomain,
        s.scopeId || null,
      );
    }

    this.logger.log(
      `Ontology cron fallback done. Runs=${seen.size}`,
    );
  }

  /**
   * Nightly relational sweep — at 3am, refresh every active RelationshipPerson
   * for every user that has any ontology snapshot, so drift detection stays fresh
   * even without UI-driven refreshes.
   */
  @Cron('0 3 * * *')
  async nightlyRelationalSweep(): Promise<void> {
    this.logger.log('Ontology nightly relational sweep: starting');
    const startedAt = Date.now();
    let userCount = 0;
    let personCount = 0;

    const activeUsers = await this.prisma.ontologySnapshot
      .findMany({ select: { userId: true }, distinct: ['userId'] })
      .catch(() => [] as Array<{ userId: string }>);

    for (const { userId } of activeUsers) {
      userCount += 1;
      const people = await this.prisma.relationshipPerson
        .findMany({
          where: { userId, isActive: true },
          select: { id: true },
        })
        .catch(() => [] as Array<{ id: string }>);

      for (const p of people) {
        personCount += 1;
        await this.runSynthesis(userId, 'relational', p.id);
      }
    }

    this.logger.log(
      `Ontology nightly relational sweep done. users=${userCount} people=${personCount} ms=${Date.now() - startedAt}`,
    );
  }

  private keyOf(
    userId: string,
    domain: OntologyDomain,
    scopeId: string | null,
  ): Key {
    return `${userId}|${domain}|${scopeId || ''}`;
  }
}
