import apiClient from './client'

export interface LifeEvent {
  id: string
  userId: string
  personId: string | null
  title: string
  eventDate: string
  eventType: string
  isRecurring: boolean
  remindDaysBefore: number
  note: string | null
  createdAt: string
  nextOccurrence?: string
  person?: { id: string; name: string; relationship: string } | null
}

export interface CreateLifeEventData {
  title: string
  eventDate: string
  eventType: string
  personId?: string
  isRecurring?: boolean
  remindDaysBefore?: number
  note?: string
}

export const lifeEventsApi = {
  getAll: async (): Promise<LifeEvent[]> => {
    const res = await apiClient.get('/life-events')
    return res.data
  },

  getUpcoming: async (days = 30): Promise<LifeEvent[]> => {
    const res = await apiClient.get(`/life-events/upcoming?days=${days}`)
    return res.data
  },

  getByPerson: async (personId: string): Promise<LifeEvent[]> => {
    const res = await apiClient.get(`/life-events/person/${personId}`)
    return res.data
  },

  create: async (data: CreateLifeEventData): Promise<LifeEvent> => {
    const res = await apiClient.post('/life-events', data)
    return res.data
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/life-events/${id}`)
  },
}
