import { PrismaService } from '../../../prisma/prisma.service';
import { createPythonAnalystTool } from './python-analyst.tool';
import { createKnowledgeWorkerWebTools } from './web-tools';
import { createReadDocumentTool, createListDocumentsTool } from './read-document.tool';
import { createGenerateDocumentTool } from './generate-document.tool';

/**
 * Builds the Knowledge Worker tool list.
 *
 * Phase 2: python_analyst (E2B), web_search/url_reader/news_search/deep_research (Tavily),
 *          list_documents + read_document (pgvector over user uploads).
 * Phase 3: generate_document (PDF/DOCX export).
 * Phase 4: MCP tools (Gmail / Calendar / Notion / Drive) — user-configured.
 */
export function createKnowledgeWorkerTools(
  prisma: PrismaService,
  userId: string,
  conversationId: string,
  openRouterApiKey: string,
  config: {
    tavilyApiKey?: string;
    e2bApiKey?: string;
  },
): any[] {
  const tools: any[] = [];

  // python_analyst — always registered. Self-reports when E2B_API_KEY is missing.
  tools.push(createPythonAnalystTool(prisma, conversationId, config.e2bApiKey, userId));

  // Web research — each tool self-reports when TAVILY_API_KEY is missing.
  tools.push(...createKnowledgeWorkerWebTools(config.tavilyApiKey));

  // User-document tools (pgvector search over kw_document_chunks).
  tools.push(createListDocumentsTool(prisma, userId));
  tools.push(createReadDocumentTool(prisma, userId, openRouterApiKey));

  // Document generation (PDF / DOCX).
  tools.push(createGenerateDocumentTool(userId));

  return tools;
}
