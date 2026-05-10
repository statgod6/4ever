import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LIFE_DIMENSIONS,
  LifeDimension,
  DIMENSION_LABELS,
  DIMENSION_DESCRIPTIONS,
  isValidDimension,
  getWeekStart,
  computeObservedScore,
} from './dimension.constants';

type DimensionSummary = {
  dimension: LifeDimension;
  label: string;
  description: string;
  selfScore: number | null;      // latest self-rating in current week, or null
  observedScore: number;         // rolling rating from signals (always produced)
  trend: 'up' | 'down' | 'flat'; // vs prior 4-week window
  signalsThisWeek: number;
  lastSelfRatedAt: Date | null;
};

type LifeWheelPayload = {
  dimensions: DimensionSummary[];
  weekStart: string;             // ISO date (Monday)
  needsWeeklyCheckin: boolean;   // true if no self-rating this week
  daysSinceCheckin: number | null;
};

@Injectable()
export class DimensionsService {
  private readonly logger = new Logger(DimensionsService.name);

  constructor(private prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /* Writes                                                              */
  /* ------------------------------------------------------------------ */

  async selfRate(userId: string, dimension: string, score: number, note?: string) {
    if (!isValidDimension(dimension)) {
      throw new BadRequestException(`Unknown dimension: ${dimension}`);
    }
    const weekStart = getWeekStart();
    return this.prisma.dimensionRating.upsert({
      where: {
        userId_dimension_source_weekStart: {
          userId,
          dimension,
          source: 'self',
          weekStart,
        },
      },
      create: { userId, dimension, source: 'self', score, note, weekStart },
      update: { score, note },
    });
  }

  async weeklyCheckin(
    userId: string,
    ratings: Record<string, number>,
    note?: string,
  ) {
    const weekStart = getWeekStart();
    const results: Array<{ dimension: string; score: number }> = [];
    for (const [dimension, scoreRaw] of Object.entries(ratings)) {
      if (!isValidDimension(dimension)) continue;
      const score = Math.max(1, Math.min(10, Math.round(Number(scoreRaw))));
      if (!Number.isFinite(score)) continue;
      await this.prisma.dimensionRating.upsert({
        where: {
          userId_dimension_source_weekStart: {
            userId,
            dimension,
            source: 'self',
            weekStart,
          },
        },
        create: { userId, dimension, source: 'self', score, note, weekStart },
        update: { score, note },
      });
      results.push({ dimension, score });
    }
    return { weekStart: weekStart.toISOString().slice(0, 10), ratings: results };
  }

  /**
   * Record a passive signal (from Core Chat extractor, actions, rituals, etc.).
   * Silently skipped if dimension is invalid.
   */
  async recordSignal(params: {
    userId: string;
    dimension: string;
    valence: number;
    source: string;
    sourceId?: string;
    summary?: string;
  }) {
    if (!isValidDimension(params.dimension)) return null;
    const valence = Math.max(-3, Math.min(3, Math.round(params.valence)));
    if (valence === 0) return null;
    const weekStart = getWeekStart();
    try {
      return await this.prisma.dimensionSignal.create({
        data: {
          userId: params.userId,
          dimension: params.dimension,
          valence,
          source: params.source,
          sourceId: params.sourceId ?? null,
          summary: params.summary ?? null,
          weekStart,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record signal: ${(err as Error).message}`);
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                               */
  /* ------------------------------------------------------------------ */

  async getLifeWheel(userId: string): Promise<LifeWheelPayload> {
    const now = new Date();
    const currentWeek = getWeekStart(now);
    const fiveWeeksAgo = new Date(currentWeek);
    fiveWeeksAgo.setUTCDate(fiveWeeksAgo.getUTCDate() - 35);

    // Load all signals in the last 5 weeks + all ratings in last 8 weeks in one go.
    const [signals, ratings] = await Promise.all([
      this.prisma.dimensionSignal.findMany({
        where: { userId, weekStart: { gte: fiveWeeksAgo } },
        select: { dimension: true, valence: true, weekStart: true },
      }),
      this.prisma.dimensionRating.findMany({
        where: { userId, source: 'self' },
        orderBy: { weekStart: 'desc' },
        take: 50,
        select: { dimension: true, score: true, weekStart: true, createdAt: true },
      }),
    ]);

    const priorWindowStart = new Date(currentWeek);
    priorWindowStart.setUTCDate(priorWindowStart.getUTCDate() - 28);

    const dimensions: DimensionSummary[] = LIFE_DIMENSIONS.map((dim) => {
      const dimSignals = signals.filter((s) => s.dimension === dim);
      const observedScore = computeObservedScore(dimSignals, now);

      const priorSignals = dimSignals.filter(
        (s) => new Date(s.weekStart).getTime() < priorWindowStart.getTime(),
      );
      const priorScore = computeObservedScore(priorSignals, priorWindowStart);
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (observedScore - priorScore > 0.5) trend = 'up';
      else if (priorScore - observedScore > 0.5) trend = 'down';

      const thisWeekRating = ratings.find(
        (r) =>
          r.dimension === dim &&
          new Date(r.weekStart).getTime() === currentWeek.getTime(),
      );
      const latestRating = ratings.find((r) => r.dimension === dim);

      const signalsThisWeek = dimSignals.filter(
        (s) => new Date(s.weekStart).getTime() === currentWeek.getTime(),
      ).length;

      return {
        dimension: dim,
        label: DIMENSION_LABELS[dim],
        description: DIMENSION_DESCRIPTIONS[dim],
        selfScore: thisWeekRating?.score ?? null,
        observedScore,
        trend,
        signalsThisWeek,
        lastSelfRatedAt: latestRating?.createdAt ?? null,
      };
    });

    const lastCheckin = ratings[0]?.createdAt ?? null;
    const daysSinceCheckin = lastCheckin
      ? Math.floor((now.getTime() - new Date(lastCheckin).getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const needsWeeklyCheckin = !ratings.some(
      (r) => new Date(r.weekStart).getTime() === currentWeek.getTime(),
    );

    return {
      dimensions,
      weekStart: currentWeek.toISOString().slice(0, 10),
      needsWeeklyCheckin,
      daysSinceCheckin,
    };
  }

  /**
   * 12-week history of observed + self scores for one dimension (trend chart).
   */
  async getHistory(userId: string, dimension: string) {
    if (!isValidDimension(dimension)) {
      throw new BadRequestException(`Unknown dimension: ${dimension}`);
    }
    const now = new Date();
    const currentWeek = getWeekStart(now);
    const startWeek = new Date(currentWeek);
    startWeek.setUTCDate(startWeek.getUTCDate() - 7 * 11); // 12 weeks inclusive

    const [signals, ratings] = await Promise.all([
      this.prisma.dimensionSignal.findMany({
        where: { userId, dimension, weekStart: { gte: startWeek } },
        select: { valence: true, weekStart: true },
      }),
      this.prisma.dimensionRating.findMany({
        where: { userId, dimension, source: 'self', weekStart: { gte: startWeek } },
        select: { score: true, weekStart: true },
      }),
    ]);

    const weeks: Array<{ weekStart: string; observed: number; self: number | null }> = [];
    for (let i = 11; i >= 0; i--) {
      const w = new Date(currentWeek);
      w.setUTCDate(w.getUTCDate() - 7 * i);
      const windowSignals = signals.filter(
        (s) => new Date(s.weekStart).getTime() <= w.getTime(),
      );
      const observed = computeObservedScore(windowSignals, w);
      const self = ratings.find(
        (r) => new Date(r.weekStart).getTime() === w.getTime(),
      );
      weeks.push({
        weekStart: w.toISOString().slice(0, 10),
        observed,
        self: self?.score ?? null,
      });
    }
    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      weeks,
    };
  }

  /**
   * Detail view: recent signals + suggested next steps for a single dimension.
   */
  async getDetail(userId: string, dimension: string) {
    if (!isValidDimension(dimension)) {
      throw new BadRequestException(`Unknown dimension: ${dimension}`);
    }
    const now = new Date();
    const currentWeek = getWeekStart(now);
    const windowStart = new Date(currentWeek);
    windowStart.setUTCDate(windowStart.getUTCDate() - 28);

    const [signals, latestRating] = await Promise.all([
      this.prisma.dimensionSignal.findMany({
        where: { userId, dimension, createdAt: { gte: windowStart } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.dimensionRating.findFirst({
        where: { userId, dimension, source: 'self' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const observed = computeObservedScore(
      signals.map((s) => ({ valence: s.valence, weekStart: s.weekStart })),
      now,
    );

    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      description: DIMENSION_DESCRIPTIONS[dimension],
      observedScore: observed,
      latestSelfScore: latestRating?.score ?? null,
      latestSelfRatedAt: latestRating?.createdAt ?? null,
      recentSignals: signals.map((s) => ({
        id: s.id,
        valence: s.valence,
        source: s.source,
        summary: s.summary,
        createdAt: s.createdAt,
      })),
    };
  }

  /**
   * Called by Core Chat context builder — surfaces nudge flag when the user
   * hasn't done their weekly check-in for 6+ days.
   */
  async needsWeeklyCheckin(userId: string): Promise<boolean> {
    const currentWeek = getWeekStart();
    const row = await this.prisma.dimensionRating.findFirst({
      where: {
        userId,
        source: 'self',
        weekStart: currentWeek,
      },
      select: { id: true },
    });
    return !row;
  }
}
