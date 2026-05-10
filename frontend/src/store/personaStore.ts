import { create } from 'zustand'

export interface Persona {
  id: string
  name: string
  description?: string
  systemPrompt: string
  modelName: string
  category?: string | null
  isTemplate: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface PersonaState {
  personas: Persona[]
  setPersonas: (personas: Persona[]) => void
  addPersona: (persona: Persona) => void
  updatePersona: (persona: Persona) => void
  removePersona: (id: string) => void
}

export const usePersonaStore = create<PersonaState>((set) => ({
  personas: [],
  setPersonas: (personas) => set({ personas }),
  addPersona: (persona) => set((state) => ({ 
    personas: [persona, ...state.personas] 
  })),
  updatePersona: (persona) => set((state) => ({
    personas: state.personas.map((p) => 
      p.id === persona.id ? persona : p
    ),
  })),
  removePersona: (id) => set((state) => ({
    personas: state.personas.filter((p) => p.id !== id),
  })),
}))
