import { Annotation } from '@langchain/langgraph';

/**
 * Interfaces matching our Prisma models for type safety within the graph.
 */
export interface ThoughtData {
  id: string;
  userId: string;
  title: string;
  rawText: string;
  thoughtType: string;
  status: string;
}

export interface ThreadData {
  id: string;
  thoughtId: string;
  threadKey: string;
}

export interface PersonaData {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  modelName: string;
  isActive: boolean;
}

export interface UserContextData {
  name?: string | null;
  age?: string | null;
  location?: string | null;
  role?: string | null;
  background?: string | null;
  currentProjects?: string | null;
  goals?: string | null;
  situation?: string | null;
  values?: string | null;
  pendingDecisions?: string | null;
  freeformContext?: string | null;
}

export interface MessageData {
  id: string;
  threadId: string;
  role: string;
  content: string;
  personaId: string | null;
  modelName: string | null;
  createdAt: Date;
}

export interface MemoryData {
  id: string;
  userId: string;
  memoryType: string;
  content: string;
  importanceScore: number;
  sourceThreadId: string | null;
  createdAt: Date;
}

export interface PersonaPrompt {
  persona: PersonaData;
  messages: Array<{ role: string; content: string }>;
}

export interface PersonaResponse {
  personaId: string;
  personaName: string;
  response: string;
  modelUsed: string;
}

export interface SummaryData {
  runningSummary: string;
}

/**
 * LangGraph State Annotation for the Thought Analysis workflow.
 * 
 * This defines all the data that flows through the graph nodes:
 * - Input: thought, personas, thread, userId
 * - Intermediate: memories, threadMessages, existingSummary, personaPrompts
 * - Output: personaResponses, newSummary
 */
export const ThoughtAnalysisState = Annotation.Root({
  // --- Inputs (set before graph invocation) ---
  userId: Annotation<string>,
  thought: Annotation<ThoughtData>,
  thread: Annotation<ThreadData>,
  personas: Annotation<PersonaData[]>,
  userContext: Annotation<UserContextData | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  calendarContext: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  moodContext: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  completionStatsContext: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  pendingActionsContext: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // --- Populated by retrieve_memory node ---
  memories: Annotation<MemoryData[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // --- Populated by load_thread_history node ---
  threadMessages: Annotation<MessageData[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  existingSummary: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // --- Populated by build_prompts node ---
  personaPrompts: Annotation<PersonaPrompt[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // --- Populated by run_personas node ---
  personaResponses: Annotation<PersonaResponse[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // --- Populated by update_summary node ---
  newSummary: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  // --- Populated by store_memory node ---
  memoriesStored: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  // --- Populated by save_responses node ---
  responsesSaved: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  // --- Populated by thinking_os_core node ---
  coreSynthesis: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  coreActions: Annotation<Array<{ content: string; dimension: string | null; priority: string }>>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  profileUpdates: Annotation<Record<string, string> | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type ThoughtAnalysisStateType = typeof ThoughtAnalysisState.State;
