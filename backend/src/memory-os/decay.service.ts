import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Memory Decay Engine — scheduled background job that manages memory lifecycle.
 *
 * Runs every 6 hours to:
 *  1. Decay strength of unreinforced memories (exponential decay)
 *  2. Auto-archive memories below threshold
 *  3. Reduce confidence for long-neglected memories
 *
 * Different memory types decay at different rates:
 *  - Identity: slowest (half-life ~693 days)
 *  - Goals: slow (half-life ~347 days)
 *  - Everything else: standard (half-life ~138 days)
 */
@Injectable()
export class DecayService {
  private readonly logger = new Logger(DecayService.name);

  // Decay rates (per day): ln(2) / half-life
  // Standard: 0.005 → half-life ~138 days
  // Goal: 0.002 → half-life ~347 days
  // Identity: 0.001 → half-life ~693 days
  private readonly DECAY_RATES: Record<string, number> = {
    identity: 0.001,
    goal: 0.002,
    standard: 0.005,
  };

  // Auto-archive threshold
  private readonly ARCHIVE_THRESHOLD = 0.05;

  // Confidence reduction trigger: days since last access
  private readonly CONFIDENCE_REDUCTION_DAYS = 30;
  private readonly CONFIDENCE_REDUCTION_FACTOR = 0.90; // 10% reduction

  constructor(private prisma: PrismaService) {}

  /**
   * Main decay job — runs every 6 hours.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async runDecayJob(): Promise<void> {
    this.logger.log('Starting memory decay job...');

    try {
      const [decayed, archived, confidenceReduced] = await Promise.all([
        this.applyStrengthDecay(),
        this.autoArchiveWeakMemories(),
        this.reduceNeglectedConfidence(),
      ]);

      this.logger.log(
        `Decay job complete: ${decayed} decayed, ${archived} archived, ${confidenceReduced} confidence-reduced`,
      );
    } catch (error: any) {
      this.logger.error(`Decay job failed: ${error.message}`);
    }
  }

  /**
   * Apply exponential strength decay to all active memories.
   * Formula: strength = strength * exp(-decayRate * daysSinceLastAccess)
   */
  private async applyStrengthDecay(): Promise<number> {
    try {
      // Decay identity memories (slowest)
      const identityDecayed = await this.decayByType('identity', this.DECAY_RATES.identity);

      // Decay goal memories (slow)
      const goalDecayed = await this.decayByType('goal', this.DECAY_RATES.goal);

      // Decay all other active memories (standard rate)
      const standardDecayed = await this.decayStandard(this.DECAY_RATES.standard);

      return identityDecayed + goalDecayed + standardDecayed;
    } catch (error: any) {
      this.logger.error(`Strength decay failed: ${error.message}`);
      return 0;
    }
  }

  private async decayByType(type: string, rate: number): Promise<number> {
    const result = await this.prisma.$executeRawUnsafe(
      `UPDATE memories SET
        strength = strength * EXP(-$1 * EXTRACT(EPOCH FROM (NOW() - COALESCE(last_reinforced_at, last_accessed_at, created_at))) / 86400.0)
       WHERE memory_type = $2 AND status = 'active' AND strength > $3`,
      rate, type, this.ARCHIVE_THRESHOLD,
    );
    return result;
  }

  private async decayStandard(rate: number): Promise<number> {
    const result = await this.prisma.$executeRawUnsafe(
      `UPDATE memories SET
        strength = strength * EXP(-$1 * EXTRACT(EPOCH FROM (NOW() - COALESCE(last_reinforced_at, last_accessed_at, created_at))) / 86400.0)
       WHERE memory_type NOT IN ('identity', 'goal') AND status = 'active' AND strength > $2`,
      rate, this.ARCHIVE_THRESHOLD,
    );
    return result;
  }

  /**
   * Auto-archive memories with strength below threshold.
   * Never archives goals or identity memories.
   */
  private async autoArchiveWeakMemories(): Promise<number> {
    try {
      const result = await this.prisma.$executeRawUnsafe(
        `UPDATE memories SET status = 'archived'
         WHERE status = 'active'
           AND strength < $1
           AND memory_type NOT IN ('goal', 'identity')`,
        this.ARCHIVE_THRESHOLD,
      );

      if (result > 0) {
        this.logger.log(`Auto-archived ${result} weak memories (strength < ${this.ARCHIVE_THRESHOLD})`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Auto-archive failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Reduce confidence for memories never accessed after 30+ days.
   * Confidence drops by 10% per cycle for neglected memories.
   */
  private async reduceNeglectedConfidence(): Promise<number> {
    try {
      const result = await this.prisma.$executeRawUnsafe(
        `UPDATE memories SET
          confidence = confidence * $1
         WHERE status = 'active'
           AND EXTRACT(EPOCH FROM (NOW() - last_accessed_at)) / 86400.0 > $2
           AND confidence > 0.1`,
        this.CONFIDENCE_REDUCTION_FACTOR,
        this.CONFIDENCE_REDUCTION_DAYS,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Confidence reduction failed: ${error.message}`);
      return 0;
    }
  }
}
