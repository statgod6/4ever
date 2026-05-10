import { PrismaService } from '../../../prisma/prisma.service';
import { ThoughtAnalysisStateType } from '../state';

/**
 * Node: save_responses
 * Persists persona runs and messages to the database.
 *
 * Note: Action item extraction has been moved to the thinking_os_core node,
 * which sees ALL persona responses together and produces deduplicated,
 * curated actions in a unified pass.
 */
export function createSaveResponsesNode(prisma: PrismaService) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    for (const personaResponse of state.personaResponses) {
      // Save PersonaRun
      await prisma.personaRun.create({
        data: {
          threadId: state.thread.id,
          personaId: personaResponse.personaId,
          inputText: state.thought.rawText,
          outputText: personaResponse.response,
          modelUsed: personaResponse.modelUsed,
        },
      });

      // Save as Message in the thread
      await prisma.message.create({
        data: {
          threadId: state.thread.id,
          role: 'assistant',
          content: personaResponse.response,
          personaId: personaResponse.personaId,
          modelName: personaResponse.modelUsed,
        },
      });
    }

    return { responsesSaved: true };
  };
}
