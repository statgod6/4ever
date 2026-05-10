import apiClient from './client'

export type SupportCategory = 'abuse' | 'bug' | 'feature' | 'privacy' | 'other'

export interface SupportReportPayload {
  category: SupportCategory
  message: string
  targetUserId?: string
}

export const supportApi = {
  /**
   * Send a support / abuse report. Rate-limited server-side to 3/hour/user.
   * For personal replies the user should also email support@4ever.app — the
   * backend doesn't fan out to email itself yet.
   */
  report: async (payload: SupportReportPayload): Promise<{ ok: true; message: string }> => {
    const response = await apiClient.post('/support/report', payload)
    return response.data
  },
}
