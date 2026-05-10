import apiClient from './client'

export interface DailyCheckIn {
  id: string
  date: string
  mood: number
  energy: number
  note: string | null
}

export const checkInApi = {
  getCheckIn: async (date: string): Promise<DailyCheckIn | null> => {
    const { data } = await apiClient.get(`/checkin/${date}`)
    return data
  },

  saveCheckIn: async (date: string, mood: number, energy: number, note?: string): Promise<DailyCheckIn> => {
    const { data } = await apiClient.put(`/checkin/${date}`, { mood, energy, note })
    return data
  },

  getRecentCheckIns: async (days: number = 14): Promise<DailyCheckIn[]> => {
    const { data } = await apiClient.get(`/checkin/recent?days=${days}`)
    return data
  },
}
