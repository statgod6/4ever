import { create } from 'zustand'
import type { Persona } from '../api/personas'

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
  addPersona: (persona) => set((state) => ({ personas: [persona, ...state.personas] })),
  updatePersona: (persona) => set((state) => ({
    personas: state.personas.map((p) => p.id === persona.id ? persona : p),
  })),
  removePersona: (id) => set((state) => ({
    personas: state.personas.filter((p) => p.id !== id),
  })),
}))
