import { create } from 'zustand'

export interface Thought {
  id: string
  title: string
  rawText: string
  thoughtType: string
  status: string
  createdAt: string
  updatedAt: string
  threads: Thread[]
}

export interface Thread {
  id: string
  threadKey: string
  messages: Message[]
  runs: PersonaRun[]
  summary?: {
    runningSummary: string
  }
}

export interface Message {
  id: string
  role: string
  content: string
  personaId?: string
  modelName?: string
  createdAt: string
}

export interface PersonaRun {
  id: string
  personaId: string
  inputText: string
  outputText: string
  modelUsed: string
  persona: Persona
  createdAt: string
}

export interface Persona {
  id: string
  name: string
  description?: string
  systemPrompt: string
  modelName: string
  isActive: boolean
}

interface ThoughtState {
  thoughts: Thought[]
  currentThought: Thought | null
  setThoughts: (thoughts: Thought[]) => void
  setCurrentThought: (thought: Thought | null) => void
  addThought: (thought: Thought) => void
  updateThought: (thought: Thought) => void
  removeThought: (id: string) => void
}

export const useThoughtStore = create<ThoughtState>((set) => ({
  thoughts: [],
  currentThought: null,
  setThoughts: (thoughts) => set({ thoughts }),
  setCurrentThought: (thought) => set({ currentThought: thought }),
  addThought: (thought) => set((state) => ({ 
    thoughts: [thought, ...state.thoughts] 
  })),
  updateThought: (thought) => set((state) => ({
    thoughts: state.thoughts.map((t) => 
      t.id === thought.id ? thought : t
    ),
  })),
  removeThought: (id) => set((state) => ({
    thoughts: state.thoughts.filter((t) => t.id !== id),
  })),
}))
