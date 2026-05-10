import apiClient from './client'
import { API_URL } from '../constants/config'
import { setCachedToken } from './client'

export interface StreamEvent {
  event: 'thinking' | 'thinking_delta' | 'tool_start' | 'tool_end' | 'token' | 'token_reset' | 'response' | 'done'
  data: any
}

// SSE streaming using XMLHttpRequest (React Native compatible)
// RN's fetch doesn't support ReadableStream/getReader(), so we use XHR
// which fires onprogress as chunks arrive
function streamSSE(
  url: string,
  body: Record<string, any>,
  token: string | null,
  onEvent: (event: StreamEvent) => void,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/json')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    let lastIndex = 0
    let buffer = ''

    xhr.onprogress = () => {
      const newText = xhr.responseText.substring(lastIndex)
      lastIndex = xhr.responseText.length
      buffer += newText

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
            console.warn(`SSE parse error (${label}):`, e)
          }
          currentEvent = ''
        }
      }
    }

    xhr.onloadend = () => {
      // Process any remaining buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n')
        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))
              onEvent({ event: currentEvent as StreamEvent['event'], data })
            } catch (e) { /* ignore */ }
            currentEvent = ''
          }
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Stream failed: ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error(`Network error during ${label}`))
    xhr.ontimeout = () => reject(new Error(`Timeout during ${label}`))
    xhr.timeout = 120000 // 2 min timeout for long agent operations

    xhr.send(JSON.stringify(body))
  })
}

// Get auth headers for fetch requests (not axios)
function getAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
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
    token: string | null,
  ): Promise<void> => {
    await streamSSE(
      `${API_URL}/orchestration/reply-persona/stream`,
      { thoughtId, personaId, message },
      token,
      onEvent,
      'replyToPersonaStream',
    )
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

  coreChatStream: async (
    message: string,
    onEvent: (event: StreamEvent) => void,
    token: string | null,
  ): Promise<void> => {
    await streamSSE(
      `${API_URL}/orchestration/core-chat/stream`,
      { message },
      token,
      onEvent,
      'coreChatStream',
    )
  },

  getCoreChatHistory: async (limit = 30, cursor?: string) => {
    const params: any = { limit }
    if (cursor) params.cursor = cursor
    const response = await apiClient.get('/orchestration/core-chat/history', { params })
    const data = response.data
    if (Array.isArray(data)) {
      return {
        messages: data as Array<{ id: string; role: string; content: string; createdAt: string }>,
        hasMore: false,
        nextCursor: null as string | null,
        sessionStartedAt: null as string | null,
      }
    }
    return {
      messages: (data.messages || []) as Array<{ id: string; role: string; content: string; createdAt: string }>,
      hasMore: data.hasMore || false,
      nextCursor: data.nextCursor || null,
      sessionStartedAt: data.sessionStartedAt || null,
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

  personaDirectChatStream: async (
    personaId: string,
    message: string,
    onEvent: (event: StreamEvent) => void,
    token: string | null,
  ): Promise<void> => {
    await streamSSE(
      `${API_URL}/orchestration/persona-chat/stream`,
      { personaId, message },
      token,
      onEvent,
      'personaDirectChatStream',
    )
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
