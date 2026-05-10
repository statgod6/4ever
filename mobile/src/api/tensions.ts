import apiClient from './client'

export interface TensionEntry {
  id: string; userId: string; personId: string | null; title: string;
  description: string; intensity: number; status: string;
  coolDownUntil: string | null; resolvedAt: string | null; resolution: string | null;
  createdAt: string; updatedAt: string;
  person?: { id: string; name: string; relationship: string } | null
}

export interface CreateTensionData {
  title: string; description: string; personId?: string;
  intensity?: number; coolDownMinutes?: number
}

export const tensionsApi = {
  getAll: async (): Promise<TensionEntry[]> => {
    const res = await apiClient.get('/tensions')
    return res.data
  },
  create: async (data: CreateTensionData): Promise<TensionEntry> => {
    const res = await apiClient.post('/tensions', data)
    return res.data
  },
  startCoolDown: async (id: string, minutes: number): Promise<TensionEntry> => {
    const res = await apiClient.post(`/tensions/${id}/cool-down`, { minutes })
    return res.data
  },
  resolve: async (id: string, resolution?: string): Promise<TensionEntry> => {
    const res = await apiClient.post(`/tensions/${id}/resolve`, { resolution })
    return res.data
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/tensions/${id}`)
  },
}
