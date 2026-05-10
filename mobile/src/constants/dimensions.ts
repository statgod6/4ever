/**
 * Life Wheel — 6 dimensions, frozen taxonomy (keep in sync with backend).
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
  health: 'Body and mind — sleep, movement, nutrition',
  financial: 'Money, savings, security, earning',
  career: 'Work, craft, professional growth',
  intellectual: 'Learning, curiosity, creative thinking',
  relationships: 'Family, friends, partner, connection',
  purpose: 'Values, meaning, long-term direction',
};

export const DIMENSION_COLORS: Record<LifeDimension, string> = {
  health: '#10b981',        // emerald
  financial: '#f59e0b',     // amber
  career: '#3b82f6',        // blue
  intellectual: '#8b5cf6',  // violet
  relationships: '#ec4899', // pink
  purpose: '#06b6d4',       // cyan
};

export const DIMENSION_EMOJI: Record<LifeDimension, string> = {
  health: '💪',
  financial: '💰',
  career: '🎯',
  intellectual: '📚',
  relationships: '🤝',
  purpose: '🧭',
};
