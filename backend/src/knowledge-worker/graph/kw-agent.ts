// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../../prisma/prisma.service';
import { createKnowledgeWorkerTools } from './tools/kw-tools';

/**
 * Knowledge Worker agent — premium-gated, separate from Core Chat.
 *
 * Parallels createCoreChatAgent() in structure, but runs on its own tool set
 * and its own conversation tables (kw_conversations, kw_messages).
 *
 * Created per-request because tools are bound to userId + conversationId
 * (stateful sandbox, user-scoped document access, etc.).
 */
export function createKnowledgeWorkerAgent(params: {
  prisma: PrismaService;
  userId: string;
  conversationId: string;
  openRouterApiKey: string;
  model: string;
  tavilyApiKey?: string;
  e2bApiKey?: string;
}) {
  const {
    prisma,
    userId,
    conversationId,
    openRouterApiKey,
    model,
    tavilyApiKey,
    e2bApiKey,
  } = params;

  const tools = createKnowledgeWorkerTools(
    prisma,
    userId,
    conversationId,
    openRouterApiKey,
    { tavilyApiKey, e2bApiKey },
  );

  const llm = new ChatOpenRouter({
    model,
    temperature: 0.4, // cooler than companion: precision matters for knowledge work
    maxTokens: 50000,
    apiKey: openRouterApiKey,
  });

  return createReactAgent({ llm, tools });
}
