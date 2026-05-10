import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThoughtAnalysisStateType } from '../state';

/**
 * Node: update_summary
 * Generates a running summary of the thread using an LLM call.
 * This summary is used to reduce prompt size in future interactions (PRD 9.8).
 */
export function createUpdateSummaryNode(
  prisma: PrismaService,
  openRouterApiKey: string,
  defaultModel: string,
) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    // Build a condensed view of the conversation for summarization
    const conversationParts: string[] = [];

    if (state.existingSummary) {
      conversationParts.push(`Previous summary: ${state.existingSummary}`);
    }

    conversationParts.push(`User thought: ${state.thought.rawText}`);

    for (const resp of state.personaResponses) {
      conversationParts.push(
        `${resp.personaName} (${resp.modelUsed}): ${resp.response.substring(0, 500)}`,
      );
    }

    const conversationText = conversationParts.join('\n\n');

    try {
      const model = new ChatOpenRouter({
        model: defaultModel,
        temperature: 0.3,
        maxTokens: 512,
        apiKey: openRouterApiKey,
      });

      const summaryResponse = await model.invoke([
        {
          role: 'system',
          content:
            'You are a concise summarizer. Create a brief running summary of this thought discussion thread. ' +
            'Capture key points, decisions, perspectives shared, and any action items. ' +
            'Keep it under 200 words. Focus on what would be useful context for future conversations.',
        },
        {
          role: 'user',
          content: `Summarize this discussion:\n\n${conversationText}`,
        },
      ]);

      const summaryText = typeof summaryResponse.content === 'string'
        ? summaryResponse.content
        : JSON.stringify(summaryResponse.content);

      // Upsert the summary in the database
      await prisma.thoughtSummary.upsert({
        where: { threadId: state.thread.id },
        create: {
          threadId: state.thread.id,
          runningSummary: summaryText,
        },
        update: {
          runningSummary: summaryText,
        },
      });

      return { newSummary: summaryText };
    } catch (error) {
      console.error('Error generating summary:', error);

      // Fallback: create a basic summary without LLM
      const fallbackSummary = `Thread contains ${state.threadMessages.length} messages and ${state.personaResponses.length} new persona responses about: "${state.thought.title}"`;

      await prisma.thoughtSummary.upsert({
        where: { threadId: state.thread.id },
        create: {
          threadId: state.thread.id,
          runningSummary: fallbackSummary,
        },
        update: {
          runningSummary: fallbackSummary,
        },
      });

      return { newSummary: fallbackSummary };
    }
  };
}
