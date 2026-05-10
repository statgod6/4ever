import apiClient from './client'

export interface TopicDistribution {
  type: string
  count: number
  percentage: number
}

export interface TimelineWeek {
  week: string
  count: number
  types: string[]
}

export interface StatusFlow {
  statuses: { status: string; count: number }[]
  total: number
  resolutionRate: number
}

export interface PersonaEffectiveness {
  personaId: string
  personaName: string
  totalResponses: number
  directReplies: number
  thoughtsParticipated: number
  thoughtsResolved: number
  resolutionRate: number
  engagementScore: number
}

export interface InsightStats {
  topicDistribution: TopicDistribution[]
  timeline: TimelineWeek[]
  statusFlow: StatusFlow
  personaEffectiveness: PersonaEffectiveness[]
}

export interface RecurringTopic {
  thoughtIds: string[]
  thoughts: { id: string; title: string; type: string; date: string }[]
  size: number
}

export interface InsightReport {
  id: string
  reportType: string
  title: string
  content: string
  metadata?: string
  createdAt: string
}

export interface LifeDimension {
  dimension: string
  thoughtCount: number
  lastThoughtDate: string | null
  percentage: number
}

export interface RelationshipHealthReport {
  connectionId: string
  partner: { id: string; name: string; avatarUrl: string | null }
  mediatorStyle: string
  periodDays: number
  summary: {
    totalSessions: number
    totalMessages: number
    lastMediationAt: string | null
    lastMediationSummary: string | null
    lastMediationTopic: string | null
  }
  topTopics: { topic: string; count: number }[]
  actions: Record<string, { created: number; accepted: number }>
  trend: {
    sessions: { current: number; previous: number; change: number }
    messages: { current: number; previous: number; change: number }
  }
}

export interface RelationshipHealthResponse {
  optIn: boolean
  reports: RelationshipHealthReport[]
}

export const insightsApi = {
  getStats: async (): Promise<InsightStats> => {
    const { data } = await apiClient.get('/insights/stats')
    return data
  },

  getRecurringTopics: async (): Promise<RecurringTopic[]> => {
    const { data } = await apiClient.get('/insights/recurring-topics')
    return data
  },

  generateEvolution: async (thoughtIds: string[]): Promise<InsightReport> => {
    const { data } = await apiClient.post('/insights/evolution', { thoughtIds })
    return data
  },

  generateWeeklyInsight: async (): Promise<InsightReport> => {
    const { data } = await apiClient.post('/insights/weekly')
    return data
  },

  getReports: async (): Promise<InsightReport[]> => {
    const { data } = await apiClient.get('/insights/reports')
    return data
  },

  getLifeDimensions: async (): Promise<LifeDimension[]> => {
    const { data } = await apiClient.get('/insights/life-dimensions')
    return data
  },

  getRelationshipHealth: async (params?: { connectionId?: string; days?: number }): Promise<RelationshipHealthResponse> => {
    const { data } = await apiClient.get('/insights/relationship-health', { params })
    return data
  },
}
