import apiClient from './client'

export interface Memory {
  id: string
  content: string
  importanceScore: number
  accessCount: number
  status: string
  category: string | null
  source: string | null
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryStats {
  total: number
  active: number
  byType: { type: string; count: number }[]
  bySource: { source: string; count: number }[]
  byStatus: { status: string; count: number }[]
  oldestMemory: string | null
  newestMemory: string | null
}

export interface ProfileChangeEntry {
  id: string
  field: string
  oldValue: string | null
  newValue: string
  source: string
  createdAt: string
}

export interface SessionSummary {
  id: string
  sessionStart: string
  sessionEnd: string
  summary: string
  messageCount: number
  keyTopics: string | null
  createdAt: string
}

export const memoriesApi = {
  list: async (params?: { status?: string; category?: string; limit?: number; offset?: number }) => {
    const response = await apiClient.get('/orchestration/memories', { params })
    return response.data?.memories as Memory[] ?? response.data as Memory[]
  },

  search: async (query: string, limit = 10) => {
    const response = await apiClient.get('/orchestration/memories/search', { params: { q: query, limit } })
    return response.data as (Memory & { similarity: number })[]
  },

  getStats: async () => {
    const response = await apiClient.get('/orchestration/memories/stats')
    return response.data as MemoryStats
  },

  create: async (content: string, category?: string) => {
    const response = await apiClient.post('/orchestration/memories', { content, category })
    return response.data as { stored: boolean; memoryId: string | null; reason?: string }
  },

  update: async (id: string, data: { content?: string; status?: string; category?: string; importanceScore?: number }) => {
    const response = await apiClient.put(`/orchestration/memories/${id}`, data)
    return response.data as Memory
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/orchestration/memories/${id}`)
    return response.data
  },

  consolidate: async () => {
    const response = await apiClient.post('/orchestration/memories/consolidate')
    return response.data as { merged: number; contradictions: number }
  },

  getProfileChangelog: async (limit = 50, cursor?: string) => {
    const response = await apiClient.get('/orchestration/profile-changelog', { params: { limit, cursor } })
    const data = response.data
    return (data?.logs ?? data) as ProfileChangeEntry[]
  },

  getSessionSummaries: async (limit = 20) => {
    const response = await apiClient.get('/orchestration/session-summaries', { params: { limit } })
    return response.data as SessionSummary[]
  },
}
