import apiClient from './client'

export interface OntologyIdentity {
  displayName: string | null
  role: string | null
  situation: string | null
}

export interface OntologyTopPerson {
  personId: string
  name: string
  bondStrength: number
  bondTrend: 'strengthening' | 'stable' | 'drifting'
  driftRiskDays: number
  suggestedRitual: string | null
}

export interface OntologyDriftingPerson {
  personId: string
  name: string
  relationship: string
}

export interface OntologyTension {
  title: string
  intensity: number
  personName?: string | null
}

export interface OntologyGoal {
  title: string
  horizon: string | null
}

export interface OntologySnapshot {
  trajectory: string
  weather: string
  moodTrend: string
  energyTrend: string
  dominantTheme: string | null
  recommendedFocus: string
  topTensions: OntologyTension[]
  driftingPeople: OntologyDriftingPerson[]
  topPeople: OntologyTopPerson[]
  identity: OntologyIdentity | null
  activeGoals: OntologyGoal[]
  staleness: { self: boolean; emotional: boolean; relational: boolean }
  lastSynthesizedAt: { self: string | null; emotional: string | null }
}

export interface RelationalSnapshot {
  personId: string
  name: string
  relationship: string
  bondStrength: number
  bondTrend: 'strengthening' | 'stable' | 'drifting'
  driftRiskDays: number
  loveLanguage?: string | null
  recurringTopics: string[]
  unresolvedFriction: string[]
  predictedNextInteraction: string
  suggestedRitual?: string | null
  lastInteractionAt?: string | null
}

export const ontologyApi = {
  getSnapshot: (): Promise<OntologySnapshot> =>
    apiClient.get('/ontology/snapshot').then((r) => r.data),
  compose: () => apiClient.get('/ontology/compose').then((r) => r.data),
  refresh: () => apiClient.get('/ontology/refresh').then((r) => r.data),
  getSelf: () => apiClient.get('/ontology/self').then((r) => r.data),
  getEmotional: () => apiClient.get('/ontology/emotional').then((r) => r.data),
  getRelational: (personId: string): Promise<RelationalSnapshot | null> =>
    apiClient.get(`/ontology/relational/${personId}`).then((r) => r.data),
}
