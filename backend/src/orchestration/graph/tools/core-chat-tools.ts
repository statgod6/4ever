import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateEmbedding } from '../utils/embeddings';
import { trackMemoryAccess, storeMemoryWithDedup } from '../utils/memory-utils';
import { createActionItemIfNew } from '../../../actions/action-dedup.util';
import { DimensionsService } from '../../../dimensions/dimensions.service';
import { LIFE_DIMENSIONS, DIMENSION_LABELS } from '../../../dimensions/dimension.constants';
import { MemoryManagerService } from '../../../memory-os/memory-manager.service';

/**
 * Creates the 7 internal tools for the Core Chat ReAct agent.
 * Each tool is bound to the current userId so the LLM can call them autonomously.
 */
export function createCoreChatTools(
  prisma: PrismaService,
  userId: string,
  openRouterApiKey: string,
  dimensionsService?: DimensionsService,
  memoryManager?: MemoryManagerService,
) {
  // ── 1. create_action ──────────────────────────────────────────────
  const createAction = tool(
    async ({ content, dimension, dueDate }) => {
      try {
        const item = await createActionItemIfNew(prisma, {
          userId,
          content,
          dimension: dimension || null,
          dueDate: dueDate ? new Date(dueDate + 'T00:00:00.000Z') : null,
        });
        if (!item) {
          return `Action item already exists (duplicate skipped): "${content}"`;
        }
        const dimStr = dimension ? ` [${dimension}]` : '';
        const dueStr = dueDate ? ` (due: ${dueDate})` : '';
        return `Action item created: "${content}"${dimStr}${dueStr} (id: ${item.id})`;
      } catch (err: any) {
        return `Failed to create action item: ${err.message}`;
      }
    },
    {
      name: 'create_action',
      description:
        'Create an action item on the user\'s to-do list. Use when the user asks to add a task, reminder, or action.',
      schema: z.object({
        content: z.string().describe('The action item text (clear, 1-sentence task)'),
        dimension: z
          .enum(['Health', 'Career', 'Relationships', 'Finance', 'Learning', 'Creativity', 'Spirituality'])
          .optional()
          .describe('Life dimension category, if applicable'),
        dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format, if mentioned'),
      }),
    },
  );

  // ── 2. create_thought ─────────────────────────────────────────────
  const createThought = tool(
    async ({ title, content, thoughtType }) => {
      try {
        const thought = await prisma.thought.create({
          data: {
            userId,
            title,
            rawText: content,
            thoughtType,
            status: 'open',
          },
        });

        // Auto-create thread + initial message (same pattern as ThoughtsService)
        const thread = await prisma.thoughtThread.create({
          data: {
            thoughtId: thought.id,
            threadKey: `thread-${thought.id}`,
          },
        });

        await prisma.message.create({
          data: {
            threadId: thread.id,
            role: 'user',
            content,
          },
        });

        // Fire-and-forget: generate embedding
        generateEmbedding(`${title} ${content}`, openRouterApiKey)
          .then(async (embedding) => {
            if (embedding.length > 0) {
              const vectorStr = `[${embedding.join(',')}]`;
              await prisma.$executeRawUnsafe(
                `INSERT INTO thought_embeddings (id, thought_id, embedding, created_at) VALUES (gen_random_uuid(), $1, $2::vector, NOW())`,
                thought.id,
                vectorStr,
              );
            }
          })
          .catch(() => {});

        return `Thought created: "${title}" [${thoughtType}] — ready for persona analysis. (id: ${thought.id})`;
      } catch (err: any) {
        return `Failed to create thought: ${err.message}`;
      }
    },
    {
      name: 'create_thought',
      description:
        'Create a new thought for the user to explore with personas later. Use when the user mentions something worth analyzing deeper.',
      schema: z.object({
        title: z.string().describe('Short title summarizing the thought'),
        content: z.string().describe('The full thought content'),
        thoughtType: z
          .enum([
            'business idea', 'personal decision', 'career concern',
            'emotional situation', 'relationship issue', 'research thought',
            'content idea', 'ethical dilemma', 'startup plan',
            'life choice', 'general reflection',
          ])
          .describe('Category of the thought'),
      }),
    },
  );

  // ── 3. update_profile ─────────────────────────────────────────────
  const updateProfile = tool(
    async ({ field, value }) => {
      try {
        const existing = await prisma.userContext.findUnique({ where: { userId } });

        if (existing) {
          const currentVal = (existing as any)[field] as string | null;
          // Append new info if field already has content, avoid duplicates
          const newVal =
            currentVal && !currentVal.includes(value)
              ? `${currentVal}; ${value}`
              : value;

          await prisma.userContext.update({
            where: { userId },
            data: { [field]: newVal },
          });
          return `Profile updated: ${field} = "${newVal}"`;
        } else {
          await prisma.userContext.create({
            data: { userId, [field]: value },
          });
          return `Profile created with ${field} = "${value}"`;
        }
      } catch (err: any) {
        return `Failed to update profile: ${err.message}`;
      }
    },
    {
      name: 'update_profile',
      description:
        'Update a field in the user\'s profile. Use when the user explicitly shares new personal information about themselves.',
      schema: z.object({
        field: z
          .enum([
            'name', 'age', 'situation', 'goals', 'pendingDecisions',
            'currentProjects', 'values', 'role', 'background', 'location',
            'timezone',
          ])
          .describe('The profile field to update. Use "timezone" with an IANA zone like "Asia/Kolkata" or "America/New_York" when the user tells you their timezone.'),
        value: z.string().describe('The new value for the field'),
      }),
    },
  );

  // ── 4. query_planner ──────────────────────────────────────────────
  const queryPlanner = tool(
    async ({ date }) => {
      try {
        const targetDate = date
          ? new Date(date + 'T00:00:00.000Z')
          : new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');

        const plan = await prisma.dayPlan.findFirst({
          where: {
            userId,
            date: targetDate,
          },
          include: {
            tasks: { orderBy: { sortOrder: 'asc' } },
          },
        });

        if (!plan || plan.tasks.length === 0) {
          const dateLabel = date || new Date().toISOString().split('T')[0];
          return `No tasks found for ${dateLabel}.`;
        }

        const lines = plan.tasks.map((t) => {
          const statusIcon =
            t.status === 'done' ? ' [DONE]' : t.status === 'skipped' ? ' [SKIPPED]' : '';
          return `• ${t.timeSlot}: ${t.task}${statusIcon}`;
        });

        const dateLabel = date || 'today';
        return `Schedule for ${dateLabel} (${plan.tasks.length} tasks):\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Failed to query planner: ${err.message}`;
      }
    },
    {
      name: 'query_planner',
      description:
        'Look up the user\'s day planner for a specific date. Defaults to today if no date given.',
      schema: z.object({
        date: z.string().optional().describe('Date in YYYY-MM-DD format. Omit for today.'),
      }),
    },
  );

  // ── 5. trigger_persona_analysis ───────────────────────────────────
  const triggerPersonaAnalysis = tool(
    async ({ thoughtId, personaName }) => {
      try {
        // Look up persona by name (user's own + shared library templates)
        const persona = await prisma.persona.findFirst({
          where: {
            OR: [{ userId }, { isTemplate: true }],
            name: { contains: personaName, mode: 'insensitive' },
            isActive: true,
          },
          select: { id: true, name: true, systemPrompt: true, modelName: true },
        });

        if (!persona) {
          // List available personas (user's own + shared library templates)
          const available = await prisma.persona.findMany({
            where: { OR: [{ userId }, { isTemplate: true }], isActive: true },
            select: { name: true },
          });
          const names = available.map((p) => p.name).join(', ');
          return `Persona "${personaName}" not found. Available personas: ${names || 'none'}`;
        }

        // Verify thought exists and get full content
        const thought = await prisma.thought.findFirst({
          where: { id: thoughtId, userId },
          include: { threads: true },
        });

        if (!thought) {
          return `Thought with id "${thoughtId}" not found.`;
        }

        const thread = thought.threads?.[0];

        // Build a contextual prompt for the persona (lightweight but rich)
        let systemContent = persona.systemPrompt || `You are ${persona.name}.`;
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        systemContent += `\n\nToday is ${today}.`;

        // Add user context if available
        const userContext = await prisma.userContext.findUnique({ where: { userId } }).catch(() => null);
        if (userContext) {
          const ctxParts: string[] = [];
          if (userContext.name) ctxParts.push(`Name: ${userContext.name}`);
          if (userContext.role) ctxParts.push(`Role: ${userContext.role}`);
          if (userContext.situation) ctxParts.push(`Situation: ${userContext.situation}`);
          if (userContext.goals) ctxParts.push(`Goals: ${userContext.goals}`);
          if (userContext.values) ctxParts.push(`Values: ${userContext.values}`);
          if (userContext.freeformContext) ctxParts.push(`Context: ${userContext.freeformContext}`);
          if (ctxParts.length > 0) systemContent += `\n\n--- About the User ---\n${ctxParts.join('\n')}`;
        }

        // Add thread summary if exists
        if (thread) {
          const summary = await prisma.thoughtSummary.findUnique({ where: { threadId: thread.id } }).catch(() => null);
          if (summary) systemContent += `\n\n--- Thread Summary ---\n${summary.runningSummary}`;
        }

        const userMessage = `Please analyze this thought:\n\n**Title:** ${thought.title}\n**Type:** ${thought.thoughtType}\n\n${thought.rawText}`;

        // Use raw fetch to OpenRouter (immune to LangGraph's internal AbortSignal)
        const modelName = persona.modelName || 'deepseek/deepseek-v3.2';
        let responseText = '';
        try {
          const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openRouterApiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: systemContent },
                { role: 'user', content: userMessage },
              ],
              max_tokens: 50000,
              temperature: 0.7,
            }),
          });

          if (!fetchRes.ok) {
            const errBody = await fetchRes.text().catch(() => '');
            throw new Error(`OpenRouter API error ${fetchRes.status}: ${errBody.substring(0, 200)}`);
          }

          const json = await fetchRes.json() as any;
          responseText = json?.choices?.[0]?.message?.content || '';
        } catch (llmErr: any) {
          return `Persona "${persona.name}" analysis failed (LLM error): ${llmErr.message}. The user can try again.`;
        }

        if (!responseText) {
          return `Persona "${persona.name}" returned an empty response. The user can try again.`;
        }

        // Save the persona response to DB (PersonaRun + Message)
        if (thread) {
          await prisma.personaRun.create({
            data: {
              threadId: thread.id,
              personaId: persona.id,
              inputText: thought.rawText,
              outputText: responseText,
              modelUsed: modelName,
            },
          }).catch(() => {});
          await prisma.message.create({
            data: {
              threadId: thread.id,
              role: 'assistant',
              content: responseText,
              personaId: persona.id,
              modelName,
            },
          }).catch(() => {});
        }

        // Note: We intentionally do NOT queue the full analyzeThought graph here
        // because it would create a duplicate PersonaRun. The response is already saved above.
        // Summary update and memory extraction happen through other pipelines.

        // Return the actual persona response content to Core Chat agent
        // IMPORTANT: Wrap with VERBATIM markers so the agent knows to relay exactly
        return `[VERBATIM_START]\n## ${persona.name}'s Analysis of "${thought.title}"\n\n${responseText}\n\n---\n_This analysis has been saved to the thought thread._\n[VERBATIM_END]`;
      } catch (err: any) {
        return `Failed to trigger persona analysis: ${err.message}`;
      }
    },
    {
      name: 'trigger_persona_analysis',
      description:
        'Trigger a persona to analyze a specific thought. The persona will return their FULL analysis between [VERBATIM_START] and [VERBATIM_END] markers. You MUST copy the ENTIRE content between these markers into your response EXACTLY as-is — do NOT summarize, shorten, or paraphrase it. The user expects the complete persona response.',
      schema: z.object({
        thoughtId: z.string().describe('The ID of the thought to analyze'),
        personaName: z.string().describe('Name of the persona to use (e.g., "Stoic Mentor")'),
      }),
    },
  );

  // ── 6. search_memories ────────────────────────────────────────────
  const searchMemories = tool(
    async ({ query, limit }) => {
      try {
        const maxResults = limit || 5;

        // Use MemoryManager if available (Memory OS path)
        if (memoryManager) {
          const memories = await memoryManager.retrieve(userId, query, { limit: maxResults });
          if (memories.length === 0) return 'No memories found matching that query.';

          const lines = memories.map((m) => {
            const dateStr = m.createdAt
              ? new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'unknown';
            const sim = m.similarity ? ` (relevance: ${(m.similarity * 100).toFixed(0)}%)` : '';
            const srcLabel = m.source && m.source !== 'thought' ? ` [${m.source}]` : '';
            return `- [${m.memoryType}] [${dateStr}]${srcLabel} ${m.content}${sim}`;
          });
          return `Found ${memories.length} memories:\n${lines.join('\n')}`;
        }

        // Fallback: legacy path
        const queryEmbedding = await generateEmbedding(query.substring(0, 1000), openRouterApiKey);

        if (queryEmbedding.length > 0) {
          const vectorStr = `[${queryEmbedding.join(',')}]`;
          const results: any[] = await prisma.$queryRawUnsafe(
            `SELECT m.id, m.content, m.memory_type AS "memoryType", m.created_at AS "createdAt",
                    m.source, 1 - (me.embedding <=> $1::vector) AS similarity
             FROM memories m
             JOIN memory_embeddings me ON me.memory_id = m.id
             WHERE m.user_id = $2 AND m.status = 'active'
             ORDER BY (
               0.6 * (1 - (me.embedding <=> $1::vector))
               + 0.2 * m.importance_score
               + 0.1 * LEAST(m.access_count::float / 10.0, 1.0)
               + 0.1 * GREATEST(1.0 - EXTRACT(EPOCH FROM (NOW() - m.last_accessed_at)) / 2592000.0, 0.0)
             ) DESC
             LIMIT $3`,
            vectorStr, userId, maxResults,
          );

          if (results.length > 0) {
            trackMemoryAccess(prisma, results.map((r) => r.id));
            const lines = results.map((m) => {
              const dateStr = m.createdAt
                ? new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'unknown';
              const sim = m.similarity ? ` (relevance: ${(m.similarity * 100).toFixed(0)}%)` : '';
              const srcLabel = m.source && m.source !== 'thought' ? ` [${m.source}]` : '';
              return `- [${m.memoryType}] [${dateStr}]${srcLabel} ${m.content}${sim}`;
            });
            return `Found ${results.length} memories:\n${lines.join('\n')}`;
          }
        }

        const memories = await prisma.memory.findMany({
          where: { userId, status: 'active' as any },
          orderBy: [{ importanceScore: 'desc' }, { createdAt: 'desc' }],
          take: maxResults,
        });

        if (memories.length === 0) return 'No memories found matching that query.';

        trackMemoryAccess(prisma, memories.map((m) => m.id));
        const lines = memories.map((m) => {
          const dateStr = m.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `- [${m.memoryType}] [${dateStr}] ${m.content}`;
        });
        return `Found ${memories.length} memories (by importance):\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Memory search failed: ${err.message}`;
      }
    },
    {
      name: 'search_memories',
      description:
        'Search the user\'s long-term memories using semantic similarity. Use when the user asks "what did I say about...", "do you remember...", or wants to recall past context.',
      schema: z.object({
        query: z.string().describe('What to search for in memories'),
        limit: z.number().optional().describe('Max results to return (default 5)'),
      }),
    },
  );

  // ── 7. create_checkin ─────────────────────────────────────────────
  const createCheckin = tool(
    async ({ mood, energy, note, date }) => {
      try {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dateObj = new Date(targetDate + 'T00:00:00.000Z');

        await prisma.dailyCheckIn.upsert({
          where: { userId_date: { userId, date: dateObj } },
          create: {
            userId,
            date: dateObj,
            mood,
            energy,
            note: note || null,
          },
          update: {
            mood,
            energy,
            note: note || null,
          },
        });

        const moodEmojis = ['', '😢', '😟', '😐', '🙂', '😊'];
        const energyBars = ['', '🔴', '🟠', '🟡', '🟢', '⚡'];
        const dateLabel = date ? date : 'today';
        return `Check-in logged for ${dateLabel}: Mood ${moodEmojis[mood] || mood}/5, Energy ${energyBars[energy] || energy}/5${note ? ` — "${note}"` : ''}`;
      } catch (err: any) {
        return `Failed to log check-in: ${err.message}`;
      }
    },
    {
      name: 'create_checkin',
      description:
        'Log the user\'s mood and energy for a specific day (defaults to today). Use when the user mentions how they\'re feeling, their energy level, or emotional state. Supports any date.',
      schema: z.object({
        mood: z.number().min(1).max(5).describe('Mood score 1-5 (1=very low, 5=great)'),
        energy: z.number().min(1).max(5).describe('Energy score 1-5 (1=exhausted, 5=energized)'),
        note: z.string().optional().describe('Optional note about how they feel'),
        date: z.string().optional().describe('Date in YYYY-MM-DD format. Omit for today.'),
      }),
    },
  );

  // ── 8. search_relationships ─────────────────────────────────────────
  const searchRelationships = tool(
    async ({ query, limit }) => {
      try {
        const maxResults = limit || 5;
        const people = await prisma.relationshipPerson.findMany({
          where: {
            userId,
            isActive: true,
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { relationship: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { keyContext: { contains: query, mode: 'insensitive' } },
            ],
          },
          include: {
            notes: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
          take: maxResults,
        });

        if (people.length === 0) {
          return `No one found matching "${query}" in the user's Relationship Circle.`;
        }

        const results = people.map((p) => {
          const parts: string[] = [];
          parts.push(`**${p.name}** [${p.relationship}]`);
          if (p.description) parts.push(`  About: ${p.description}`);
          if (p.dynamic) parts.push(`  Dynamic: ${p.dynamic}`);
          if (p.keyContext) parts.push(`  Context: ${p.keyContext}`);
          if (p.communicationStyle) parts.push(`  Communication: ${p.communicationStyle}`);
          if (p.notes.length > 0) {
            parts.push(`  Recent notes:`);
            p.notes.forEach((n) => {
              const dateStr = n.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              parts.push(`    - [${dateStr}] ${n.content}`);
            });
          }
          return parts.join('\n');
        });

        return `Found ${people.length} person(s):\n${results.join('\n\n')}`;
      } catch (err: any) {
        return `Relationship search failed: ${err.message}`;
      }
    },
    {
      name: 'search_relationships',
      description:
        'Search the user\'s Relationship Circle by name or relationship type. Use when the user mentions a person by name (e.g., "Dad", "Rahul", "my boss") to retrieve full context about that person and recent interaction notes.',
      schema: z.object({
        query: z.string().describe('Person name or relationship type to search for'),
        limit: z.number().optional().describe('Max results (default 5)'),
      }),
    },
  );

  // ── 9. add_relationship_note ────────────────────────────────────────
  const addRelationshipNote = tool(
    async ({ personName, note, sentiment, topic }) => {
      try {
        const person = await prisma.relationshipPerson.findFirst({
          where: {
            userId,
            isActive: true,
            name: { contains: personName, mode: 'insensitive' },
          },
        });

        if (!person) {
          const all = await prisma.relationshipPerson.findMany({
            where: { userId, isActive: true },
            select: { name: true },
          });
          const names = all.map((p) => p.name).join(', ');
          return `Person "${personName}" not found in circle. Available: ${names || 'none (circle is empty)'}`;
        }

        await prisma.relationshipNote.create({
          data: {
            personId: person.id,
            content: note,
            source: 'core_chat',
            ...(sentiment && { sentiment }),
            ...(topic && { topic }),
          },
        });

        // Update interaction tracking
        await prisma.relationshipPerson.update({
          where: { id: person.id },
          data: {
            lastInteractionAt: new Date(),
            interactionCount: { increment: 1 },
          },
        });

        const sentimentLabel = sentiment ? ` [${sentiment}]` : '';
        const topicLabel = topic ? ` (topic: ${topic})` : '';
        return `Interaction logged for ${person.name} [${person.relationship}]${sentimentLabel}${topicLabel}: "${note}"`;
      } catch (err: any) {
        return `Failed to add relationship note: ${err.message}`;
      }
    },
    {
      name: 'add_relationship_note',
      description:
        'Log an interaction note for a person in the user\'s Relationship Circle. ALWAYS use this tool when the user describes a conversation, event, or interaction with someone (e.g., "I talked to Dad about...", "Rahul and I had a disagreement..."). You MUST detect the sentiment and topic from context and include them.',
      schema: z.object({
        personName: z.string().describe('Name of the person (will fuzzy-match)'),
        note: z.string().describe('Brief note about the interaction or event'),
        sentiment: z
          .enum(['positive', 'neutral', 'negative'])
          .describe('Detected sentiment of this interaction: positive (good, supportive, happy), neutral (factual, routine), or negative (conflict, tension, worry)'),
        topic: z
          .string()
          .describe('Topic category of this interaction (e.g., career, family, support, conflict, casual, health, finances, plans)'),
      }),
    },
  );

  // ── 10. suggest_conversation_starters ──────────────────────────────
  const suggestConversationStarters = tool(
    async ({ personName, context }) => {
      try {
        const person = await prisma.relationshipPerson.findFirst({
          where: {
            userId,
            isActive: true,
            name: { contains: personName, mode: 'insensitive' },
          },
          include: {
            notes: { orderBy: { createdAt: 'desc' }, take: 5 },
            lifeEvents: { orderBy: { eventDate: 'desc' }, take: 3 },
          },
        });

        if (!person) {
          return `Person "${personName}" not found in circle.`;
        }

        const parts: string[] = [];
        parts.push(`Person: ${person.name} [${person.relationship}]`);
        if (person.description) parts.push(`About: ${person.description}`);
        if (person.dynamic) parts.push(`Dynamic: ${person.dynamic}`);
        if (person.keyContext) parts.push(`Context: ${person.keyContext}`);
        if (person.communicationStyle) parts.push(`Communication: ${person.communicationStyle}`);
        if (person.notes.length > 0) {
          parts.push('Recent interactions:');
          person.notes.forEach((n: any) => {
            const dateStr = n.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const sentiment = n.sentiment ? ` [${n.sentiment}]` : '';
            parts.push(`  - [${dateStr}]${sentiment} ${n.content}`);
          });
        }
        if (person.lifeEvents.length > 0) {
          parts.push('Life events:');
          person.lifeEvents.forEach((e: any) => {
            parts.push(`  - ${e.title} [${e.eventType}] — ${new Date(e.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
          });
        }
        if (context) parts.push(`Additional context: ${context}`);

        // Use LLM to generate conversation starters
        const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterApiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v3.2',
            messages: [
              {
                role: 'system',
                content: `You are a relationship coach. Generate 5 natural conversation starters for the user to start a meaningful conversation with this person. Base them on:
- The person's description, context, and communication style
- Recent interaction history and topics
- Upcoming life events
- The current dynamic between user and person

Make them specific, warm, and natural — not generic. If there are upcoming events or recent topics, weave them in. Format as a numbered list.`,
              },
              { role: 'user', content: parts.join('\n') },
            ],
            max_tokens: 512,
            temperature: 0.8,
          }),
        });

        if (!fetchRes.ok) throw new Error(`LLM error: ${fetchRes.status}`);
        const json = await fetchRes.json() as any;
        const startersText = json?.choices?.[0]?.message?.content || 'Could not generate starters.';

        return `Conversation starters for ${person.name}:\n\n${startersText}`;
      } catch (err: any) {
        return `Failed to suggest conversation starters: ${err.message}`;
      }
    },
    {
      name: 'suggest_conversation_starters',
      description:
        'Generate personalized conversation starters for a person in the user\'s circle. Uses their relationship context, recent interactions, and life events to suggest natural talking points.',
      schema: z.object({
        personName: z.string().describe('Name of the person to generate starters for'),
        context: z.string().optional().describe('Additional context like "we haven\'t talked in a while" or "planning a birthday"'),
      }),
    },
  );

  // ── 11. search_connections ──────────────────────────────────────────
  const searchConnections = tool(
    async ({ query }) => {
      try {
        const connections = await prisma.connection.findMany({
          where: {
            status: 'accepted',
            OR: [{ requesterId: userId }, { receiverId: userId }],
          },
          include: {
            requester: { select: { id: true, name: true } },
            receiver: { select: { id: true, name: true } },
          },
        });

        let results = connections.map((c) => {
          const other = c.requesterId === userId ? c.receiver : c.requester;
          return {
            connectionId: c.id,
            name: other.name,
            userId: other.id,
            connectedAt: c.updatedAt.toISOString().split('T')[0],
          };
        });

        if (query) {
          const q = query.toLowerCase();
          results = results.filter(
            (r) => r.name.toLowerCase().includes(q),
          );
        }

        if (results.length === 0) return 'No connections found' + (query ? ` matching "${query}"` : '') + '.';
        return results.map((r) => `• ${r.name} — connected since ${r.connectedAt}`).join('\n');
      } catch (err: any) {
        return `Error searching connections: ${err.message}`;
      }
    },
    {
      name: 'search_connections',
      description: 'Search or list the user\'s 4Ever connections. Optionally filter by name.',
      schema: z.object({
        query: z.string().optional().describe('Optional name to filter by'),
      }),
    },
  );

  // ── 12. send_message ──────────────────────────────────────────────
  const sendMessage = tool(
    async ({ receiverName, content }) => {
      try {
        // Find connection by fuzzy name match
        const connections = await prisma.connection.findMany({
          where: {
            status: 'accepted',
            OR: [{ requesterId: userId }, { receiverId: userId }],
          },
          include: {
            requester: { select: { id: true, name: true } },
            receiver: { select: { id: true, name: true } },
          },
        });

        const match = connections.find((c) => {
          const other = c.requesterId === userId ? c.receiver : c.requester;
          return other.name.toLowerCase().includes(receiverName.toLowerCase());
        });

        if (!match) {
          return `No connection found matching "${receiverName}". The user can only message people they\'re connected with on 4Ever.`;
        }

        const receiverId = match.requesterId === userId ? match.receiverId : match.requesterId;
        const receiverActualName = match.requesterId === userId ? match.receiver.name : match.requester.name;

        const msg = await prisma.directMessage.create({
          data: {
            senderId: userId,
            receiverId,
            content,
          },
        });

        return `Message sent to ${receiverActualName}: "${content.substring(0, 100)}" (id: ${msg.id})`;
      } catch (err: any) {
        return `Error sending message: ${err.message}`;
      }
    },
    {
      name: 'send_message',
      description: 'Send a direct message to a connected user on 4Ever. Use the receiver\'s name (fuzzy match supported).',
      schema: z.object({
        receiverName: z.string().describe('Name of the connected user to message'),
        content: z.string().describe('The message content to send'),
      }),
    },
  );

  // ── 13. get_unread_messages ──────────────────────────────────────────
  const getUnreadMessages = tool(
    async () => {
      try {
        const unread = await prisma.directMessage.findMany({
          where: { receiverId: userId, isRead: false },
          include: { sender: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        });

        if (unread.length === 0) return 'No unread messages.';

        const bySender: Record<string, { count: number; latest: string; time: string }> = {};
        for (const msg of unread) {
          const name = msg.sender.name;
          if (!bySender[name]) {
            bySender[name] = {
              count: 0,
              latest: msg.content.substring(0, 100),
              time: msg.createdAt.toLocaleString(),
            };
          }
          bySender[name].count++;
        }

        const lines = Object.entries(bySender).map(
          ([name, { count, latest, time }]) =>
            `• ${name}: ${count} unread — latest (${time}): "${latest}"`,
        );

        return `${unread.length} total unread message(s):\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Error fetching unread messages: ${err.message}`;
      }
    },
    {
      name: 'get_unread_messages',
      description: 'Check the user\'s unread direct messages with count and preview per sender.',
      schema: z.object({}),
    },
  );

  // ── 14. search_knowledge_base ──────────────────────────────────────
  const searchKnowledgeBase = tool(
    async ({ query, personaName, topK }) => {
      try {
        const maxResults = topK || 5;

        // Find accessible personas (user's own + shared library templates)
        const whereClause: any = {
          OR: [{ userId }, { isTemplate: true }],
          isActive: true,
        };
        if (personaName) {
          whereClause.name = { contains: personaName, mode: 'insensitive' };
        }

        const personas = await prisma.persona.findMany({
          where: whereClause,
          select: { id: true, name: true },
        });

        if (personas.length === 0) {
          return personaName
            ? `No persona found matching "${personaName}". Try without a persona filter.`
            : 'No personas found. The user has not created any personas yet.';
        }

        // Generate query embedding
        const embedding = await generateEmbedding(query.substring(0, 1000), openRouterApiKey);
        if (embedding.length === 0) return 'Failed to generate embedding for the query.';

        const personaIds = personas.map((p) => p.id);
        const personaMap = new Map(personas.map((p) => [p.id, p.name]));

        // Search across all matching personas' document chunks via pgvector
        const vectorStr = `[${embedding.join(',')}]`;
        const results: any[] = await prisma.$queryRawUnsafe(
          `SELECT dc.content, dc.persona_id AS "personaId",
                  pd.filename,
                  1 - (dc.embedding <=> $1::vector) AS similarity
           FROM document_chunks dc
           JOIN persona_documents pd ON pd.id = dc.document_id
           WHERE dc.persona_id = ANY($2::text[])
             AND dc.embedding IS NOT NULL
           ORDER BY dc.embedding <=> $1::vector
           LIMIT $3`,
          vectorStr,
          personaIds,
          maxResults,
        );

        // Filter by minimum similarity
        const filtered = results.filter((r) => r.similarity > 0.3);

        if (filtered.length === 0) {
          return 'No relevant knowledge base content found for that query.' +
            (personaName ? ` Searched in: ${personaName}` : ` Searched across ${personas.length} persona(s).`);
        }

        const lines = filtered.map((r, i) => {
          const pName = personaMap.get(r.personaId) || 'Unknown';
          const sim = (r.similarity * 100).toFixed(0);
          const snippet = r.content.substring(0, 300);
          return `[${i + 1}] (${pName} / ${r.filename}) [${sim}% match]\n${snippet}`;
        });

        return `Found ${filtered.length} relevant chunk(s):\n\n${lines.join('\n---\n')}`;
      } catch (err: any) {
        return `Knowledge base search failed: ${err.message}`;
      }
    },
    {
      name: 'search_knowledge_base',
      description:
        'Search the user\'s persona knowledge bases (uploaded PDF documents) using semantic similarity. ' +
        'Searches across all personas by default, or filter by persona name. ' +
        'Use when the user asks about content from their uploaded documents or reference materials.',
      schema: z.object({
        query: z.string().describe('What to search for in the knowledge base documents'),
        personaName: z.string().optional().describe('Optional persona name to search only that persona\'s documents'),
        topK: z.number().optional().describe('Max results to return (default 5)'),
      }),
    },
  );

  // ── 15. get_conversation_history ──────────────────────────────────
  const getConversationHistory = tool(
    async ({ personName, limit, sinceDaysAgo }) => {
      try {
        const maxMessages = Math.min(limit || 20, 50); // Hard cap at 50 to control token usage

        // Find the connected user by fuzzy name match
        const connections = await prisma.connection.findMany({
          where: {
            status: 'accepted',
            OR: [{ requesterId: userId }, { receiverId: userId }],
          },
          include: {
            requester: { select: { id: true, name: true } },
            receiver: { select: { id: true, name: true } },
          },
        });

        const match = connections.find((c) => {
          const other = c.requesterId === userId ? c.receiver : c.requester;
          return other.name.toLowerCase().includes(personName.toLowerCase());
        });

        if (!match) {
          return `No connection found matching "${personName}". The user can only view messages with people they're connected with.`;
        }

        const otherId = match.requesterId === userId ? match.receiverId : match.requesterId;
        const otherName = match.requesterId === userId ? match.receiver.name : match.requester.name;

        // Build date filter
        const whereClause: any = {
          OR: [
            { senderId: userId, receiverId: otherId },
            { senderId: otherId, receiverId: userId },
          ],
        };
        if (sinceDaysAgo) {
          const since = new Date();
          since.setDate(since.getDate() - sinceDaysAgo);
          whereClause.createdAt = { gte: since };
        }

        const messages = await prisma.directMessage.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: maxMessages,
          include: { sender: { select: { name: true } } },
        });

        if (messages.length === 0) {
          const timeNote = sinceDaysAgo ? ` in the last ${sinceDaysAgo} day(s)` : '';
          return `No messages found with ${otherName}${timeNote}.`;
        }

        // Reverse to chronological order for readability
        messages.reverse();

        const lines = messages.map((m) => {
          const time = m.createdAt.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          const read = m.receiverId === userId && !m.isRead ? ' [unread]' : '';
          // Truncate individual messages to 200 chars to control token usage
          const content = m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content;
          return `[${time}] ${m.sender.name}: ${content}${read}`;
        });

        const showing = messages.length === maxMessages ? ` (showing last ${maxMessages})` : '';
        return `Conversation with ${otherName}${showing}:\n\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Error fetching conversation history: ${err.message}`;
      }
    },
    {
      name: 'get_conversation_history',
      description:
        'Retrieve recent message history with a specific connected user. ' +
        'Returns the most recent messages in chronological order. ' +
        'Use when the user asks "what did X say?", "show me my chat with X", or "what were we talking about?".',
      schema: z.object({
        personName: z.string().describe('Name of the connected person to get chat history with'),
        limit: z.number().optional().describe('Number of recent messages to retrieve (default 20, max 50)'),
        sinceDaysAgo: z.number().optional().describe('Only show messages from the last N days (e.g., 1 for today, 7 for this week)'),
      }),
    },
  );

  // ── 16. search_messages ──────────────────────────────────────────
  const searchMessages = tool(
    async ({ query, sinceDaysAgo, limit }) => {
      try {
        const maxResults = Math.min(limit || 15, 30);

        // Build where clause: messages the user sent or received
        const whereClause: any = {
          OR: [{ senderId: userId }, { receiverId: userId }],
          content: { contains: query, mode: 'insensitive' },
        };

        if (sinceDaysAgo) {
          const since = new Date();
          since.setDate(since.getDate() - sinceDaysAgo);
          whereClause.createdAt = { gte: since };
        }

        const messages = await prisma.directMessage.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: maxResults,
          include: {
            sender: { select: { name: true } },
            receiver: { select: { name: true } },
          },
        });

        if (messages.length === 0) {
          const timeNote = sinceDaysAgo ? ` in the last ${sinceDaysAgo} day(s)` : '';
          return `No messages found containing "${query}"${timeNote}.`;
        }

        // Reverse to chronological
        messages.reverse();

        const lines = messages.map((m) => {
          const time = m.createdAt.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          const otherName = m.senderId === userId ? m.receiver.name : m.sender.name;
          const direction = m.senderId === userId ? 'You →' : `${m.sender.name} → You`;
          const content = m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content;
          return `[${time}] ${direction}: ${content}`;
        });

        return `Found ${messages.length} message(s) matching "${query}":\n\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Error searching messages: ${err.message}`;
      }
    },
    {
      name: 'search_messages',
      description:
        'Search across ALL the user\'s direct message conversations by keyword. ' +
        'Use when the user asks "has anyone talked to me about X?", "find messages about Y", ' +
        'or wants to find a specific topic discussed in any conversation.',
      schema: z.object({
        query: z.string().describe('Keyword or phrase to search for in message content'),
        sinceDaysAgo: z.number().optional().describe('Only search messages from the last N days'),
        limit: z.number().optional().describe('Max results to return (default 15, max 30)'),
      }),
    },
  );

  // ── 17. add_to_circle ───────────────────────────────────────────
  const addToCircle = tool(
    async ({ name, relationship, description, dynamic, keyContext, communicationStyle, loveLanguage }) => {
      try {
        const person = await prisma.relationshipPerson.create({
          data: {
            userId,
            name,
            relationship,
            description: description || null,
            dynamic: dynamic || null,
            keyContext: keyContext || null,
            communicationStyle: communicationStyle || null,
            loveLanguage: loveLanguage || null,
          },
        });
        return `Added ${name} to your circle as your ${relationship}! (id: ${person.id})`;
      } catch (err: any) {
        return `Failed to add to circle: ${err.message}`;
      }
    },
    {
      name: 'add_to_circle',
      description: 'Add a new person to the user\'s Relationship Circle. Use when the user says "add X as my Y" or mentions wanting to track a relationship.',
      schema: z.object({
        name: z.string().describe('Person\'s name'),
        relationship: z.string().describe('Relationship type: Parent, Friend, Colleague, Partner, Sibling, Mentor, etc.'),
        description: z.string().optional().describe('Who they are, personality traits'),
        dynamic: z.string().optional().describe('The user\'s dynamic with this person'),
        keyContext: z.string().optional().describe('Their job, interests, values, recent events'),
        communicationStyle: z.string().optional().describe('How they communicate'),
        loveLanguage: z.enum(['words_of_affirmation', 'acts_of_service', 'receiving_gifts', 'quality_time', 'physical_touch']).optional().describe('Their love language'),
      }),
    },
  );

  // ── 18. update_circle_person ────────────────────────────────────
  const updateCirclePerson = tool(
    async ({ personName, relationship, description, dynamic, keyContext, communicationStyle, loveLanguage }) => {
      try {
        // Find person by fuzzy name match
        const person = await prisma.relationshipPerson.findFirst({
          where: { userId, isActive: true, name: { contains: personName, mode: 'insensitive' } },
        });
        if (!person) return `No one named "${personName}" found in your circle.`;

        const updates: any = {};
        if (relationship) updates.relationship = relationship;
        if (description) updates.description = description;
        if (dynamic) updates.dynamic = dynamic;
        if (keyContext) updates.keyContext = keyContext;
        if (communicationStyle) updates.communicationStyle = communicationStyle;
        if (loveLanguage) updates.loveLanguage = loveLanguage;

        if (Object.keys(updates).length === 0) return 'No fields to update were provided.';

        await prisma.relationshipPerson.update({ where: { id: person.id }, data: updates });
        const fields = Object.keys(updates).join(', ');
        return `Updated ${person.name}\'s profile (${fields}).`;
      } catch (err: any) {
        return `Failed to update circle person: ${err.message}`;
      }
    },
    {
      name: 'update_circle_person',
      description: 'Update details of someone in the user\'s Relationship Circle. Use when the user says "change X\'s relationship to Y" or provides new info about someone.',
      schema: z.object({
        personName: z.string().describe('Name of the person in the circle to update'),
        relationship: z.string().optional().describe('New relationship type'),
        description: z.string().optional().describe('Updated description'),
        dynamic: z.string().optional().describe('Updated dynamic'),
        keyContext: z.string().optional().describe('Updated key context'),
        communicationStyle: z.string().optional().describe('Updated communication style'),
        loveLanguage: z.enum(['words_of_affirmation', 'acts_of_service', 'receiving_gifts', 'quality_time', 'physical_touch']).optional().describe('Updated love language'),
      }),
    },
  );

  // ── 19. add_ritual ─────────────────────────────────────────────
  const addRitual = tool(
    async ({ title, frequency, personName, dayOfWeek }) => {
      try {
        let personId: string | null = null;
        if (personName) {
          const person = await prisma.relationshipPerson.findFirst({
            where: { userId, isActive: true, name: { contains: personName, mode: 'insensitive' } },
          });
          if (person) personId = person.id;
          else return `No one named "${personName}" found in your circle. Add them first.`;
        }

        const ritual = await prisma.relationshipRitual.create({
          data: {
            userId,
            title,
            frequency,
            personId,
            dayOfWeek: dayOfWeek ?? null,
          },
          include: { person: { select: { name: true } } },
        });

        const personNote = ritual.person ? ` (linked to ${ritual.person.name})` : '';
        const dayNote = dayOfWeek !== undefined ? ` on ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]}` : '';
        return `Ritual created: "${title}" — ${frequency}${dayNote}${personNote} (id: ${ritual.id})`;
      } catch (err: any) {
        return `Failed to create ritual: ${err.message}`;
      }
    },
    {
      name: 'add_ritual',
      description: 'Create a relationship ritual (recurring activity). Use when the user says "remind me to call X every week" or "I want to text Y daily".',
      schema: z.object({
        title: z.string().describe('What the ritual is, e.g., "Call Mom", "Date night with partner"'),
        frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).describe('How often'),
        personName: z.string().optional().describe('Name of the person in the circle to link this ritual to'),
        dayOfWeek: z.number().min(0).max(6).optional().describe('Day of week for weekly rituals: 0=Sun, 1=Mon, ..., 6=Sat'),
      }),
    },
  );

  // ── 20. add_life_event ─────────────────────────────────────────
  const addLifeEvent = tool(
    async ({ title, eventDate, eventType, personName, isRecurring, remindDaysBefore, note }) => {
      try {
        let personId: string | null = null;
        if (personName) {
          const person = await prisma.relationshipPerson.findFirst({
            where: { userId, isActive: true, name: { contains: personName, mode: 'insensitive' } },
          });
          if (person) personId = person.id;
          else return `No one named "${personName}" found in your circle. Add them first.`;
        }

        const event = await prisma.lifeEvent.create({
          data: {
            userId,
            title,
            eventDate: new Date(eventDate + 'T00:00:00.000Z'),
            eventType,
            personId,
            isRecurring: isRecurring ?? false,
            remindDaysBefore: remindDaysBefore ?? 1,
            note: note || null,
          },
          include: { person: { select: { name: true } } },
        });

        const personNote = event.person ? ` (for ${event.person.name})` : '';
        const recurNote = isRecurring ? ' [recurring yearly]' : '';
        return `Life event created: "${title}" on ${eventDate} [${eventType}]${personNote}${recurNote} (id: ${event.id})`;
      } catch (err: any) {
        return `Failed to create life event: ${err.message}`;
      }
    },
    {
      name: 'add_life_event',
      description: 'Add a life event or milestone for someone in the circle. Use for birthdays, anniversaries, surgeries, interviews, moves, etc.',
      schema: z.object({
        title: z.string().describe('Event title, e.g., "Abhinav\'s Birthday"'),
        eventDate: z.string().describe('Event date in YYYY-MM-DD format'),
        eventType: z.string().describe('Type: birthday, anniversary, surgery, interview, move, graduation, wedding, etc.'),
        personName: z.string().optional().describe('Name of the person in the circle to link this event to'),
        isRecurring: z.boolean().optional().describe('Whether this repeats yearly (e.g., birthdays). Default false.'),
        remindDaysBefore: z.number().optional().describe('How many days before to remind. Default 1.'),
        note: z.string().optional().describe('Additional notes about the event'),
      }),
    },
  );

  // ── 21. add_plan_task ─────────────────────────────────────────────
  const addPlanTask = tool(
    async ({ date, timeSlot, task, force }) => {
      try {
        const dateObj = new Date(date + 'T00:00:00.000Z');

        // Upsert day plan
        const plan = await prisma.dayPlan.upsert({
          where: { userId_date: { userId, date: dateObj } },
          create: { userId, date: dateObj },
          update: { updatedAt: new Date() },
        });

        // Normalize text for duplicate detection
        const normalize = (s: string) =>
          (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
        const normalizeTime = (s: string) =>
          (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

        const normTask = normalize(task);
        const normTime = normalizeTime(timeSlot);

        // Fetch all existing tasks for this day
        const existing = await prisma.planTask.findMany({
          where: { planId: plan.id },
          orderBy: { sortOrder: 'asc' },
        });

        // Check 1: exact duplicate (same task text + same time slot)
        const exactDup = existing.find(
          (t) => normalize(t.task) === normTask && normalizeTime(t.timeSlot || '') === normTime,
        );
        if (exactDup && !force) {
          return `DUPLICATE: The task "${exactDup.task}" is already on your planner for ${date} at ${exactDup.timeSlot}. I did not add it again. Let the user know they already have this entry.`;
        }

        // Check 2: same task text on same day (any time) — likely duplicate
        const sameTaskDup = existing.find((t) => normalize(t.task) === normTask);
        if (sameTaskDup && !force) {
          return `DUPLICATE: You already have "${sameTaskDup.task}" scheduled on ${date} at ${sameTaskDup.timeSlot}. I did not add a second copy. Tell the user they already have this entry — they can confirm if they want a duplicate anyway (pass force=true).`;
        }

        // Check 3: time-slot conflict (same time, different task)
        const timeConflict = existing.find((t) => normalizeTime(t.timeSlot || '') === normTime);
        if (timeConflict && !force) {
          return `TIME_CONFLICT: You already have "${timeConflict.task}" scheduled at ${timeConflict.timeSlot} on ${date}. I did not add "${task}" to avoid double-booking that time slot. Tell the user about the conflict and ask if they want to (a) replace the existing task, (b) pick a different time, or (c) add it anyway (force=true).`;
        }

        const newTask = await prisma.planTask.create({
          data: {
            planId: plan.id,
            timeSlot,
            task,
            sortOrder: existing.length,
          },
        });

        return `Task added to planner for ${date}: "${task}" at ${timeSlot} (id: ${newTask.id})`;
      } catch (err: any) {
        return `Failed to add plan task: ${err.message}`;
      }
    },
    {
      name: 'add_plan_task',
      description:
        'Add a task to the user\'s day planner for a specific date. Use when the user says "plan X for tomorrow", "add Y to my schedule on Monday", etc. This tool automatically checks for (1) exact duplicates, (2) same-task-already-on-same-day, and (3) time-slot conflicts, and refuses to add in those cases. If the tool returns DUPLICATE or TIME_CONFLICT, inform the user and ask for their decision — only re-call with force=true if the user explicitly confirms they want to add it despite the warning.',
      schema: z.object({
        date: z.string().describe('Date in YYYY-MM-DD format (required)'),
        timeSlot: z.string().describe('Time slot like "9:00 AM", "2:30 PM", "Morning", "Evening"'),
        task: z.string().describe('The task description'),
        force: z
          .boolean()
          .optional()
          .describe('Set to true ONLY after the user explicitly confirms they want to add despite a duplicate or time-conflict warning. Never set true on the first attempt.'),
      }),
    },
  );

  // ── 22. delete_plan_task ──────────────────────────────────────────
  const deletePlanTask = tool(
    async ({ date, taskName }) => {
      try {
        const dateObj = new Date(date + 'T00:00:00.000Z');

        const plan = await prisma.dayPlan.findUnique({
          where: { userId_date: { userId, date: dateObj } },
          include: { tasks: true },
        });

        if (!plan || plan.tasks.length === 0) {
          return `No tasks found on ${date}.`;
        }

        // Fuzzy match task by name
        const match = plan.tasks.find(
          (t) => t.task.toLowerCase().includes(taskName.toLowerCase()) ||
                 taskName.toLowerCase().includes(t.task.toLowerCase()),
        );

        if (!match) {
          const available = plan.tasks.map((t) => `"${t.task}" at ${t.timeSlot}`).join(', ');
          return `No task matching "${taskName}" found on ${date}. Tasks: ${available}`;
        }

        await prisma.planTask.delete({ where: { id: match.id } });
        return `Deleted task "${match.task}" (${match.timeSlot}) from ${date}.`;
      } catch (err: any) {
        return `Failed to delete plan task: ${err.message}`;
      }
    },
    {
      name: 'delete_plan_task',
      description:
        'Remove a task from the user\'s day planner. Use when the user says "remove X from my plan", "cancel the meeting tomorrow", etc.',
      schema: z.object({
        date: z.string().describe('Date in YYYY-MM-DD format'),
        taskName: z.string().describe('Name/description of the task to remove (fuzzy matched)'),
      }),
    },
  );

  // ── 23. create_persona ────────────────────────────────────────────
  const createPersona = tool(
    async ({ name, description, systemPrompt }) => {
      try {
        const persona = await prisma.persona.create({
          data: {
            userId,
            name,
            description: description || null,
            systemPrompt,
            modelName: 'deepseek/deepseek-v3.2',
            isActive: true,
          },
        });
        return `Persona created: "${name}" (id: ${persona.id}). It is now active and can analyze thoughts.`;
      } catch (err: any) {
        return `Failed to create persona: ${err.message}`;
      }
    },
    {
      name: 'create_persona',
      description:
        'Create a new AI persona for the user. A persona is a specialized advisor with a unique system prompt that defines its personality and expertise. Use when the user says "create a persona for...", "I need an advisor for...", etc.',
      schema: z.object({
        name: z.string().describe('Persona name, e.g., "Stoic Mentor", "Career Coach", "Financial Advisor"'),
        description: z.string().optional().describe('Brief description of the persona\'s role and expertise'),
        systemPrompt: z.string().describe('The system prompt that defines the persona\'s personality, expertise, tone, and approach. Be detailed and specific.'),
      }),
    },
  );

  // ── 24. delete_persona ────────────────────────────────────────────
  const deletePersona = tool(
    async ({ personaName }) => {
      try {
        // delete_persona only affects user's own personas (shared templates cannot be deleted)
        const persona = await prisma.persona.findFirst({
          where: { userId, isActive: true, name: { contains: personaName, mode: 'insensitive' } },
        });

        if (!persona) {
          // Check if they're trying to delete a shared template
          const template = await prisma.persona.findFirst({
            where: { isTemplate: true, name: { contains: personaName, mode: 'insensitive' } },
            select: { name: true },
          });
          if (template) {
            return `"${template.name}" is a shared library persona and cannot be deleted. It is available to all users.`;
          }
          const available = await prisma.persona.findMany({
            where: { userId, isActive: true },
            select: { name: true },
          });
          const names = available.map((p) => p.name).join(', ');
          return `Persona "${personaName}" not found in your custom personas. Your custom personas: ${names || 'none'}`;
        }

        await prisma.persona.update({
          where: { id: persona.id },
          data: { isActive: false },
        });

        return `Persona "${persona.name}" has been deactivated.`;
      } catch (err: any) {
        return `Failed to delete persona: ${err.message}`;
      }
    },
    {
      name: 'delete_persona',
      description:
        'Deactivate (soft-delete) a persona. Use when the user says "remove the X persona", "delete my Y advisor", etc.',
      schema: z.object({
        personaName: z.string().describe('Name of the persona to delete (fuzzy matched)'),
      }),
    },
  );

  // ── 25. delete_action ─────────────────────────────────────────────
  const deleteAction = tool(
    async ({ actionId, actionContent, markAs }) => {
      try {
        let item: any = null;
        const status = markAs || 'dismissed';

        if (actionId) {
          item = await prisma.actionItem.findFirst({ where: { id: actionId, userId } });
        } else if (actionContent) {
          // Fuzzy match by content
          const items = await prisma.actionItem.findMany({
            where: { userId, status: 'pending' },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          item = items.find(
            (i) => i.content.toLowerCase().includes(actionContent.toLowerCase()) ||
                   actionContent.toLowerCase().includes(i.content.toLowerCase()),
          );
        }

        if (!item) {
          return `No matching action item found. Try providing more specific text or the exact action ID.`;
        }

        await prisma.actionItem.update({
          where: { id: item.id },
          data: { status },
        });

        return `Action item "${item.content.substring(0, 60)}" marked as ${status}.`;
      } catch (err: any) {
        return `Failed to delete action: ${err.message}`;
      }
    },
    {
      name: 'delete_action',
      description:
        'Mark an action item as done or dismissed. Use when the user says "remove that action", "mark X as done", "I did X", "dismiss Y", etc.',
      schema: z.object({
        actionId: z.string().optional().describe('Exact action item ID if known'),
        actionContent: z.string().optional().describe('Fuzzy text match of the action item content'),
        markAs: z.enum(['done', 'dismissed']).optional().describe('Mark as done or dismissed. Default: dismissed.'),
      }),
    },
  );

  // ── 26. get_evening_reflection ────────────────────────────────────
  const getEveningReflection = tool(
    async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const todayDate = new Date(todayStr + 'T00:00:00Z');

        // Fetch today's plan
        const dayPlan = await prisma.dayPlan.findUnique({
          where: { userId_date: { userId, date: todayDate } },
          include: { tasks: { orderBy: { sortOrder: 'asc' } } },
        });

        // Fetch today's check-in
        const checkIn = await prisma.dailyCheckIn.findUnique({
          where: { userId_date: { userId, date: todayDate } },
        });

        // Fetch today's thoughts
        const startOfDay = new Date(todayStr + 'T00:00:00Z');
        const endOfDay = new Date(todayStr + 'T23:59:59Z');
        const todayThoughts = await prisma.thought.findMany({
          where: { userId, createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { title: true, thoughtType: true, rawText: true },
          take: 10,
        });

        // Build context
        const parts: string[] = [`Date: ${todayStr}`];

        if (dayPlan && dayPlan.tasks.length > 0) {
          const total = dayPlan.tasks.length;
          const done = dayPlan.tasks.filter((t) => t.status === 'done').length;
          const skipped = dayPlan.tasks.filter((t) => t.status === 'skipped').length;
          parts.push(`\nPlan: ${total} tasks — ${done} done, ${skipped} skipped, ${total - done - skipped} pending`);
          parts.push('Tasks:\n' + dayPlan.tasks.map((t) => `  • ${t.timeSlot}: ${t.task} [${t.status.toUpperCase()}]`).join('\n'));
        } else {
          parts.push('\nNo plan was set for today.');
        }

        if (checkIn) {
          parts.push(`\nMood: ${checkIn.mood}/5, Energy: ${checkIn.energy}/5${checkIn.note ? `, Note: "${checkIn.note}"` : ''}`);
        }

        if (todayThoughts.length > 0) {
          parts.push(`\nThoughts captured today (${todayThoughts.length}):\n` + todayThoughts.map((t) => `  • [${t.thoughtType}] ${t.title}`).join('\n'));
        }

        // Call LLM
        const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v3.2',
            messages: [
              { role: 'system', content: 'You are a warm, thoughtful evening reflection coach. Generate a brief evening reflection prompt (3-5 sentences) based on the user\'s day. Reference specific tasks, mood, or thoughts. Ask 1-2 gentle questions. Be encouraging but honest. Write in second person. Use markdown.' },
              { role: 'user', content: `Generate an evening reflection for this day:\n\n${parts.join('\n')}` },
            ],
            max_tokens: 512,
            temperature: 0.7,
          }),
        });

        if (!fetchRes.ok) throw new Error(`LLM error: ${fetchRes.status}`);
        const json = await fetchRes.json() as any;
        return json?.choices?.[0]?.message?.content || 'Could not generate reflection.';
      } catch (err: any) {
        return `Failed to generate evening reflection: ${err.message}`;
      }
    },
    {
      name: 'get_evening_reflection',
      description:
        'Generate an AI-powered evening reflection based on today\'s plan, check-in, and thoughts. Use when the user says "reflect on my day", "evening reflection", "how was my day?", etc.',
      schema: z.object({}),
    },
  );

  // ── 27. get_weekly_reflection ──────────────────────────────────────
  const getWeeklyReflection = tool(
    async () => {
      try {
        const now = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);
        const sinceDate = new Date(Date.UTC(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate()));

        const plans = await prisma.dayPlan.findMany({
          where: { userId, date: { gte: sinceDate } },
          include: { tasks: true },
          orderBy: { date: 'asc' },
        });

        const checkIns = await prisma.dailyCheckIn.findMany({
          where: { userId, date: { gte: sinceDate } },
          orderBy: { date: 'asc' },
        });

        const thoughts = await prisma.thought.findMany({
          where: { userId, createdAt: { gte: sevenDaysAgo } },
          select: { title: true, thoughtType: true },
        });

        const totalTasks = plans.reduce((s, p) => s + p.tasks.length, 0);
        const doneTasks = plans.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'done').length, 0);
        const skippedTasks = plans.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'skipped').length, 0);
        const avgMood = checkIns.length > 0 ? (checkIns.reduce((s, c) => s + c.mood, 0) / checkIns.length).toFixed(1) : 'N/A';
        const avgEnergy = checkIns.length > 0 ? (checkIns.reduce((s, c) => s + c.energy, 0) / checkIns.length).toFixed(1) : 'N/A';

        const parts: string[] = [];
        parts.push(`Week ending: ${now.toISOString().split('T')[0]}`);
        parts.push(`Days planned: ${plans.length}/7`);
        parts.push(`Total tasks: ${totalTasks} — ${doneTasks} done, ${skippedTasks} skipped, ${totalTasks - doneTasks - skippedTasks} pending`);
        parts.push(`Completion rate: ${totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%`);
        parts.push(`Check-ins: ${checkIns.length}/7, Avg mood: ${avgMood}/5, Avg energy: ${avgEnergy}/5`);
        parts.push(`Thoughts captured: ${thoughts.length}`);

        if (thoughts.length > 0) {
          const typeCount: Record<string, number> = {};
          thoughts.forEach((t) => { typeCount[t.thoughtType] = (typeCount[t.thoughtType] || 0) + 1; });
          parts.push(`Topics: ${Object.entries(typeCount).map(([k, v]) => `${k} (${v})`).join(', ')}`);
        }

        const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v3.2',
            messages: [
              { role: 'system', content: 'You are a thoughtful weekly reflection coach. Generate a weekly reflection (5-8 sentences). Highlight: what went well, struggles, energy/mood patterns. End with 2 questions: one backward-looking and one forward-looking. Be warm and specific. Second person. Markdown.' },
              { role: 'user', content: `Generate a weekly reflection:\n\n${parts.join('\n')}` },
            ],
            max_tokens: 768,
            temperature: 0.7,
          }),
        });

        if (!fetchRes.ok) throw new Error(`LLM error: ${fetchRes.status}`);
        const json = await fetchRes.json() as any;
        const reflectionText = json?.choices?.[0]?.message?.content || 'Could not generate weekly reflection.';

        return `## Weekly Reflection\n\n${reflectionText}\n\n---\n**Stats:** ${totalTasks} tasks (${doneTasks} done), ${checkIns.length} check-ins, ${thoughts.length} thoughts, Avg mood ${avgMood}/5`;
      } catch (err: any) {
        return `Failed to generate weekly reflection: ${err.message}`;
      }
    },
    {
      name: 'get_weekly_reflection',
      description:
        'Generate an AI-powered weekly reflection analyzing the past 7 days of plans, check-ins, and thoughts. Use when the user says "weekly review", "how was my week?", "reflect on this week", etc.',
      schema: z.object({}),
    },
  );

  // ── 28. get_thinking_stats ────────────────────────────────────────
  const getThinkingStats = tool(
    async () => {
      try {
        // Topic distribution
        const topicResults: any[] = await prisma.$queryRawUnsafe(
          `SELECT thought_type AS "type", COUNT(*)::int AS count FROM thoughts WHERE user_id = $1 GROUP BY thought_type ORDER BY count DESC`,
          userId,
        );

        // Status flow
        const statusResults: any[] = await prisma.$queryRawUnsafe(
          `SELECT status, COUNT(*)::int AS count FROM thoughts WHERE user_id = $1 GROUP BY status`,
          userId,
        );

        const totalThoughts = statusResults.reduce((s, r) => s + r.count, 0);
        const resolved = statusResults.find((r) => r.status === 'resolved')?.count || 0;
        const resolutionRate = totalThoughts > 0 ? Math.round((resolved / totalThoughts) * 100) : 0;

        // Available personas (user's own + shared library templates)
        const personaCount = await prisma.persona.count({
          where: { OR: [{ userId }, { isTemplate: true }], isActive: true },
        });

        // Build summary
        const lines: string[] = [];
        lines.push(`**Total Thoughts:** ${totalThoughts}`);
        lines.push(`**Resolution Rate:** ${resolutionRate}% (${resolved} resolved)`);
        lines.push(`**Active Personas:** ${personaCount}`);

        if (topicResults.length > 0) {
          lines.push('\n**Topic Distribution:**');
          topicResults.forEach((r) => {
            const pct = totalThoughts > 0 ? Math.round((r.count / totalThoughts) * 100) : 0;
            lines.push(`  • ${r.type}: ${r.count} (${pct}%)`);
          });
        }

        if (statusResults.length > 0) {
          lines.push('\n**Status Breakdown:**');
          statusResults.forEach((r) => lines.push(`  • ${r.status}: ${r.count}`));
        }

        return lines.join('\n');
      } catch (err: any) {
        return `Failed to get thinking stats: ${err.message}`;
      }
    },
    {
      name: 'get_thinking_stats',
      description:
        'Get the user\'s thinking statistics: topic distribution, resolution rate, status breakdown, persona count. Use when the user asks "what are my thinking patterns?", "show my stats", etc.',
      schema: z.object({}),
    },
  );

  // ── 29. get_life_dimensions ───────────────────────────────────────
  const getLifeDimensions = tool(
    async () => {
      try {
        const DIMENSIONS = ['Health', 'Career', 'Relationships', 'Finance', 'Learning', 'Creativity', 'Spirituality'];

        const thoughts = await prisma.thought.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, title: true, rawText: true, thoughtType: true, createdAt: true },
        });

        if (thoughts.length === 0) {
          return 'No thoughts recorded yet. Start capturing thoughts to see your life dimension analysis.';
        }

        const thoughtList = thoughts.map((t, i) => `${i + 1}. [${t.thoughtType}] ${t.title}: ${t.rawText.substring(0, 100)}`).join('\n');

        const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openRouterApiKey}` },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v3.2',
            messages: [
              { role: 'system', content: `You are a life dimensions classifier. Classify each thought into EXACTLY ONE of these dimensions: ${DIMENSIONS.join(', ')}, Other.\nRespond with ONLY a JSON array of strings, one per thought, in the same order. Example: ["Health", "Career", "Learning"]` },
              { role: 'user', content: `Classify these ${thoughts.length} thoughts:\n${thoughtList}` },
            ],
            max_tokens: 2048,
            temperature: 0.1,
          }),
        });

        if (!fetchRes.ok) throw new Error(`LLM error: ${fetchRes.status}`);
        const json = await fetchRes.json() as any;
        const text = json?.choices?.[0]?.message?.content || '[]';

        const jsonMatch = text.match(/\[([\s\S]*?)\]/);
        const classifications: string[] = jsonMatch ? JSON.parse(`[${jsonMatch[1]}]`) : [];

        const dimMap: Record<string, number> = {};
        for (const d of [...DIMENSIONS, 'Other']) dimMap[d] = 0;

        thoughts.forEach((_, i) => {
          const dim = classifications[i] && dimMap[classifications[i]] !== undefined ? classifications[i] : 'Other';
          dimMap[dim]++;
        });

        const total = thoughts.length;
        const lines = Object.entries(dimMap)
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([dim, count]) => `  • ${dim}: ${count} thoughts (${Math.round((count / total) * 100)}%)`);

        return `**Life Dimensions** (based on ${total} recent thoughts):\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Failed to analyze life dimensions: ${err.message}`;
      }
    },
    {
      name: 'get_life_dimensions',
      description:
        'Analyze how the user\'s thoughts are distributed across life dimensions (Health, Career, Relationships, Finance, Learning, Creativity, Spirituality). Uses LLM classification. Use when the user asks "what am I focusing on?", "life balance", "which areas of my life...?", etc.',
      schema: z.object({}),
    },
  );

  // ── 30. get_planner_stats ─────────────────────────────────────────
  const getPlannerStats = tool(
    async ({ days }) => {
      try {
        const numDays = days || 7;
        const since = new Date();
        since.setDate(since.getDate() - numDays);
        const sinceDate = new Date(Date.UTC(since.getFullYear(), since.getMonth(), since.getDate()));

        const plans = await prisma.dayPlan.findMany({
          where: { userId, date: { gte: sinceDate } },
          include: { tasks: true },
        });

        const allTasks = plans.flatMap((p) => p.tasks);
        const total = allTasks.length;
        const done = allTasks.filter((t) => t.status === 'done').length;
        const skipped = allTasks.filter((t) => t.status === 'skipped').length;
        const pending = allTasks.filter((t) => t.status === 'pending').length;
        const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

        // Calculate streak
        const today = new Date();
        let streak = 0;
        for (let i = 1; i <= numDays; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const plan = plans.find((p) => p.date.toISOString().split('T')[0] === dateStr);
          if (plan && plan.tasks.length > 0 && plan.tasks.every((t) => t.status === 'done')) {
            streak++;
          } else if (plan && plan.tasks.length > 0) {
            break;
          }
        }

        const lines: string[] = [];
        lines.push(`**Planner Stats (last ${numDays} days)**`);
        lines.push(`Days planned: ${plans.length}`);
        lines.push(`Total tasks: ${total}`);
        lines.push(`Done: ${done} | Skipped: ${skipped} | Pending: ${pending}`);
        lines.push(`Completion rate: ${completionRate}%`);
        lines.push(`Streak: ${streak} consecutive day(s) fully completed`);

        return lines.join('\n');
      } catch (err: any) {
        return `Failed to get planner stats: ${err.message}`;
      }
    },
    {
      name: 'get_planner_stats',
      description:
        'Get the user\'s planner completion statistics: tasks done/skipped/pending, completion rate, and streak. Use when the user asks "how am I doing with my plans?", "my completion rate", "streak", etc.',
      schema: z.object({
        days: z.number().optional().describe('Number of days to look back (default 7)'),
      }),
    },
  );

  // ── 31. fetch_persona_response ─────────────────────────────────────
  const fetchPersonaResponse = tool(
    async ({ thoughtId, personaName }) => {
      try {
        // Build query to find the persona run
        const whereClause: any = {};

        // If thoughtId provided, find via thread
        if (thoughtId) {
          const thought = await prisma.thought.findFirst({
            where: { id: thoughtId, userId },
            include: { threads: { select: { id: true } } },
          });
          if (thought && thought.threads.length > 0) {
            whereClause.threadId = { in: thought.threads.map((t) => t.id) };
          } else {
            return `Thought with id "${thoughtId}" not found.`;
          }
        }

        // If personaName provided, filter by persona (user's own + shared library templates)
        if (personaName) {
          const persona = await prisma.persona.findFirst({
            where: {
              OR: [{ userId }, { isTemplate: true }],
              name: { contains: personaName, mode: 'insensitive' },
            },
            select: { id: true, name: true },
          });
          if (persona) {
            whereClause.personaId = persona.id;
          }
        }

        // If no filters, get the most recent persona run for this user's thoughts
        if (Object.keys(whereClause).length === 0) {
          // Find all threads belonging to user's thoughts
          const userThreads = await prisma.thoughtThread.findMany({
            where: { thought: { userId } },
            select: { id: true },
          });
          if (userThreads.length === 0) return 'No persona analyses found.';
          whereClause.threadId = { in: userThreads.map((t) => t.id) };
        }

        // Fetch the most recent persona run
        const run = await prisma.personaRun.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          include: {
            persona: { select: { name: true } },
            thread: { include: { thought: { select: { title: true } } } },
          },
        });

        if (!run) {
          return 'No persona analysis found matching your request. The user may need to trigger a new analysis first.';
        }

        const thoughtTitle = run.thread?.thought?.title || 'Unknown';
        const personaLabel = run.persona?.name || 'Unknown Persona';
        const dateStr = run.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

        // Return the EXACT stored response from DB — no LLM involved
        return `[VERBATIM_START]\n## ${personaLabel}'s Analysis of "${thoughtTitle}"\n_Generated on ${dateStr}_\n\n${run.outputText}\n[VERBATIM_END]`;
      } catch (err: any) {
        return `Failed to fetch persona response: ${err.message}`;
      }
    },
    {
      name: 'fetch_persona_response',
      description:
        'Fetch a previously generated persona analysis from the database. Use this when the user asks "what did the persona say?", "show me the full response", "give me the complete analysis", or refers to a previous persona response. This does NOT re-trigger analysis — it retrieves the exact stored response. Output is between [VERBATIM_START] and [VERBATIM_END] markers — relay it EXACTLY as-is, do NOT summarize.',
      schema: z.object({
        thoughtId: z.string().optional().describe('The thought ID to fetch the persona response for. Omit to get the most recent one.'),
        personaName: z.string().optional().describe('Name of the persona whose response to fetch (fuzzy matched). Omit for any persona.'),
      }),
    },
  );

  // ── 32. create_tension ──────────────────────────────────────────
  const createTension = tool(
    async ({ personName, title, description, intensity }) => {
      try {
        let personId: string | null = null;
        let personLabel = '';
        if (personName) {
          const person = await prisma.relationshipPerson.findFirst({
            where: { userId, isActive: true, name: { contains: personName, mode: 'insensitive' } },
            select: { id: true, name: true },
          });
          if (person) { personId = person.id; personLabel = ` with ${person.name}`; }
        }
        const tension = await prisma.tensionEntry.create({
          data: { userId, personId, title, description, intensity: intensity || 5 },
        });
        return `Tension logged${personLabel}: "${title}" (intensity: ${intensity || 5}/10, id: ${tension.id})`;
      } catch (err: any) { return `Failed to create tension: ${err.message}`; }
    },
    {
      name: 'create_tension',
      description: 'Log a relationship tension or conflict. Use when the user describes a disagreement, frustration, or conflict with someone.',
      schema: z.object({
        personName: z.string().optional().describe('Person involved (fuzzy matched to circle)'),
        title: z.string().describe('Short title for the tension'),
        description: z.string().describe('What happened or what the tension is about'),
        intensity: z.number().min(1).max(10).optional().describe('Intensity 1-10, default 5'),
      }),
    },
  );

  // ── 33. list_tensions ───────────────────────────────────────────
  const listTensions = tool(
    async ({ status }) => {
      try {
        const where: any = { userId };
        if (status) where.status = status;
        const tensions = await prisma.tensionEntry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { person: { select: { name: true, relationship: true } } },
        });
        if (tensions.length === 0) return `No ${status || ''} tensions found.`;
        const lines = tensions.map((t: any) => {
          const personStr = t.person ? ` (with ${t.person.name})` : '';
          const coolStr = t.status === 'cooling_down' && t.coolDownUntil ? ` — cool-down until ${t.coolDownUntil.toLocaleTimeString()}` : '';
          return `• [${t.status.toUpperCase()}] "${t.title}"${personStr} — intensity ${t.intensity}/10${coolStr} (id: ${t.id})`;
        });
        return `**Tensions (${tensions.length}):**\n${lines.join('\n')}`;
      } catch (err: any) { return `Failed to list tensions: ${err.message}`; }
    },
    {
      name: 'list_tensions',
      description: 'List the user\'s relationship tensions/conflicts. Can filter by status: active, cooling_down, resolved.',
      schema: z.object({
        status: z.enum(['active', 'cooling_down', 'resolved']).optional().describe('Filter by status. Omit for all.'),
      }),
    },
  );

  // ── 34. resolve_tension ─────────────────────────────────────────
  const resolveTension = tool(
    async ({ tensionTitle, resolution }) => {
      try {
        const tension = await prisma.tensionEntry.findFirst({
          where: { userId, status: { not: 'resolved' }, title: { contains: tensionTitle, mode: 'insensitive' } },
        });
        if (!tension) return `No active tension matching "${tensionTitle}" found.`;
        await prisma.tensionEntry.update({
          where: { id: tension.id },
          data: { status: 'resolved', resolvedAt: new Date(), resolution: resolution || null },
        });
        return `Tension "${tension.title}" marked as resolved.${resolution ? ` Resolution: ${resolution}` : ''}`;
      } catch (err: any) { return `Failed to resolve tension: ${err.message}`; }
    },
    {
      name: 'resolve_tension',
      description: 'Mark a tension as resolved. Use when the user says they worked things out or a conflict is over.',
      schema: z.object({
        tensionTitle: z.string().describe('Title of the tension to resolve (fuzzy matched)'),
        resolution: z.string().optional().describe('How it was resolved'),
      }),
    },
  );

  // ── 35. cooldown_tension ────────────────────────────────────────
  const cooldownTension = tool(
    async ({ tensionTitle, minutes }) => {
      try {
        const tension = await prisma.tensionEntry.findFirst({
          where: { userId, status: 'active', title: { contains: tensionTitle, mode: 'insensitive' } },
        });
        if (!tension) return `No active tension matching "${tensionTitle}" found.`;
        const coolDownUntil = new Date(Date.now() + (minutes || 30) * 60000);
        await prisma.tensionEntry.update({
          where: { id: tension.id },
          data: { status: 'cooling_down', coolDownUntil },
        });
        return `Cool-down started for "${tension.title}" — ${minutes || 30} minutes until ${coolDownUntil.toLocaleTimeString()}.`;
      } catch (err: any) { return `Failed to start cool-down: ${err.message}`; }
    },
    {
      name: 'cooldown_tension',
      description: 'Start a cool-down period on a tension. Use when the user wants to wait before engaging with a conflict.',
      schema: z.object({
        tensionTitle: z.string().describe('Title of the tension (fuzzy matched)'),
        minutes: z.number().optional().describe('Cool-down duration in minutes (default 30)'),
      }),
    },
  );

  // ── 36. complete_ritual ─────────────────────────────────────────
  const completeRitual = tool(
    async ({ ritualTitle }) => {
      try {
        const ritual = await prisma.relationshipRitual.findFirst({
          where: { userId, isActive: true, title: { contains: ritualTitle, mode: 'insensitive' } },
          include: { person: { select: { name: true } } },
        });
        if (!ritual) return `No active ritual matching "${ritualTitle}" found.`;
        await prisma.relationshipRitual.update({
          where: { id: ritual.id },
          data: { lastDoneAt: new Date(), streak: { increment: 1 } },
        });
        const personStr = (ritual as any).person ? ` (with ${(ritual as any).person.name})` : '';
        return `Ritual "${ritual.title}"${personStr} marked complete! Streak: ${ritual.streak + 1}`;
      } catch (err: any) { return `Failed to complete ritual: ${err.message}`; }
    },
    {
      name: 'complete_ritual',
      description: 'Mark a relationship ritual as done for today. Increments the streak. Use when user says they did their ritual.',
      schema: z.object({
        ritualTitle: z.string().describe('Title of the ritual (fuzzy matched)'),
      }),
    },
  );

  // ── 37. delete_ritual ───────────────────────────────────────────
  const deleteRitual = tool(
    async ({ ritualTitle }) => {
      try {
        const ritual = await prisma.relationshipRitual.findFirst({
          where: { userId, isActive: true, title: { contains: ritualTitle, mode: 'insensitive' } },
        });
        if (!ritual) return `No active ritual matching "${ritualTitle}" found.`;
        await prisma.relationshipRitual.delete({ where: { id: ritual.id } });
        return `Ritual "${ritual.title}" has been removed.`;
      } catch (err: any) { return `Failed to delete ritual: ${err.message}`; }
    },
    {
      name: 'delete_ritual',
      description: 'Remove a relationship ritual. Use when the user wants to stop or cancel a ritual.',
      schema: z.object({
        ritualTitle: z.string().describe('Title of the ritual to remove (fuzzy matched)'),
      }),
    },
  );

  // ── 38. list_upcoming_events ────────────────────────────────────
  const listUpcomingEvents = tool(
    async ({ days }) => {
      try {
        const numDays = days || 30;
        const now = new Date();
        const until = new Date();
        until.setDate(until.getDate() + numDays);
        const events = await prisma.lifeEvent.findMany({
          where: { userId, eventDate: { gte: now, lte: until } },
          orderBy: { eventDate: 'asc' },
          include: { person: { select: { name: true } } },
        });
        if (events.length === 0) return `No upcoming events in the next ${numDays} days.`;
        const lines = events.map((e: any) => {
          const dateStr = e.eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const personStr = e.person ? ` — ${e.person.name}` : '';
          const recurStr = e.isRecurring ? ' (recurring)' : '';
          return `• ${dateStr}: **${e.title}** [${e.eventType}]${personStr}${recurStr}`;
        });
        return `**Upcoming Events (next ${numDays} days):**\n${lines.join('\n')}`;
      } catch (err: any) { return `Failed to list upcoming events: ${err.message}`; }
    },
    {
      name: 'list_upcoming_events',
      description: 'List upcoming life events (birthdays, anniversaries, etc.). Use when user asks about upcoming events or what\'s coming up.',
      schema: z.object({
        days: z.number().optional().describe('How many days ahead to look (default 30)'),
      }),
    },
  );

  // ── 39. delete_life_event ───────────────────────────────────────
  const deleteLifeEvent = tool(
    async ({ eventTitle }) => {
      try {
        const event = await prisma.lifeEvent.findFirst({
          where: { userId, title: { contains: eventTitle, mode: 'insensitive' } },
        });
        if (!event) return `No life event matching "${eventTitle}" found.`;
        await prisma.lifeEvent.delete({ where: { id: event.id } });
        return `Life event "${event.title}" has been removed.`;
      } catch (err: any) { return `Failed to delete life event: ${err.message}`; }
    },
    {
      name: 'delete_life_event',
      description: 'Remove a life event. Use when user wants to cancel or delete a tracked event.',
      schema: z.object({
        eventTitle: z.string().describe('Title of the event to remove (fuzzy matched)'),
      }),
    },
  );

  // ── 40. update_thought_status ───────────────────────────────────
  const updateThoughtStatus = tool(
    async ({ thoughtTitle, thoughtId, status }) => {
      try {
        let thought: any;
        if (thoughtId) {
          thought = await prisma.thought.findFirst({ where: { id: thoughtId, userId } });
        } else {
          thought = await prisma.thought.findFirst({
            where: { userId, title: { contains: thoughtTitle || '', mode: 'insensitive' } },
            orderBy: { createdAt: 'desc' },
          });
        }
        if (!thought) return `No thought matching "${thoughtTitle || thoughtId}" found.`;
        await prisma.thought.update({ where: { id: thought.id }, data: { status } });
        return `Thought "${thought.title}" status changed to ${status}.`;
      } catch (err: any) { return `Failed to update thought status: ${err.message}`; }
    },
    {
      name: 'update_thought_status',
      description: 'Change a thought\'s status to open, resolved, or archived. Use when the user says a thought is resolved or wants to close/archive it.',
      schema: z.object({
        thoughtTitle: z.string().optional().describe('Title of the thought (fuzzy matched)'),
        thoughtId: z.string().optional().describe('Exact thought ID, if known'),
        status: z.enum(['open', 'resolved', 'archived']).describe('New status'),
      }),
    },
  );

  // ── 41. delete_thought ──────────────────────────────────────────
  const deleteThought = tool(
    async ({ thoughtTitle, thoughtId }) => {
      try {
        let thought: any;
        if (thoughtId) {
          thought = await prisma.thought.findFirst({ where: { id: thoughtId, userId } });
        } else {
          thought = await prisma.thought.findFirst({
            where: { userId, title: { contains: thoughtTitle || '', mode: 'insensitive' } },
            orderBy: { createdAt: 'desc' },
          });
        }
        if (!thought) return `No thought matching "${thoughtTitle || thoughtId}" found.`;
        await prisma.thought.delete({ where: { id: thought.id } });
        return `Thought "${thought.title}" has been permanently deleted.`;
      } catch (err: any) { return `Failed to delete thought: ${err.message}`; }
    },
    {
      name: 'delete_thought',
      description: 'Permanently delete a thought and all its thread data. Use when the user explicitly wants to remove a thought.',
      schema: z.object({
        thoughtTitle: z.string().optional().describe('Title of the thought (fuzzy matched)'),
        thoughtId: z.string().optional().describe('Exact thought ID, if known'),
      }),
    },
  );

  // ── 42. update_task_status ──────────────────────────────────────
  const updateTaskStatus = tool(
    async ({ date, taskName, status }) => {
      try {
        const dateObj = new Date(date + 'T00:00:00.000Z');
        const plan = await prisma.dayPlan.findUnique({
          where: { userId_date: { userId, date: dateObj } },
          include: { tasks: true },
        });
        if (!plan || plan.tasks.length === 0) return `No tasks found on ${date}.`;
        const match = plan.tasks.find(
          (t) => t.task.toLowerCase().includes(taskName.toLowerCase()) ||
                 taskName.toLowerCase().includes(t.task.toLowerCase()),
        );
        if (!match) {
          const available = plan.tasks.map((t) => `"${t.task}"`).join(', ');
          return `No task matching "${taskName}" on ${date}. Tasks: ${available}`;
        }
        await prisma.planTask.update({ where: { id: match.id }, data: { status } });
        return `Task "${match.task}" on ${date} marked as ${status}.`;
      } catch (err: any) { return `Failed to update task status: ${err.message}`; }
    },
    {
      name: 'update_task_status',
      description: 'Mark a planner task as done, skipped, or pending. Use when the user says they completed or skipped a task.',
      schema: z.object({
        date: z.string().describe('Date in YYYY-MM-DD format'),
        taskName: z.string().describe('Task name (fuzzy matched)'),
        status: z.enum(['done', 'skipped', 'pending']).describe('New status'),
      }),
    },
  );

  // ── 43. get_relationship_health ─────────────────────────────────
  const getRelationshipHealth = tool(
    async () => {
      try {
        const allPeople = await prisma.relationshipPerson.findMany({
          where: { userId, isActive: true },
          select: {
            id: true, name: true, relationship: true, description: true,
            dynamic: true, lastInteractionAt: true, interactionCount: true,
          },
        });
        if (allPeople.length === 0) return 'No people in your relationship circle yet.';

        // Gather connections for DM matching
        const connections = await prisma.connection.findMany({
          where: { status: 'accepted', OR: [{ requesterId: userId }, { receiverId: userId }] },
          include: {
            requester: { select: { id: true, name: true } },
            receiver: { select: { id: true, name: true } },
          },
        });
        const connectedUsers = connections.map((c: any) => {
          const other = c.requesterId === userId ? c.receiver : c.requester;
          return { userId: other.id, name: other.name };
        });

        // Build rich context per person (DMs + notes + rituals)
        const personContexts = await Promise.all(allPeople.map(async (person) => {
          // Match to connected user for DMs
          const matchedUser = connectedUsers.find(
            (u) => u.name.toLowerCase().includes(person.name.toLowerCase()) ||
                   person.name.toLowerCase().includes(u.name.toLowerCase()),
          );

          // Pull last 15 DMs if matched
          let messagesSummary = 'No direct messages (not connected on 4Ever or no messages yet).';
          let lastMsgDate: Date | null = null;
          if (matchedUser) {
            const dms = await prisma.directMessage.findMany({
              where: {
                OR: [
                  { senderId: userId, receiverId: matchedUser.userId },
                  { senderId: matchedUser.userId, receiverId: userId },
                ],
              },
              orderBy: { createdAt: 'desc' },
              take: 15,
              include: { sender: { select: { name: true } } },
            });
            if (dms.length > 0) {
              lastMsgDate = dms[0].createdAt; // most recent message (already sorted desc)
              messagesSummary = dms.reverse().map((m: any) => {
                const date = m.createdAt.toISOString().split('T')[0];
                return `[${date}] ${m.sender.name}: ${m.content.substring(0, 150)}`;
              }).join('\n');
            } else {
              messagesSummary = 'Connected on 4Ever but no messages exchanged yet.';
            }
          }

          // Pull last 5 relationship notes
          const notes = await prisma.relationshipNote.findMany({
            where: { personId: person.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
          });
          const notesSummary = notes.length > 0
            ? notes.map((n) => `[${n.createdAt.toISOString().split('T')[0]}] (${n.sentiment || 'neutral'}) ${n.content.substring(0, 150)}`).join('\n')
            : 'No interaction notes logged.';

          // Pull active rituals
          const rituals = await prisma.relationshipRitual.findMany({
            where: { personId: person.id, isActive: true },
            select: { title: true, frequency: true, lastDoneAt: true, streak: true },
          });
          const ritualsSummary = rituals.length > 0
            ? rituals.map((r) => `"${r.title}" (${r.frequency}, streak: ${r.streak}, last: ${r.lastDoneAt?.toISOString().split('T')[0] || 'never'})`).join('; ')
            : 'No rituals set.';

          // Derive last interaction: prefer DB field, fall back to most recent message or note
          const lastInteraction = person.lastInteractionAt || lastMsgDate || (notes.length > 0 ? notes[0].createdAt : null);
          const daysSince = lastInteraction
            ? Math.floor((Date.now() - new Date(lastInteraction).getTime()) / 86400000)
            : null;

          // Backfill: if DB has no lastInteractionAt but we found messages, update it
          if (!person.lastInteractionAt && lastMsgDate) {
            prisma.relationshipPerson.update({
              where: { id: person.id },
              data: { lastInteractionAt: lastMsgDate },
            }).catch(() => {}); // fire-and-forget backfill
          }

          return {
            id: person.id, name: person.name, relationship: person.relationship,
            daysSinceInteraction: daysSince,
            context: `## ${person.name} (${person.relationship})
${person.description ? `Description: ${person.description}` : ''}
${person.dynamic ? `Dynamic: ${person.dynamic}` : ''}
Last interaction: ${daysSince !== null ? `${daysSince} days ago` : 'Never'}
Total interactions logged: ${person.interactionCount}

### Recent Messages:
${messagesSummary}

### Relationship Notes:
${notesSummary}

### Rituals:
${ritualsSummary}`,
          };
        }));

        // LLM call to score ALL relationships
        const prompt = `You are a relationship health analyst for a personal relationship management app called 4Ever.
Today is ${new Date().toISOString().split('T')[0]}.

The user has ${allPeople.length} people in their relationship circle. Based on the evidence below, rate EACH relationship's health from 0-100 and explain why in 1-2 sentences.

Consider these factors:
- Message frequency, tone, and reciprocity
- Whether conversations feel warm, engaged, or one-sided
- How recently they communicated
- Relationship notes and their sentiment
- Whether rituals are being maintained
- For new relationships with little data, be optimistic (score 50-60) rather than harsh

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences.
Format:
[{"name": "PersonName", "score": 75, "reason": "Brief explanation", "status": "healthy|needs_attention|drifting"}]

Status rules: healthy = score >= 60, needs_attention = score 35-59, drifting = score < 35

---
${personContexts.map((p) => p.context).join('\n\n---\n')}`;

        const fetchRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterApiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v3.2',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2048,
            temperature: 0.3,
          }),
        });

        if (!fetchRes.ok) {
          const errBody = await fetchRes.text().catch(() => '');
          throw new Error(`LLM error ${fetchRes.status}: ${errBody.substring(0, 200)}`);
        }

        const json = await fetchRes.json() as any;
        const text = json?.choices?.[0]?.message?.content || '';
        const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (!jsonMatch) throw new Error('No JSON array found in LLM response');

        const llmScores: Array<{ name: string; score: number; reason: string; status: string }> = JSON.parse(jsonMatch[0]);

        // Merge scores with person data
        const peopleWithScores = personContexts.map((pc) => {
          const llmResult = llmScores.find(
            (s) => s.name.toLowerCase() === pc.name.toLowerCase(),
          ) || { score: 50, reason: 'No LLM analysis available.', status: 'needs_attention' };
          return {
            name: pc.name, relationship: pc.relationship,
            score: Math.max(0, Math.min(100, llmResult.score)),
            reason: llmResult.reason, status: llmResult.status,
            daysSince: pc.daysSinceInteraction,
          };
        }).sort((a, b) => a.score - b.score);

        const overall = Math.round(peopleWithScores.reduce((s, p) => s + p.score, 0) / peopleWithScores.length);
        const healthy = peopleWithScores.filter((p) => p.status === 'healthy').length;
        const needsAttention = peopleWithScores.filter((p) => p.status !== 'healthy').length;

        const lines: string[] = [];
        lines.push(`**Relationship Health Overview** (${allPeople.length} people)`);
        lines.push(`Overall Score: **${overall}/100** | Healthy: ${healthy} | Needs Attention: ${needsAttention}`);
        lines.push('');
        peopleWithScores.forEach((p) => {
          const icon = p.status === 'healthy' ? '\u2705' : p.status === 'needs_attention' ? '\u26a0\ufe0f' : '\ud83d\udd34';
          const dayStr = p.daysSince !== null ? `${p.daysSince}d ago` : 'never';
          lines.push(`${icon} **${p.name}** [${p.relationship}] \u2014 ${p.score}/100 (last: ${dayStr})`);
          lines.push(`   _${p.reason}_`);
        });
        return lines.join('\n');
      } catch (err: any) { return `Failed to get relationship health: ${err.message}`; }
    },
    {
      name: 'get_relationship_health',
      description: 'Get relationship health scores for everyone in the circle. Uses LLM analysis of messages, notes, and rituals. Use when user asks about relationship health or who they are neglecting.',
      schema: z.object({}),
    },
  );

  // ── 44. link_action_to_planner ──────────────────────────────────
  const linkActionToPlanner = tool(
    async ({ actionContent, date, timeSlot }) => {
      try {
        const action = await prisma.actionItem.findFirst({
          where: { userId, status: 'pending', content: { contains: actionContent, mode: 'insensitive' } },
        });
        if (!action) return `No pending action matching "${actionContent}" found.`;

        const dateObj = new Date(date + 'T00:00:00.000Z');
        const plan = await prisma.dayPlan.upsert({
          where: { userId_date: { userId, date: dateObj } },
          create: { userId, date: dateObj },
          update: { updatedAt: new Date() },
        });
        const existingCount = await prisma.planTask.count({ where: { planId: plan.id } });
        await prisma.planTask.create({
          data: { planId: plan.id, timeSlot, task: action.content, sortOrder: existingCount },
        });
        await prisma.actionItem.update({ where: { id: action.id }, data: { status: 'done' } });
        return `Action "${action.content}" added to planner on ${date} at ${timeSlot} and marked as done.`;
      } catch (err: any) { return `Failed to link action to planner: ${err.message}`; }
    },
    {
      name: 'link_action_to_planner',
      description: 'Move a pending action item to the day planner. Creates a planner task and marks the action as done. Use when user wants to schedule an action item.',
      schema: z.object({
        actionContent: z.string().describe('Content of the action item (fuzzy matched)'),
        date: z.string().describe('Date to schedule it on (YYYY-MM-DD)'),
        timeSlot: z.string().describe('Time slot like "9:00 AM", "2:30 PM"'),
      }),
    },
  );

  // ── 45. get_checkin ─────────────────────────────────────────────
  const getCheckin = tool(
    async ({ date }) => {
      try {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dateObj = new Date(targetDate + 'T00:00:00.000Z');
        const checkin = await prisma.dailyCheckIn.findUnique({
          where: { userId_date: { userId, date: dateObj } },
        });
        if (!checkin) return `No check-in recorded for ${targetDate}.`;
        return `**Check-in for ${targetDate}:** Mood: ${checkin.mood}/5, Energy: ${checkin.energy}/5${checkin.note ? `, Note: "${checkin.note}"` : ''}`;
      } catch (err: any) { return `Failed to get check-in: ${err.message}`; }
    },
    {
      name: 'get_checkin',
      description: 'Read the daily check-in (mood, energy, note) for a specific date. Use when user asks about their mood or energy on a date.',
      schema: z.object({
        date: z.string().optional().describe('Date in YYYY-MM-DD format. Omit for today.'),
      }),
    },
  );

  // ── 46. update_memory ──────────────────────────────────────────
  const updateMemory = tool(
    async ({ query, newContent }) => {
      try {
        // Use MemoryManager if available (Memory OS path)
        if (memoryManager) {
          const result = await memoryManager.update(userId, query, newContent);
          if (!result.updated) return `No memory found matching "${query}". Nothing was updated.`;
          return `Memory updated! Old: "${result.oldContent?.substring(0, 100)}..." → New: "${newContent.substring(0, 100)}..."`;
        }

        // Fallback: legacy path
        const embedding = await generateEmbedding(query.substring(0, 1000), openRouterApiKey);
        if (embedding.length === 0) return 'Failed to generate embedding for memory search.';
        const vectorStr = `[${embedding.join(',')}]`;
        const matches: any[] = await prisma.$queryRawUnsafe(
          `SELECT m.id, m.content, 1 - (me.embedding <=> $1::vector) AS similarity
           FROM memories m
           JOIN memory_embeddings me ON me.memory_id = m.id
           WHERE m.user_id = $2 AND m.status = 'active'
           ORDER BY me.embedding <=> $1::vector
           LIMIT 1`,
          vectorStr, userId,
        );
        if (matches.length === 0 || matches[0].similarity < 0.5) {
          return `No memory found matching "${query}". Nothing was updated.`;
        }
        const old = matches[0];
        await prisma.memory.update({
          where: { id: old.id },
          data: { content: newContent, updatedAt: new Date() },
        });
        const newEmb = await generateEmbedding(newContent.substring(0, 1000), openRouterApiKey);
        if (newEmb.length > 0) {
          const newVec = `[${newEmb.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE memory_embeddings SET embedding = $1::vector WHERE memory_id = $2`,
            newVec, old.id,
          );
        }
        return `Memory updated! Old: "${old.content.substring(0, 100)}..." → New: "${newContent.substring(0, 100)}..."`;
      } catch (err: any) {
        return `Failed to update memory: ${err.message}`;
      }
    },
    {
      name: 'update_memory',
      description: 'Update an existing memory when the user corrects something Core remembered wrong, or when information has changed. Finds the closest matching memory and updates it.',
      schema: z.object({
        query: z.string().describe('What the old memory was about (used to find it)'),
        newContent: z.string().describe('The corrected/updated memory content'),
      }),
    },
  );

  // ── 47. forget_memory ──────────────────────────────────────────
  const forgetMemory = tool(
    async ({ query }) => {
      try {
        // Use MemoryManager if available (Memory OS path)
        if (memoryManager) {
          const result = await memoryManager.archive(userId, query);
          if (!result.archived) return `No memory found matching "${query}". Nothing was removed.`;
          return `Memory archived: "${result.content?.substring(0, 120)}..." — I'll no longer recall this.`;
        }

        // Fallback: legacy path
        const embedding = await generateEmbedding(query.substring(0, 1000), openRouterApiKey);
        if (embedding.length === 0) return 'Failed to generate embedding for memory search.';
        const vectorStr = `[${embedding.join(',')}]`;
        const matches: any[] = await prisma.$queryRawUnsafe(
          `SELECT m.id, m.content, 1 - (me.embedding <=> $1::vector) AS similarity
           FROM memories m
           JOIN memory_embeddings me ON me.memory_id = m.id
           WHERE m.user_id = $2 AND m.status = 'active'
           ORDER BY me.embedding <=> $1::vector
           LIMIT 1`,
          vectorStr, userId,
        );
        if (matches.length === 0 || matches[0].similarity < 0.5) {
          return `No memory found matching "${query}". Nothing was removed.`;
        }
        const mem = matches[0];
        await prisma.memory.update({
          where: { id: mem.id },
          data: { status: 'archived' },
        });
        return `Memory archived: "${mem.content.substring(0, 120)}..." — I'll no longer recall this.`;
      } catch (err: any) {
        return `Failed to forget memory: ${err.message}`;
      }
    },
    {
      name: 'forget_memory',
      description: 'Archive/forget a specific memory when the user asks you to forget something or says a memory is wrong and should be removed entirely.',
      schema: z.object({
        query: z.string().describe('What the memory was about (used to find and archive it)'),
      }),
    },
  );

  // ── 48. add_manual_memory ──────────────────────────────────────
  const addManualMemory = tool(
    async ({ content, category }) => {
      try {
        // Use MemoryManager if available (Memory OS path)
        if (memoryManager) {
          const result = await memoryManager.store({
            userId,
            content,
            source: 'manual',
            category: category || null,
            importanceScore: 0.8,
          });
          if (!result.stored && result.reason === 'duplicate') {
            return `I already remember something very similar. No new memory was added.`;
          }
          return `Got it! I'll remember: "${content.substring(0, 120)}" ${category ? `[${category}]` : ''}`;
        }

        // Fallback: legacy path
        const result = await storeMemoryWithDedup(prisma, openRouterApiKey, {
          userId,
          content,
          memoryType: 'explicit',
          source: 'manual',
          category: category || null,
          importanceScore: 0.8,
        });
        if (!result.stored && result.reason === 'duplicate') {
          return `I already remember something very similar. No new memory was added.`;
        }
        return `Got it! I'll remember: "${content.substring(0, 120)}" ${category ? `[${category}]` : ''}`;
      } catch (err: any) {
        return `Failed to store memory: ${err.message}`;
      }
    },
    {
      name: 'add_manual_memory',
      description: 'Explicitly store a new memory when the user says "remember this", "don\'t forget that", or asks you to remember something specific.',
      schema: z.object({
        content: z.string().describe('The fact or information to remember'),
        category: z.string().optional().describe('Category like preference, fact, goal, relationship, etc.'),
      }),
    },
  );

  // ── 49. set_goal ──────────────────────────────────────────────
  const setGoal = tool(
    async ({ content, priority }) => {
      try {
        if (!memoryManager) {
          // Fallback: store as a regular memory with goal type
          const result = await storeMemoryWithDedup(prisma, openRouterApiKey, {
            userId,
            content,
            memoryType: 'goal',
            source: 'manual',
            importanceScore: 0.9,
          });
          return result.stored
            ? `Goal stored: "${content.substring(0, 120)}" (priority: ${priority || 'high'})`
            : `Similar goal already exists.`;
        }

        // Memory OS path: store with goal type and high importance
        const result = await memoryManager.store({
          userId,
          content,
          memoryType: 'goal',
          source: 'manual',
          importanceScore: priority === 'low' ? 0.7 : priority === 'medium' ? 0.8 : 0.9,
        });

        if (!result.stored && result.reason === 'duplicate') {
          return `Similar goal already exists. No new goal was added.`;
        }
        return `Goal stored: "${content.substring(0, 120)}" (priority: ${priority || 'high'}). This will always be in my context.`;
      } catch (err: any) {
        return `Failed to store goal: ${err.message}`;
      }
    },
    {
      name: 'set_goal',
      description: 'Explicitly create or update a goal. Use when the user states a goal, objective, or aspiration. Goals are always present in context.',
      schema: z.object({
        content: z.string().describe('The goal or objective'),
        priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level (default: high)'),
      }),
    },
  );

  // ── 50. recall_pattern ──────────────────────────────────────────
  const recallPattern = tool(
    async ({ query }) => {
      try {
        const patterns = await prisma.memoryPattern.findMany({
          where: { userId, isActive: true },
          orderBy: { confidence: 'desc' },
          take: 10,
        });

        if (patterns.length === 0) return 'No behavioral patterns discovered yet. Patterns emerge as I learn more about you.';

        // Filter by query if provided
        let filtered = patterns;
        if (query && query.trim().length > 0) {
          const lowerQuery = query.toLowerCase();
          filtered = patterns.filter(p =>
            p.pattern.toLowerCase().includes(lowerQuery)
          );
          if (filtered.length === 0) {
            return `No patterns matching "${query}". Here are all known patterns:\n${patterns.map(p => `- ${p.pattern} (confidence: ${(p.confidence * 100).toFixed(0)}%)`).join('\n')}`;
          }
        }

        return `Behavioral patterns:\n${filtered.map(p =>
          `- ${p.pattern} (confidence: ${(p.confidence * 100).toFixed(0)}%)`
        ).join('\n')}`;
      } catch (err: any) {
        return `Failed to recall patterns: ${err.message}`;
      }
    },
    {
      name: 'recall_pattern',
      description: 'Ask about discovered behavioral patterns, habits, or trends. Use when the user asks "what patterns do you see?", "what are my habits?", etc.',
      schema: z.object({
        query: z.string().optional().describe('Optional filter — what kind of pattern to look for'),
      }),
    },
  );

  // ── Life Wheel tools ────────────────────────────────────
  // Only register these when DimensionsService is wired in. They let the user
  // rate themselves mid-conversation without leaving Core Chat.

  const rateDimension = tool(
    async ({ dimension, score, note }) => {
      if (!dimensionsService) return 'Life Wheel is not available in this session.';
      try {
        const dim = String(dimension).toLowerCase();
        await dimensionsService.selfRate(userId, dim, score, note);
        const label = DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS] || dim;
        return `Recorded self-rating: ${label} = ${score}/10${note ? ` ("${note}")` : ''}. Saved for this week.`;
      } catch (err: any) {
        return `Failed to record rating: ${err.message}`;
      }
    },
    {
      name: 'rate_dimension',
      description:
        'Record a self-rating (1-10) for ONE life dimension. Use when the user says "I feel my health is a 4" or "my relationships are strong right now, maybe an 8". Only call after the user gives an explicit number.',
      schema: z.object({
        dimension: z
          .enum(['health', 'financial', 'career', 'intellectual', 'relationships', 'purpose'])
          .describe('Which life dimension the rating is for'),
        score: z.number().int().min(1).max(10).describe('Self-rated score, 1-10'),
        note: z.string().optional().describe('Optional short note explaining the rating'),
      }),
    },
  );

  const submitWeeklyCheckin = tool(
    async ({ ratings, note }) => {
      if (!dimensionsService) return 'Life Wheel is not available in this session.';
      try {
        const result = await dimensionsService.weeklyCheckin(userId, ratings as Record<string, number>, note);
        const lines = result.ratings.map(
          (r) => `  • ${DIMENSION_LABELS[r.dimension as keyof typeof DIMENSION_LABELS] || r.dimension}: ${r.score}/10`,
        );
        return `Weekly check-in saved (${result.weekStart}):\n${lines.join('\n')}`;
      } catch (err: any) {
        return `Failed to submit weekly check-in: ${err.message}`;
      }
    },
    {
      name: 'submit_weekly_checkin',
      description:
        'Submit the user\'s weekly Life Wheel check-in with ratings for multiple dimensions at once. Only use when the user has given ratings for several dimensions in one go (e.g. during the weekly ritual). Missing dimensions are skipped.',
      schema: z.object({
        ratings: z
          .object({
            health: z.number().int().min(1).max(10).optional(),
            financial: z.number().int().min(1).max(10).optional(),
            career: z.number().int().min(1).max(10).optional(),
            intellectual: z.number().int().min(1).max(10).optional(),
            relationships: z.number().int().min(1).max(10).optional(),
            purpose: z.number().int().min(1).max(10).optional(),
          })
          .describe('Map of dimension code to 1-10 score. Only include dimensions the user rated.'),
        note: z.string().optional().describe('Optional reflection note for the whole week'),
      }),
    },
  );

  const getLifeWheel = tool(
    async () => {
      if (!dimensionsService) return 'Life Wheel is not available in this session.';
      try {
        const wheel = await dimensionsService.getLifeWheel(userId);
        const lines = wheel.dimensions.map((d) => {
          const selfStr = d.selfScore !== null ? `self ${d.selfScore}/10` : 'no self-rating this week';
          const arrow = d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : '→';
          return `  • ${d.label}: observed ${d.observedScore}/10 ${arrow} (${selfStr}, ${d.signalsThisWeek} signals this week)`;
        });
        const nudge = wheel.needsWeeklyCheckin
          ? `\n\n(User hasn't done the weekly check-in for week ${wheel.weekStart} yet.)`
          : '';
        return `**Life Wheel** (week of ${wheel.weekStart}):\n${lines.join('\n')}${nudge}`;
      } catch (err: any) {
        return `Failed to fetch Life Wheel: ${err.message}`;
      }
    },
    {
      name: 'get_life_wheel',
      description:
        'Fetch the user\'s current Life Wheel: observed + self scores and trend for each of the 6 dimensions (health, financial, career, intellectual, relationships, purpose). Use when the user asks "how am I doing overall?", "show me my life wheel", or when you want to ground a coaching response in real data.',
      schema: z.object({}),
    },
  );

  return [
    createAction,
    createThought,
    updateProfile,
    queryPlanner,
    triggerPersonaAnalysis,
    searchMemories,
    createCheckin,
    searchRelationships,
    addRelationshipNote,
    suggestConversationStarters,
    searchConnections,
    sendMessage,
    getUnreadMessages,
    searchKnowledgeBase,
    getConversationHistory,
    searchMessages,
    addToCircle,
    updateCirclePerson,
    addRitual,
    addLifeEvent,
    addPlanTask,
    deletePlanTask,
    createPersona,
    deletePersona,
    deleteAction,
    getEveningReflection,
    getWeeklyReflection,
    getThinkingStats,
    getLifeDimensions,
    getPlannerStats,
    fetchPersonaResponse,
    createTension,
    listTensions,
    resolveTension,
    cooldownTension,
    completeRitual,
    deleteRitual,
    listUpcomingEvents,
    deleteLifeEvent,
    updateThoughtStatus,
    deleteThought,
    updateTaskStatus,
    getRelationshipHealth,
    linkActionToPlanner,
    getCheckin,
    updateMemory,
    forgetMemory,
    addManualMemory,
    setGoal,
    recallPattern,
    rateDimension,
    submitWeeklyCheckin,
    getLifeWheel,
  ];
}
