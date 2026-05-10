import apiClient from './client'

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
  summary?: { runningSummary: string }
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
  persona: { id: string; name: string; description?: string; systemPrompt: string; modelName: string; isActive: boolean }
  createdAt: string
}

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
