import { StateGraph, START, END } from '@langchain/langgraph';
import { PrismaService } from '../../prisma/prisma.service';
import { ThoughtAnalysisState } from './state';

import { createRetrieveMemoryNode } from './nodes/retrieve-memory.node';
import { createLoadThreadHistoryNode } from './nodes/load-thread-history.node';
import { createBuildPromptsNode } from './nodes/build-prompts.node';
import { createRunPersonasNode } from './nodes/run-personas.node';
import { createSaveResponsesNode } from './nodes/save-responses.node';
import { createThinkingOsCoreNode } from './nodes/thinking-os-core.node';
import { createUpdateSummaryNode } from './nodes/update-summary.node';
import { createStoreMemoryNode } from './nodes/store-memory.node';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';

/**
 * Creates and compiles the Thought Analysis LangGraph.
 *
 * Graph flow (per PRD Section 12.4):
 *   START
 *     -> retrieve_memory    (fetch relevant long-term memories)
 *     -> load_thread_history (load prior messages + summary)
 *     -> build_prompts       (construct persona-specific prompts)
 *     -> run_personas        (call LLMs via OpenRouter per persona)
 *     -> save_responses      (persist runs + messages to DB)
 *     -> update_summary      (generate running thread summary)
 *     -> store_memory        (extract + save new long-term memories)
 *   -> END
 */
export function createThoughtAnalysisGraph(
  prisma: PrismaService,
  openRouterApiKey: string,
  defaultModel: string,
  knowledgeBaseService?: KnowledgeBaseService,
) {
  // Instantiate node functions with their dependencies
  const retrieveMemory = createRetrieveMemoryNode(prisma, openRouterApiKey);
  const loadThreadHistory = createLoadThreadHistoryNode(prisma);
  const buildPrompts = createBuildPromptsNode(knowledgeBaseService);
  const runPersonas = createRunPersonasNode(openRouterApiKey, defaultModel);
  const saveResponses = createSaveResponsesNode(prisma);
  const thinkingOsCore = createThinkingOsCoreNode(prisma, openRouterApiKey, defaultModel);
  const updateSummary = createUpdateSummaryNode(prisma, openRouterApiKey, defaultModel);
  const storeMemory = createStoreMemoryNode(prisma, openRouterApiKey, defaultModel);

  // Build the StateGraph
  const graph = new StateGraph(ThoughtAnalysisState)
    .addNode('retrieve_memory', retrieveMemory)
    .addNode('load_thread_history', loadThreadHistory)
    .addNode('build_prompts', buildPrompts)
    .addNode('run_personas', runPersonas)
    .addNode('save_responses', saveResponses)
    .addNode('thinking_os_core', thinkingOsCore)
    .addNode('update_summary', updateSummary)
    .addNode('store_memory', storeMemory)
    // Linear edge chain: START -> ... -> END
    .addEdge(START, 'retrieve_memory')
    .addEdge('retrieve_memory', 'load_thread_history')
    .addEdge('load_thread_history', 'build_prompts')
    .addEdge('build_prompts', 'run_personas')
    .addEdge('run_personas', 'save_responses')
    .addEdge('save_responses', 'thinking_os_core')
    .addEdge('thinking_os_core', 'update_summary')
    .addEdge('update_summary', 'store_memory')
    .addEdge('store_memory', END);

  return graph.compile();
}
