import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MediatorActionCard } from '../../mediator.service';

/**
 * Action-card tools for the mediator ReAct agent.
 *
 * Each tool pushes a MediatorActionCard into the shared `collected` array
 * passed in via closure. After the agent run completes, the caller reads
 * this array and persists it as `directMessage.mediatorActions`.
 *
 * Tool names / payload shapes mirror the old raw-OpenRouter tool schema
 * so downstream accept-flow (acceptMediatorAction) continues to work.
 */
export function createMediatorActionTools(collected: MediatorActionCard[]) {
  const suggestRitual = tool(
    async ({ label, description, cadence }) => {
      collected.push({
        type: 'suggested_ritual',
        payload: {
          label: String(label).slice(0, 80),
          description: String(description).slice(0, 200),
          cadence: ['daily', 'weekly', 'monthly'].includes(cadence) ? cadence : 'weekly',
        },
        acceptedByUserIds: [],
      });
      return `Ritual card attached: "${label}"`;
    },
    {
      name: 'suggest_ritual',
      description:
        'Propose a small recurring ritual both people could try together. Use only when a repeating pattern (e.g. weekly check-in, shared walk) would clearly help the relationship — not for one-off tasks.',
      schema: z.object({
        label: z.string().describe('Short title, max ~40 chars. e.g. "Sunday evening check-in".'),
        description: z.string().describe('One-line description of the ritual, max ~140 chars.'),
        cadence: z.enum(['daily', 'weekly', 'monthly']),
      }),
    },
  );

  const suggestTask = tool(
    async ({ label, description }) => {
      collected.push({
        type: 'suggested_task',
        payload: {
          label: String(label).slice(0, 120),
          description: description ? String(description).slice(0, 200) : '',
        },
        acceptedByUserIds: [],
      });
      return `Task card attached: "${label}"`;
    },
    {
      name: 'suggest_task',
      description:
        'Propose a one-off task one of them could add to their planner to follow through on what they just discussed.',
      schema: z.object({
        label: z.string().describe('Short task title, max ~60 chars.'),
        description: z.string().optional().describe('Optional short note, max ~140 chars.'),
      }),
    },
  );

  const logTension = tool(
    async ({ title, description, intensity }) => {
      const clamped =
        typeof intensity === 'number'
          ? Math.min(10, Math.max(1, Math.round(intensity)))
          : 5;
      collected.push({
        type: 'suggested_tension',
        payload: {
          title: String(title).slice(0, 80),
          description: String(description).slice(0, 240),
          intensity: clamped,
        },
        acceptedByUserIds: [],
      });
      return `Tension card attached: "${title}" (${clamped}/10)`;
    },
    {
      name: 'log_tension',
      description:
        'Offer to log this as a tension entry so it gets surfaced in the relationship health view. Only when there is a clear point of friction worth tracking.',
      schema: z.object({
        title: z.string().describe('Short title, max ~40 chars.'),
        description: z.string().describe('Neutral 1-sentence description of the friction.'),
        intensity: z.number().int().min(1).max(10),
      }),
    },
  );

  const markAgreement = tool(
    async ({ summary }) => {
      collected.push({
        type: 'agreement',
        payload: { summary: String(summary).slice(0, 240) },
        acceptedByUserIds: [],
      });
      return `Agreement card attached.`;
    },
    {
      name: 'mark_agreement',
      description:
        'Record that both people just agreed on something. Used to surface resolved agreements in the relationship health view. Does not create any user-facing entity on its own.',
      schema: z.object({
        summary: z.string().describe('One neutral sentence describing what was agreed.'),
      }),
    },
  );

  return [suggestRitual, suggestTask, logTension, markAgreement];
}
