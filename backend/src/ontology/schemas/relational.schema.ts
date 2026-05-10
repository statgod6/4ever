import { z } from 'zod';

/**
 * Relational ontology — one snapshot per person (scopeId = personId).
 * Captures bond state, trend, and forward-looking suggestions.
 */
export const RelationalOntologySchema = z.object({
  personId: z.string(),
  name: z.string(),
  relationship: z.string(),
  bondStrength: z.number().min(0).max(1).default(0.5),
  bondTrend: z
    .enum(['strengthening', 'stable', 'drifting'])
    .default('stable'),
  driftRiskDays: z.number().min(0).default(0),
  loveLanguage: z.string().nullable().optional(),
  recurringTopics: z.array(z.string()).max(8).default([]),
  unresolvedFriction: z.array(z.string()).max(5).default([]),
  predictedNextInteraction: z.string().default(''),
  suggestedRitual: z.string().nullable().optional(),
  lastInteractionAt: z.string().nullable().optional(),
});

export type RelationalOntology = z.infer<typeof RelationalOntologySchema>;
