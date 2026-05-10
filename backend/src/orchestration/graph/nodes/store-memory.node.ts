import { Logger } from '@nestjs/common';
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThoughtAnalysisStateType } from '../state';
import { storeMemoryWithDedup } from '../utils/memory-utils';

const logger = new Logger('StoreMemoryNode');

/**
 * Node: store_memory
 * Extracts key facts from the conversation and stores them as long-term memories.
 * Uses an LLM call to intelligently extract important information (PRD 9.5).
 */
export function createStoreMemoryNode(
  prisma: PrismaService,
  openRouterApiKey: string,
  defaultModel: string,
) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    // Build context for memory extraction — include ALL available context for richer memories
    const contextParts: string[] = [];
    contextParts.push(`Thought title: ${state.thought.title}`);
    contextParts.push(`Thought type: ${state.thought.thoughtType}`);
    contextParts.push(`Thought content: ${state.thought.rawText}`);

    // Include user's current situation for context
    if (state.userContext) {
      const ctxParts: string[] = [];
      if (state.userContext.goals) ctxParts.push(`Goals: ${state.userContext.goals}`);
      if (state.userContext.situation) ctxParts.push(`Situation: ${state.userContext.situation}`);
      if (ctxParts.length > 0) contextParts.push(`User context: ${ctxParts.join('; ')}`);
    }

    // Include mood/energy for emotional context in memories
    if (state.moodContext) {
      contextParts.push(`Recent mood/energy: ${state.moodContext.split('\n').slice(0, 3).join('; ')}`);
    }

    // Include completion patterns for behavioral context
    if (state.completionStatsContext) {
      contextParts.push(`Task patterns: ${state.completionStatsContext.split('\n').slice(0, 2).join('; ')}`);
    }

    for (const resp of state.personaResponses) {
      contextParts.push(`${resp.personaName}: ${resp.response.substring(0, 300)}`);
    }

    const contextText = contextParts.join('\n\n');

    try {
      const model = new ChatOpenRouter({
        model: defaultModel,
        temperature: 0.2,
        maxTokens: 512,
        apiKey: openRouterApiKey,
      });

      const memoryResponse = await model.invoke([
        {
          role: 'system',
          content:
            'You are a memory extraction assistant. From the following thought discussion, extract 1-3 key facts, ' +
            'decisions, or insights that would be useful to remember for future conversations. ' +
            'Return each memory as a separate line. Each line should be a concise, standalone fact. ' +
            'If there are no important facts to remember, respond with "NONE".',
        },
        {
          role: 'user',
          content: contextText,
        },
      ]);

      const memoryText = typeof memoryResponse.content === 'string'
        ? memoryResponse.content
        : JSON.stringify(memoryResponse.content);

      if (memoryText.trim().toUpperCase() !== 'NONE') {
        const memoryLines = memoryText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && line.length < 500);

        for (const line of memoryLines.slice(0, 3)) {
          await storeMemoryWithDedup(prisma, openRouterApiKey, {
            userId: state.userId,
            content: line,
            memoryType: state.thought.thoughtType,
            importanceScore: 0.7,
            sourceThreadId: state.thread.id,
            source: 'thought',
          });
        }
      }
    } catch (error) {
      logger.error('Error extracting memories:', error?.stack ?? error);

      // Fallback: store a basic memory
      await storeMemoryWithDedup(prisma, openRouterApiKey, {
        userId: state.userId,
        content: `Discussed "${state.thought.title}" with ${state.personas.length} persona(s).`,
        memoryType: state.thought.thoughtType,
        importanceScore: 0.5,
        sourceThreadId: state.thread.id,
        source: 'thought',
      });
    }

    return { memoriesStored: true };
  };
}
