import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ThoughtAnalysisStateType } from '../state';
import { createActionItemIfNew } from '../../../actions/action-dedup.util';

const logger = new Logger('ThinkingOsCoreNode');

/**
 * Node: thinking_os_core
 *
 * The "4Ever Core" meta-agent. Runs after all persona responses are saved.
 * It sees ALL persona responses together and performs three jobs:
 *
 * 1. Curate Actions — Deduplicates overlapping suggestions, merges similar items,
 *    prioritizes based on user context, produces 3-5 clean action items.
 * 2. Synthesize Responses — Produces a short "Core Synthesis" showing where
 *    personas agree, disagree, and key takeaways.
 * 3. Auto-Update User Profile — Detects new information revealed in the thought
 *    and updates UserContext fields.
 */
export function createThinkingOsCoreNode(
  prisma: PrismaService,
  openRouterApiKey: string,
  defaultModel: string,
) {
  return async (
    state: ThoughtAnalysisStateType,
  ): Promise<Partial<ThoughtAnalysisStateType>> => {
    const llm = new ChatOpenRouter({
      model: defaultModel,
      temperature: 0.2,
      maxTokens: 2048,
      apiKey: openRouterApiKey,
    });

    // Build user context string
    const uc = state.userContext;
    const userContextStr = uc
      ? [
          uc.name && `Name: ${uc.name}`,
          uc.role && `Role: ${uc.role}`,
          uc.goals && `Goals: ${uc.goals}`,
          uc.situation && `Situation: ${uc.situation}`,
          uc.values && `Values: ${uc.values}`,
          uc.pendingDecisions && `Pending Decisions: ${uc.pendingDecisions}`,
          uc.currentProjects && `Current Projects: ${uc.currentProjects}`,
        ]
          .filter(Boolean)
          .join('\n')
      : 'No user context available.';

    // Build all persona responses block
    const personaResponsesBlock = state.personaResponses
      .map(
        (r) =>
          `### ${r.personaName} (${r.personaId})\n${r.response}`,
      )
      .join('\n\n---\n\n');

    // Fetch current pending actions to avoid re-suggesting
    let existingActions: string[] = [];
    try {
      const pending = await prisma.actionItem.findMany({
        where: { userId: state.userId, status: 'pending' },
        select: { content: true },
        take: 20,
      });
      existingActions = pending.map((a) => a.content);
    } catch {
      // ignore
    }

    const existingActionsStr =
      existingActions.length > 0
        ? `\nAlready existing pending actions (DO NOT re-suggest these):\n${existingActions.map((a) => `- ${a}`).join('\n')}`
        : '';

    const systemPrompt = `You are the 4Ever Core — a meta-intelligence that synthesizes multiple advisor perspectives into unified, actionable insight. You are the user's digital twin: you know everything about them and think in their best interest.

Your job is to analyze ALL persona responses together and produce a structured JSON output with exactly three sections:

1. "synthesis" — A concise markdown summary (3-6 sentences) covering:
   - Where advisors AGREE (common themes)
   - Where they DIVERGE (conflicting advice)
   - Your KEY TAKEAWAY — the one thing the user should focus on

2. "actions" — An array of 2-5 CURATED action items. Rules:
   - Deduplicate overlapping suggestions across personas
   - Merge similar actions into one clear item
   - Prioritize based on user's current goals and situation
   - Each action has: "content" (clear 1-sentence task), "dimension" (one of: Health, Career, Relationships, Finance, Learning, Creativity, Spirituality, or null), "priority" (high, medium, low)
   - Do NOT repeat actions that already exist in the user's pending list
${existingActionsStr}

3. "profileUpdates" — An object with UserContext field updates detected from the thought. Only include fields where NEW information was clearly revealed. Valid fields: "situation", "goals", "pendingDecisions", "currentProjects", "values", "role", "background". If no updates, use an empty object {}.
   - Append to existing context, don't replace. Use format: "existing info; new info"
   - Only update when user explicitly reveals something new

Respond with ONLY valid JSON. No markdown fences, no explanation.`;

    const userPrompt = `--- User Context ---
${userContextStr}

--- User's Thought ---
Title: ${state.thought.title}
Type: ${state.thought.thoughtType}
Content: ${state.thought.rawText}

--- All Persona Responses ---
${personaResponsesBlock}

Analyze all responses and produce the unified JSON output.`;

    try {
      const result = await llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const text =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);

      // Parse JSON — try direct parse first, then extract from fences
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          logger.error('4Ever Core: Could not parse LLM response');
          return {};
        }
      }

      const synthesis: string = parsed.synthesis || '';
      const actions: Array<{
        content: string;
        dimension: string | null;
        priority: string;
      }> = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5) : [];
      const profileUpdates: Record<string, string> =
        parsed.profileUpdates && typeof parsed.profileUpdates === 'object'
          ? parsed.profileUpdates
          : {};

      // 1. Store curated actions (personaId = null → from Core)
      for (const action of actions) {
        if (action.content && typeof action.content === 'string') {
          await createActionItemIfNew(prisma, {
            userId: state.userId,
            threadId: state.thread.id,
            personaId: null,
            content: action.content,
            dimension: action.dimension || null,
          });
        }
      }

      // 2. Apply profile updates to UserContext
      const validFields = [
        'situation',
        'goals',
        'pendingDecisions',
        'currentProjects',
        'values',
        'role',
        'background',
      ];
      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(profileUpdates)) {
        if (
          validFields.includes(key) &&
          typeof value === 'string' &&
          value.trim()
        ) {
          updates[key] = value.trim();
        }
      }

      if (Object.keys(updates).length > 0) {
        // Fetch existing context to merge
        const existing = await prisma.userContext.findUnique({
          where: { userId: state.userId },
        });

        if (existing) {
          // Merge: append new info to existing fields
          const mergedData: Record<string, string> = {};
          for (const [key, newVal] of Object.entries(updates)) {
            const existingVal = (existing as any)[key] as string | null;
            if (existingVal && !existingVal.includes(newVal)) {
              mergedData[key] = `${existingVal}; ${newVal}`;
            } else if (!existingVal) {
              mergedData[key] = newVal;
            }
            // If existing already contains the new value, skip
          }

          if (Object.keys(mergedData).length > 0) {
            await prisma.userContext.update({
              where: { userId: state.userId },
              data: mergedData,
            });
          }
        } else {
          // Create new context
          await prisma.userContext.create({
            data: {
              userId: state.userId,
              ...updates,
            },
          });
        }
      }

      // 3. Store synthesis as a message in the thread (role: 'system' or special marker)
      // We save it so the frontend can retrieve it from thread data
      await prisma.message.create({
        data: {
          threadId: state.thread.id,
          role: 'assistant',
          content: synthesis,
          personaId: null,
          modelName: `core:${defaultModel}`,
        },
      });

      return {
        coreSynthesis: synthesis,
        coreActions: actions,
        profileUpdates: Object.keys(updates).length > 0 ? updates : null,
      };
    } catch (err) {
      logger.error('4Ever Core node failed:', err?.stack ?? err);
      return {
        coreSynthesis: null,
        coreActions: [],
        profileUpdates: null,
      };
    }
  };
}
