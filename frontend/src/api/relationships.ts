import apiClient from './client'

export interface RelationshipPerson {
  id: string
  name: string
  relationship: string
  description: string | null
  dynamic: string | null
  keyContext: string | null
  communicationStyle: string | null
  loveLanguage: string | null
  linkedPersonaId: string | null
  linkedUserId: string | null
  isActive: boolean
  lastInteractionAt: string | null
  interactionCount: number
  createdAt: string
  updatedAt: string
  _count?: { notes: number }
  notes?: RelationshipNote[]
}

export interface RelationshipNote {
  id: string
  personId: string
  content: string
  source: string
  sentiment: string | null
  topic: string | null
  createdAt: string
}

export interface CreateRelationshipData {
  name: string
  relationship: string
  description?: string
  dynamic?: string
  keyContext?: string
  communicationStyle?: string
  loveLanguage?: string
  linkedUserId?: string
}

export interface RelationshipHealthData {
  totalPeople: number
  healthyCount: number
  driftingCount: number
  overallScore: number
  driftingPeople: {
    id: string
    name: string
    relationship: string
    lastInteractionAt: string | null
    interactionCount: number
    daysSinceInteraction: number | null
  }[]
  peopleWithScores: {
    id: string
    name: string
    relationship: string
    healthScore: number
  }[]
  recentActivity: {
    id: string
    personName: string
    personRelationship: string
    content: string
    sentiment: string | null
    topic: string | null
    source: string
    createdAt: string
  }[]
}

export interface AnnualReviewData {
  period: { from: string; to: string }
  totalPeople: number
  totalInteractions: number
  mostActive: {
    id: string
    name: string
    relationship: string
    noteCount: number
    sentimentBreakdown: { positive: number; neutral: number; negative: number }
  }[]
  newPeople: { id: string; name: string; relationship: string; addedAt: string }[]
  neglected: { id: string; name: string; relationship: string }[]
  tensionStats: { total: number; resolved: number }
  ritualCount: number
  eventsThisYear: number
  monthlyTrend: { month: string; count: number }[]
}

export const relationshipsApi = {
  getAnnualReview: async (): Promise<AnnualReviewData> => {
    const res = await apiClient.get('/relationships/annual-review')
    return res.data
  },

  getHealth: async (): Promise<RelationshipHealthData> => {
    const res = await apiClient.get('/relationships/health')
    return res.data
  },

  getAll: async (): Promise<RelationshipPerson[]> => {
    const res = await apiClient.get('/relationships')
    return res.data
  },

  getOne: async (id: string): Promise<RelationshipPerson> => {
    const res = await apiClient.get(`/relationships/${id}`)
    return res.data
  },

  create: async (data: CreateRelationshipData): Promise<RelationshipPerson> => {
    const res = await apiClient.post('/relationships', data)
    return res.data
  },

  update: async (id: string, data: Partial<CreateRelationshipData>): Promise<RelationshipPerson> => {
    const res = await apiClient.put(`/relationships/${id}`, data)
    return res.data
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/relationships/${id}`)
  },

  addNote: async (id: string, content: string): Promise<RelationshipNote> => {
    const res = await apiClient.post(`/relationships/${id}/notes`, { content })
    return res.data
  },

  createPersona: async (id: string): Promise<{ persona: any; alreadyExists: boolean }> => {
    const res = await apiClient.post(`/relationships/${id}/create-persona`)
    return res.data
  },

  /**
   * Link a Circle person to a registered 4Ever User (authoritative link).
   * Pass null to clear an existing link.
   */
  linkUser: async (id: string, linkedUserId: string | null): Promise<RelationshipPerson> => {
    const res = await apiClient.post(`/relationships/${id}/link-user`, { linkedUserId })
    return res.data
  },
}
