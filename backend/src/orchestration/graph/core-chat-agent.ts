// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../../prisma/prisma.service';
import { createCoreChatTools } from './tools/core-chat-tools';
import { createExternalTools } from './tools/external-tools';
import { DimensionsService } from '../../dimensions/dimensions.service';
import { MemoryManagerService } from '../../memory-os/memory-manager.service';

/**
 * Creates a LangGraph ReAct agent for Core Chat.
 *
 * The agent is created per-request because tools need the userId bound into them.
 * This is lightweight — createReactAgent is just graph construction, not LLM calls.
 *
 * Flow: START -> agent (LLM decides) -> tools (execute) -> agent -> ... -> END
 * Safety: recursionLimit caps the think-tool-think loop.
 */
export function createCoreChatAgent(
  prisma: PrismaService,
  userId: string,
  openRouterApiKey: string,
  defaultModel: string,
  tavilyApiKey?: string,
  dimensionsService?: DimensionsService,
  pendingCreator?: any,
  memoryManager?: MemoryManagerService,
) {
  const internalTools = createCoreChatTools(prisma, userId, openRouterApiKey, dimensionsService, memoryManager);
  const externalTools = createExternalTools(tavilyApiKey);
  const tools = [...internalTools, ...externalTools];

  const model = new ChatOpenRouter({
    model: defaultModel,
    temperature: 0.7,
    maxTokens: 50000,
    apiKey: openRouterApiKey,
  });

  return createReactAgent({
    llm: model,
    tools,
  });
}

/**
 * Returns just the tool list (internal + external) without creating the agent.
 * Used by the streaming Core Chat path which manages the agent loop separately.
 */
export function getCoreChatToolList(
  prisma: PrismaService,
  userId: string,
  openRouterApiKey: string,
  tavilyApiKey?: string,
  dimensionsService?: DimensionsService,
  pendingCreator?: any,
  memoryManager?: MemoryManagerService,
) {
  const internalTools = createCoreChatTools(prisma, userId, openRouterApiKey, dimensionsService, memoryManager);
  const externalTools = createExternalTools(tavilyApiKey);
  return [...internalTools, ...externalTools];
}
