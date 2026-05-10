import apiClient from './client'

export interface PlanTask {
  id: string
  timeSlot: string
  task: string
  insight: string | null
  status: string
  completedAt: string | null
  sortOrder: number
}

export interface DayPlan {
  id: string
  date: string
  tasks: PlanTask[]
}

export interface TaskInsightResult {
  taskId: string
  insight: string
  cached: boolean
}

export interface PlannedDate {
  date: string
  taskCount: number
}

export interface CompletionStats {
  total: number
  done: number
  skipped: number
  pending: number
  completionRate: number
  streak: number
  days: number
}

export const plannerApi = {
  getPlan: async (date: string): Promise<DayPlan | null> => {
    const { data } = await apiClient.get(`/planner/${date}`)
    return data
  },

  savePlan: async (date: string, tasks: { timeSlot: string; task: string; sortOrder: number; insight?: string | null }[]): Promise<DayPlan> => {
    const { data } = await apiClient.put(`/planner/${date}`, { tasks })
    return data
  },

  getTaskInsight: async (taskId: string): Promise<TaskInsightResult> => {
    const { data } = await apiClient.post(`/planner/insight/${taskId}`)
    return data
  },

  getPlannedDates: async (year: number, month: number): Promise<PlannedDate[]> => {
    const { data } = await apiClient.get(`/planner/dates/${year}/${month}`)
    return data
  },

  updateTaskStatus: async (taskId: string, status: 'done' | 'skipped' | 'pending'): Promise<PlanTask> => {
    const { data } = await apiClient.patch(`/planner/task/${taskId}/status`, { status })
    return data
  },

  getCompletionStats: async (days: number = 7): Promise<CompletionStats> => {
    const { data } = await apiClient.get(`/planner/stats?days=${days}`)
    return data
  },
}
