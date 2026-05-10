// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
import { ChatOpenRouter } from '@langchain/openrouter';
import type { MediatorActionCard } from '../mediator.service';
import { buildMediatorPrompt } from './mediator-prompt';
import { createAnalyzeMoodsTool } from './tools/analyze-moods.tool';
import { createMediatorActionTools } from './tools/mediator-action-tools';
import { createWikipediaLookupTool } from './tools/wikipedia.tool';
import { createMediatorWebSearchTool } from './tools/web-search.tool';

/**
 * LangGraph ReAct agent for the tri-chat mediator (4Ever).
 *
 * Parallels `createCoreChatAgent()` and `createKnowledgeWorkerAgent()`.
 * Built per-request because the tools are bound to the current connection's
 * transcript + a mutable action-collection array.
 *
 * Flow: START -> agent (LLM decides) -> tools -> agent -> ... -> END
 * The prompt enforces `analyze_moods` as the mandatory first tool call.
 *
 * No `style` flag: personality is purely prompt-driven (tone-mirror the user).
 */
export function createMediatorAgent(params: {
  openRouterApiKey: string;
  model: string;
  summonerName: string;
  otherName: string;
  mediatorName?: string;
  transcript: string;
  collectedActions: MediatorActionCard[];
  tavilyApiKey?: string;
}) {
  const {
    openRouterApiKey,
    model,
    summonerName,
    otherName,
    mediatorName,
    transcript,
    collectedActions,
    tavilyApiKey,
  } = params;

  const llm = new ChatOpenRouter({
    model,
    temperature: 0.75,
    maxTokens: 400,
    apiKey: openRouterApiKey,
  });

  const tools = [
    createAnalyzeMoodsTool({
      openRouterApiKey,
      model,
      transcript,
      summonerName,
      otherName,
    }),
    createWikipediaLookupTool(),
    createMediatorWebSearchTool(tavilyApiKey),
    ...createMediatorActionTools(collectedActions),
  ];

  const systemPrompt = buildMediatorPrompt({ summonerName, otherName, mediatorName });

  return {
    agent: createReactAgent({ llm, tools }),
    systemPrompt,
  };
}
