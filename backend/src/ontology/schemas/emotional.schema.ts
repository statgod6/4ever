import { z } from 'zod';

/**
 * Emotional ontology — current state + short-horizon trend.
 * Unique per user (scopeId = "").
 */
export const EmotionalOntologySchema = z.object({
  currentWeather: z
    .enum(['calm', 'pressured', 'low', 'elevated', 'turbulent'])
    .default('calm'),
  moodTrend7d: z.enum(['improving', 'stable', 'declining']).default('stable'),
  energyTrend7d: z.enum(['improving', 'stable', 'declining']).default('stable'),
  activeTensions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        intensity: z.number().min(1).max(10),
        personName: z.string().nullable().optional(),
      }),
    )
    .max(10)
    .default([]),
  cooldownsExpiring: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        expiresAt: z.string(),
      }),
    )
    .max(10)
    .default([]),
  dominantTheme: z.string().nullable().optional(),
  recommendedFocus: z.string().default(''),
});

export type EmotionalOntology = z.infer<typeof EmotionalOntologySchema>;
