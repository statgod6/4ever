import apiClient from './client'

export interface Ritual {
  id: string
  userId: string
  personId: string | null
  title: string
  frequency: string
  dayOfWeek: number | null
  lastDoneAt: string | null
  streak: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  isOverdue?: boolean
  nextDue?: string | null
  person?: { id: string; name: string; relationship: string } | null
}

export interface CreateRitualData {
  title: string
  frequency: string
  personId?: string
  dayOfWeek?: number
}

export const ritualsApi = {
  getAll: async (): Promise<Ritual[]> => {
    const res = await apiClient.get('/rituals')
    return res.data
  },

  create: async (data: CreateRitualData): Promise<Ritual> => {
    const res = await apiClient.post('/rituals', data)
    return res.data
  },

  complete: async (id: string): Promise<Ritual> => {
    const res = await apiClient.post(`/rituals/${id}/complete`)
    return res.data
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/rituals/${id}`)
  },
}
