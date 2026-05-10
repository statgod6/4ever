import apiClient from './client'

export interface ActionItem {
  id: string
  userId: string
  threadId: string
  personaId: string | null
  content: string
  dimension: string | null
  status: string
  dueDate: string | null
  createdAt: string
  thoughtTitle: string
  thoughtId: string | null
  personaName: string | null
}

export const actionsApi = {
  getActionItems: async (status?: string): Promise<ActionItem[]> => {
    const params = status ? `?status=${status}` : ''
    const { data } = await apiClient.get(`/actions${params}`)
    return data
  },

  updateActionStatus: async (id: string, status: 'done' | 'dismissed'): Promise<ActionItem> => {
    const { data } = await apiClient.patch(`/actions/${id}/status`, { status })
    return data
  },

  linkToPlanner: async (id: string, date: string, timeSlot: string): Promise<any> => {
    const { data } = await apiClient.post(`/actions/${id}/to-planner`, { date, timeSlot })
    return data
  },
}
