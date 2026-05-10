import apiClient from './client'

export interface EveningReflection { reflection: string; date: string }
export interface WeeklyReflectionStats {
  totalTasks: number; doneTasks: number; skippedTasks: number;
  completionRate: number; avgMood: string; avgEnergy: string;
  thoughtCount: number; daysPlanned: number; checkInsLogged: number
}
export interface WeeklyReflection { reflection: string; stats: WeeklyReflectionStats }

export const reflectionsApi = {
  getEvening: async (): Promise<EveningReflection> => {
    const { data } = await apiClient.get('/reflections/evening')
    return data
  },
  getWeekly: async (): Promise<WeeklyReflection> => {
    const { data } = await apiClient.get('/reflections/weekly')
    return data
  },
}
