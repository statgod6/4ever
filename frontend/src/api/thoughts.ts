import apiClient from './client'
import type { Thought } from '../store/thoughtStore'

export interface CreateThoughtData {
  title: string
  rawText: string
  thoughtType?: string
}

export interface UpdateThoughtData {
  title?: string
  rawText?: string
  thoughtType?: string
  status?: string
}

export const thoughtsApi = {
  getAll: async (): Promise<Thought[]> => {
    const response = await apiClient.get('/thoughts')
    // Support both old (array) and new (paginated) response formats
    const data = response.data
    return Array.isArray(data) ? data : data.items
  },

  getById: async (id: string): Promise<Thought> => {
    const response = await apiClient.get(`/thoughts/${id}`)
    return response.data
  },

  create: async (data: CreateThoughtData): Promise<Thought> => {
    const response = await apiClient.post('/thoughts', data)
    return response.data
  },

  update: async (id: string, data: UpdateThoughtData): Promise<Thought> => {
    const response = await apiClient.put(`/thoughts/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/thoughts/${id}`)
  },

  continueThread: async (threadId: string, content: string) => {
    const response = await apiClient.post(`/thoughts/${threadId}/continue`, { content })
    return response.data
  },
}
