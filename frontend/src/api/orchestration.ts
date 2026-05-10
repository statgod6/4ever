import apiClient from './client'
import { useAuthStore } from '../store/authStore'

export interface StreamEvent {
  event: 'thinking' | 'thinking_delta' | 'tool_start' | 'tool_end' | 'token' | 'response' | 'done'
  data: any
}

export const orchestrationApi = {
  analyzeThought: async (thoughtId: string, personaIds: string[]) => {
    const response = await apiClient.post('/orchestration/analyze', {
      thoughtId,
      personaIds,
    })
    return response.data
  },

  replyToPersona: async (thoughtId: string, personaId: string, message: string) => {
    const response = await apiClient.post('/orchestration/reply-persona', {
      thoughtId,
      personaId,
      message,
    })
    return response.data as {
      personaId: string
      personaName: string
      response: string
      modelUsed: string
    }
  },

  replyToPersonaStream: async (
    thoughtId: string,
    personaId: string,
    message: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> => {
    const token = useAuthStore.getState().token
    const response = await fetch('/api/orchestration/reply-persona/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ thoughtId, personaId, message }),
    })

    if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent({ event: currentEvent as StreamEvent['event'], data })
          } catch (e) {
            console.warn('SSE parse error (replyToPersonaStream):', e)
          }
          currentEvent = ''
        }
      }
    }
  },

  quickChat: async (message: string, personaId?: string) => {
    const response = await apiClient.post('/orchestration/quick-chat', {
      message,
      personaId,
    })
    return response.data as { response: string }
  },

  coreChat: async (message: string) => {
    const response = await apiClient.post('/orchestration/core-chat', {
      message,
    })
    return response.data as { response: string }
  },

  /**
   * Stream Core Chat with SSE for real-time tool activity indicators.
   * Calls onEvent for each SSE event (thinking, tool_start, tool_end, response, done).
   */
  coreChatStream: async (
    message: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> => {
    const token = useAuthStore.getState().token
    const response = await fetch('/api/orchestration/core-chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
    })

    if (!response.ok) {
      throw new Error(`Stream failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE events from buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent({ event: currentEvent as StreamEvent['event'], data })
          } catch (e) {
            console.warn('SSE parse error (coreChatStream):', e)
          }
          currentEvent = ''
        }
      }
    }
  },

  getCoreChatHistory: async (limit = 30, cursor?: string) => {
    const params: any = { limit }
    if (cursor) params.cursor = cursor
    const response = await apiClient.get('/orchestration/core-chat/history', { params })
    const data = response.data
    // Support both old (array) and new (paginated) response formats
    if (Array.isArray(data)) {
      return { messages: data as Array<{ id: string; role: string; content: string; createdAt: string }>, hasMore: false, nextCursor: null, sessionStartedAt: null }
    }
    return data as {
      messages: Array<{ id: string; role: string; content: string; createdAt: string }>
      hasMore: boolean
      nextCursor: string | null
      sessionStartedAt: string | null
    }
  },

  clearCoreChatHistory: async () => {
    const response = await apiClient.delete('/orchestration/core-chat/history')
    return response.data
  },

  newCoreChatSession: async () => {
    const response = await apiClient.post('/orchestration/core-chat/new-session')
    return response.data as { success: boolean; sessionStartedAt: string }
  },

  // =================== PERSONA DIRECT CHAT ===================

  personaDirectChatStream: async (
    personaId: string,
    message: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> => {
    const token = useAuthStore.getState().token
    const response = await fetch('/api/orchestration/persona-chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ personaId, message }),
    })

    if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent({ event: currentEvent as StreamEvent['event'], data })
          } catch (e) {
            console.warn('SSE parse error (personaDirectChatStream):', e)
          }
          currentEvent = ''
        }
      }
    }
  },

  getPersonaChatHistory: async (personaId: string) => {
    const response = await apiClient.get(`/orchestration/persona-chat/${personaId}/history`)
    return response.data as Array<{ id: string; role: string; content: string; createdAt: string }>
  },

  clearPersonaChatHistory: async (personaId: string) => {
    const response = await apiClient.delete(`/orchestration/persona-chat/${personaId}/history`)
    return response.data
  },
}
