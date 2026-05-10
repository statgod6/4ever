import { Logger } from '@nestjs/common';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ThoughtAnalysisStateType, PersonaResponse } from '../state';

const logger = new Logger('RunPersonasNode');

const FALLBACK_MODELS = [
  'deepseek/deepseek-v3.2',
  'deepseek/deepseek-chat-v3-0324',
  'google/gemini-2.0-flash-001',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to invoke an LLM with retry logic and fallback models.
 * Tries the primary model up to MAX_RETRIES times, then falls back
 * to alternative models before giving up.
 */
export async function invokeWithRetry(
  openRouterApiKey: string,
  primaryModel: string,
  defaultModel: string,
  langchainMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<{ text: string; modelUsed: string }> {
  // Build model list: primary first, then fallbacks (deduped)
  const models = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];

  for (const modelName of models) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const model = new ChatOpenRouter({
          model: modelName,
          temperature: 0.7,
          maxTokens: 2048,
          apiKey: openRouterApiKey,
        });

        const response = await model.invoke(langchainMessages);
        const text = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

        return { text, modelUsed: modelName };
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.response?.status === 429;
        const isServerError = error?.status >= 500 || error?.response?.status >= 500;
        const isRetryable = isRateLimit || isServerError;

        logger.warn(
          `[Attempt ${attempt}/${MAX_RETRIES}] Model ${modelName} failed: ${error?.message || 'Unknown error'}`,
        );

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // exponential backoff
          await sleep(delay);
          continue;
        }
        // Non-retryable or exhausted retries for this model -> try next model
        break;
      }
    }
  }

  // All models exhausted
  throw new Error(`All models failed after retries. Tried: ${models.join(', ')}`);
}

/**
 * Node: run_personas
 * For each selected persona, calls OpenRouter LLM via ChatOpenRouter
 * with the assembled prompt. Each persona can use its own model (PRD 12.5).
 * Includes retry logic with exponential backoff and fallback models.
 */
export function createRunPersonasNode(
  openRouterApiKey: string,
  defaultModel: string,
) {
  return async (state: ThoughtAnalysisStateType): Promise<Partial<ThoughtAnalysisStateType>> => {
    const personaResponses: PersonaResponse[] = [];

    for (const prompt of state.personaPrompts) {
      const { persona, messages } = prompt;
      const modelName = persona.modelName || defaultModel;

      const langchainMessages = messages.map((msg) => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      }));

      try {
        const result = await invokeWithRetry(
          openRouterApiKey,
          modelName,
          defaultModel,
          langchainMessages,
        );

        personaResponses.push({
          personaId: persona.id,
          personaName: persona.name,
          response: result.text,
          modelUsed: result.modelUsed,
        });
      } catch (error: any) {
        logger.error(`All retries exhausted for persona ${persona.name}:`, error?.stack);

        personaResponses.push({
          personaId: persona.id,
          personaName: persona.name,
          response: `[Error] Failed to generate response from ${persona.name} after multiple retries across fallback models. Please try again later.`,
          modelUsed: modelName,
        });
      }
    }

    return { personaResponses };
  };
}
