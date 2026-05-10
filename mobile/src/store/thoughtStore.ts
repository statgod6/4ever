import { create } from 'zustand'
import type { Thought } from '../api/thoughts'

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
  addThought: (thought) => set((state) => ({ thoughts: [thought, ...state.thoughts] })),
  updateThought: (thought) => set((state) => ({
    thoughts: state.thoughts.map((t) => t.id === thought.id ? thought : t),
  })),
  removeThought: (id) => set((state) => ({
    thoughts: state.thoughts.filter((t) => t.id !== id),
  })),
}))
