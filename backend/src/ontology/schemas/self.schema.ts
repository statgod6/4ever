import { z } from 'zod';

/**
 * Self ontology — stable identity + trajectory view of the user.
 * Unique per user (scopeId = "").
 */
export const SelfOntologySchema = z.object({
  identity: z.object({
    displayName: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    background: z.string().nullable().optional(),
    situation: z.string().nullable().optional(),
  }),
  values: z.array(z.string()).max(8).default([]),
  traits: z
    .array(
      z.object({
        trait: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10)
    .default([]),
  activeGoals: z
    .array(
      z.object({
        title: z.string(),
        horizon: z.string().nullable().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8)
    .default([]),
  pendingDecisions: z.array(z.string()).max(8).default([]),
  oneLineTrajectory: z.string().default(''),
  lastReviewedAt: z.string().default(() => new Date().toISOString()),
});

export type SelfOntology = z.infer<typeof SelfOntologySchema>;
