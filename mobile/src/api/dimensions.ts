import apiClient from './client'
import type { LifeDimension } from '../constants/dimensions'

export type DimensionTrend = 'up' | 'down' | 'flat'

export interface DimensionSummary {
  dimension: LifeDimension
  label: string
  description: string
  selfScore: number | null
  observedScore: number
  trend: DimensionTrend
  signalsThisWeek: number
  lastSelfRatedAt: string | null
}

export interface LifeWheelPayload {
  dimensions: DimensionSummary[]
  weekStart: string
  needsWeeklyCheckin: boolean
  daysSinceCheckin: number | null
}

export interface DimensionSignal {
  id: string
  valence: number
  source: string
  summary: string | null
  createdAt: string
}

export interface DimensionDetail {
  dimension: LifeDimension
  label: string
  description: string
  observedScore: number
  latestSelfScore: number | null
  latestSelfRatedAt: string | null
  recentSignals: DimensionSignal[]
}

export interface DimensionHistoryPoint {
  weekStart: string
  observed: number
  self: number | null
}

export interface DimensionHistory {
  dimension: LifeDimension
  label: string
  weeks: DimensionHistoryPoint[]
}

export const dimensionsApi = {
  getLifeWheel: async (): Promise<LifeWheelPayload> => {
    const res = await apiClient.get('/dimensions')
    return res.data
  },
  selfRate: async (
    dimension: LifeDimension,
    score: number,
    note?: string,
  ): Promise<void> => {
    await apiClient.post('/dimensions/self-rate', { dimension, score, note })
  },
  weeklyCheckin: async (
    ratings: Partial<Record<LifeDimension, number>>,
    note?: string,
  ): Promise<{ weekStart: string; ratings: Array<{ dimension: string; score: number }> }> => {
    const res = await apiClient.post('/dimensions/weekly-checkin', { ratings, note })
    return res.data
  },
  getHistory: async (dimension: LifeDimension): Promise<DimensionHistory> => {
    const res = await apiClient.get(`/dimensions/${dimension}/history`)
    return res.data
  },
  getDetail: async (dimension: LifeDimension): Promise<DimensionDetail> => {
    const res = await apiClient.get(`/dimensions/${dimension}/detail`)
    return res.data
  },
}
