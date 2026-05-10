/**
 * Life Wheel — frozen taxonomy.
 *
 * Six dimensions represent the whole person. Never add/rename post-launch without
 * a migration plan: users' history is keyed on these codes.
 */
export const LIFE_DIMENSIONS = [
  'health',
  'financial',
  'career',
  'intellectual',
  'relationships',
  'purpose',
] as const;

export type LifeDimension = (typeof LIFE_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<LifeDimension, string> = {
  health: 'Health',
  financial: 'Financial',
  career: 'Career',
  intellectual: 'Intellectual',
  relationships: 'Relationships',
  purpose: 'Purpose',
};

export const DIMENSION_DESCRIPTIONS: Record<LifeDimension, string> = {
  health: 'Body and mind — sleep, movement, nutrition, mental wellbeing',
  financial: 'Money, savings, security, earning power',
  career: 'Work, craft, professional growth, meaningful contribution',
  intellectual: 'Learning, curiosity, reading, creative thinking',
  relationships: 'Family, friends, partner, social connection',
  purpose: 'Values, meaning, long-term direction, spirituality',
};

export function isValidDimension(code: string): code is LifeDimension {
  return (LIFE_DIMENSIONS as readonly string[]).includes(code);
}

/**
 * Compute the Monday of the ISO week for a given Date (UTC-based, stable key).
 * Used as the grouping key for ratings and signals.
 */
export function getWeekStart(d: Date = new Date()): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

/**
 * Rolling-window observed score.
 * - Baseline 5 (neutral).
 * - Each signal adds valence * recency_weight.
 * - recency_weight = max(0.25, 1 - weeksOld * 0.25)  → 4-week rolling window.
 * - Clamp final to [1, 10].
 */
export function computeObservedScore(
  signals: Array<{ valence: number; weekStart: Date }>,
  asOf: Date = new Date(),
): number {
  const currentWeek = getWeekStart(asOf).getTime();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let score = 5;
  for (const s of signals) {
    const weeksOld = Math.max(0, Math.floor((currentWeek - new Date(s.weekStart).getTime()) / WEEK_MS));
    if (weeksOld > 4) continue;
    const weight = Math.max(0.25, 1 - weeksOld * 0.25);
    score += s.valence * weight;
  }
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}
