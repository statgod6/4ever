import apiClient from './client'

export interface UserContext {
  id?: string
  name?: string
  age?: string
  location?: string
  role?: string
  background?: string
  currentProjects?: string
  goals?: string
  situation?: string
  values?: string
  pendingDecisions?: string
  freeformContext?: string
}

export const userContextApi = {
  get: async (): Promise<UserContext> => {
    const { data } = await apiClient.get('/users/context')
    return data
  },

  update: async (context: UserContext): Promise<UserContext> => {
    const { data } = await apiClient.put('/users/context', context)
    return data
  },

  setRelationshipHealthOptIn: async (enabled: boolean): Promise<{ userId: string; relationshipHealthOptIn: boolean }> => {
    const { data } = await apiClient.patch('/users/me/relationship-health-opt-in', { enabled })
    return data
  },
}
