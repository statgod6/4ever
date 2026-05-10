import { ThoughtAnalysisStateType, PersonaPrompt, UserContextData } from '../state';
import { KnowledgeBaseService } from '../../../knowledge-base/knowledge-base.service';

/**
 * Builds a universal context string from the user's profile.
 */
function buildUniversalContext(ctx: UserContextData): string {
  const parts: string[] = [];
  if (ctx.name) parts.push(`Name: ${ctx.name}`);
  if (ctx.age) parts.push(`Age: ${ctx.age}`);
  if (ctx.location) parts.push(`Location: ${ctx.location}`);
  if (ctx.role) parts.push(`Role/Occupation: ${ctx.role}`);
  if (ctx.background) parts.push(`Background: ${ctx.background}`);
  if (ctx.currentProjects) parts.push(`Current Projects: ${ctx.currentProjects}`);
  if (ctx.goals) parts.push(`Goals: ${ctx.goals}`);
  if (ctx.situation) parts.push(`Current Situation: ${ctx.situation}`);
  if (ctx.values) parts.push(`Values & Priorities: ${ctx.values}`);
  if (ctx.pendingDecisions) parts.push(`Pending Decisions: ${ctx.pendingDecisions}`);
  if (ctx.freeformContext) parts.push(`Additional Context: ${ctx.freeformContext}`);
  return parts.join('\n');
}

/**
 * Formats a date into a human-readable string like "Apr 15, 2026"
 */
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Formats a date with time like "Apr 15, 2026 at 3:45 PM"
 */
function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/**
 * Calculates a relative time string like "3 days ago", "2 weeks ago"
 */
function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 5) return 'just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
}

/**
 * Node: build_prompts
 * Constructs persona-specific prompts with:
 * - The persona's system prompt
 * - Thread summary (if exists) for reduced context
 * - Relevant long-term memories
 * - Recent thread messages for continuity
 * - The current thought text
 */
export function createBuildPromptsNode(knowledgeBaseService?: KnowledgeBaseService) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    const personaPrompts: PersonaPrompt[] = [];
    const today = formatDate(new Date());

    for (const persona of state.personas) {
      const messages: Array<{ role: string; content: string }> = [];

      // 1. System prompt from the persona definition + current date awareness
      let systemContent = persona.systemPrompt;
      systemContent += `\n\nToday's date is ${today}. When referencing past events or memories, mention when they occurred (e.g., "Back on Apr 10..." or "Two weeks ago you mentioned..."). This helps the user track the timeline of their thinking.`;

      // 1.5. Inject universal user context (Layer 0) — the persona's briefing about the user
      if (state.userContext) {
        const contextStr = buildUniversalContext(state.userContext);
        if (contextStr) {
          systemContent += `\n\n--- About the User ---\n${contextStr}`;
        }
      }

      // 1.6. Inject calendar/planner context — the persona knows the user's schedule
      if (state.calendarContext) {
        systemContent += `\n\n--- User's Schedule ---\n${state.calendarContext}`;
      }

      // 1.7. Inject mood/energy context
      if (state.moodContext) {
        systemContent += `\n\n--- Recent Mood & Energy ---\n${state.moodContext}`;
      }

      // 1.75. Inject RAG knowledge base chunks from persona's uploaded documents
      if (knowledgeBaseService) {
        try {
          const ragChunks = await knowledgeBaseService.retrieveRelevantChunks(
            persona.id,
            state.thought.rawText,
            5,
          );
          if (ragChunks.length > 0) {
            const ragContext = ragChunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join('\n---\n');
            systemContent += `\n\n--- Reference Knowledge (from uploaded documents) ---\n${ragContext}\n\nUse the above reference material to inform your response when relevant. Cite specific information when applicable.`;
          }
        } catch (err) {
          console.error(`RAG retrieval failed for persona ${persona.id}:`, err);
        }
      }

      // 1.8. Inject task completion patterns — enables "You've skipped X 3 days in a row" observations
      if (state.completionStatsContext) {
        systemContent += `\n\n--- Task Completion Patterns (Last 14 Days) ---\n${state.completionStatsContext}`;
      }

      // 1.9. Inject pending action items from previous conversations
      if (state.pendingActionsContext) {
        systemContent += `\n\n--- Pending Action Items ---\n${state.pendingActionsContext}`;
      }

      // 2. Append summary context if available
      if (state.existingSummary) {
        systemContent += `\n\n--- Previous Discussion Summary ---\n${state.existingSummary}`;
      }

      // 3. Append relevant memories with timestamps
      if (state.memories.length > 0) {
        const memoryContext = state.memories
          .map((m) => {
            const dateStr = m.createdAt
              ? `${formatDate(m.createdAt)} (${timeAgo(m.createdAt)})`
              : 'unknown date';
            return `- [${m.memoryType}] [${dateStr}] ${m.content}`;
          })
          .join('\n');
        systemContent += `\n\n--- Relevant Past Context (with dates) ---\n${memoryContext}`;
      }

      messages.push({ role: 'system', content: systemContent });

      // 4. Add recent thread history with timestamps (up to last 10 messages)
      const recentMessages = state.threadMessages.slice(-10);
      for (const msg of recentMessages) {
        // Skip the very last user message since we'll add the thought separately
        if (msg === recentMessages[recentMessages.length - 1] && msg.role === 'user') {
          continue;
        }
        const timestamp = msg.createdAt ? `[${formatDateTime(msg.createdAt)}] ` : '';
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: `${timestamp}${msg.content}`,
        });
      }

      // 5. Add the current thought as the final user message with today's date
      messages.push({
        role: 'user',
        content: `[${today}] [Thought Type: ${state.thought.thoughtType}]\n\n${state.thought.rawText}`,
      });

      personaPrompts.push({ persona, messages });
    }

    return { personaPrompts };
  };
}
