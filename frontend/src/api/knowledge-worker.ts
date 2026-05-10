import apiClient from './client'
import { useAuthStore } from '../store/authStore'

export interface KwStreamEvent {
  event:
    | 'conversation'
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'token'
    | 'token_reset'
    | 'response'
    | 'done'
  data: any
}

export interface KwConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface KwMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system' | string
  content: string
  toolName: string | null
  toolCalls: unknown
  createdAt: string
}

export interface KwDocument {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export const knowledgeWorkerApi = {
  listConversations: async (): Promise<KwConversation[]> => {
    const response = await apiClient.get('/knowledge-worker/conversations')
    return response.data
  },

  getMessages: async (conversationId: string): Promise<KwMessage[]> => {
    const response = await apiClient.get(
      `/knowledge-worker/conversations/${conversationId}/messages`,
    )
    return response.data
  },

  deleteConversation: async (conversationId: string) => {
    const response = await apiClient.delete(
      `/knowledge-worker/conversations/${conversationId}`,
    )
    return response.data
  },

  stream: async (
    message: string,
    conversationId: string | undefined,
    onEvent: (event: KwStreamEvent) => void,
  ): Promise<void> => {
    const token = useAuthStore.getState().token
    const response = await fetch('/api/knowledge-worker/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversationId }),
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
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent({ event: currentEvent as KwStreamEvent['event'], data })
          } catch (e) {
            console.warn('SSE parse error (knowledge-worker):', e)
          }
          currentEvent = ''
        }
      }
    }
  },

  // ─────── Documents ───────
  listDocuments: async (): Promise<KwDocument[]> => {
    const res = await apiClient.get('/knowledge-worker/documents')
    return res.data
  },

  deleteDocument: async (id: string): Promise<void> => {
    await apiClient.delete(`/knowledge-worker/documents/${id}`)
  },

  uploadDocument: async (
    file: File,
  ): Promise<{ id: string; filename: string; chunks: number }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post('/knowledge-worker/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return res.data
  },
}
