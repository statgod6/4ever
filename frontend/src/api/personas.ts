import apiClient from './client'
import type { Persona } from '../store/personaStore'

export interface CreatePersonaData {
  name: string
  description?: string
  systemPrompt: string
  modelName?: string
}

export interface UpdatePersonaData {
  name?: string
  description?: string
  systemPrompt?: string
  modelName?: string
  isActive?: boolean
}

export const personasApi = {
  getAll: async (): Promise<Persona[]> => {
    const response = await apiClient.get('/personas')
    return response.data
  },

  getActive: async (): Promise<Persona[]> => {
    const response = await apiClient.get('/personas/active')
    return response.data
  },

  getById: async (id: string): Promise<Persona> => {
    const response = await apiClient.get(`/personas/${id}`)
    return response.data
  },

  create: async (data: CreatePersonaData): Promise<Persona> => {
    const response = await apiClient.post('/personas', data)
    return response.data
  },

  update: async (id: string, data: UpdatePersonaData): Promise<Persona> => {
    const response = await apiClient.put(`/personas/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/personas/${id}`)
  },
}
