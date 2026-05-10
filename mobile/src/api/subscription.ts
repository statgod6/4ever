import apiClient from './client'

export interface Subscription {
  tier: 'free' | 'premium' | string
  expiresAt: string | null
  active: boolean
}

export const subscriptionApi = {
  get: async (): Promise<Subscription> => {
    const response = await apiClient.get('/users/me/subscription')
    return response.data
  },
}
