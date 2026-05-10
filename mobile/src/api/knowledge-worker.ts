import apiClient from './client'
import { API_URL } from '../constants/config'
import type { StreamEvent } from './orchestration'

export interface KwConversationSummary {
  id: string
  title: string | null
  updatedAt: string
  createdAt: string
}

export interface KwMessage {
  id: string
  role: string
  content: string
  toolName: string | null
  createdAt: string
}

export interface KwDocument {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

// SSE streaming using XMLHttpRequest (RN compatible — same pattern as orchestration.ts)
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
            } catch { /* ignore */ }
            currentEvent = ''
          }
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Stream failed: ${xhr.status}`))
    }

    xhr.onerror = () => reject(new Error(`Network error during ${label}`))
    xhr.ontimeout = () => reject(new Error(`Timeout during ${label}`))
    xhr.timeout = 180000 // 3 min — KW tasks can be longer

    xhr.send(JSON.stringify(body))
  })
}

export const knowledgeWorkerApi = {
  listConversations: async (): Promise<KwConversationSummary[]> => {
    const res = await apiClient.get('/knowledge-worker/conversations')
    return res.data
  },

  getMessages: async (id: string): Promise<KwMessage[]> => {
    const res = await apiClient.get(`/knowledge-worker/conversations/${id}/messages`)
    return res.data
  },

  deleteConversation: async (id: string): Promise<void> => {
    await apiClient.delete(`/knowledge-worker/conversations/${id}`)
  },

  stream: async (
    message: string,
    conversationId: string | null,
    onEvent: (event: StreamEvent) => void,
    token: string | null,
  ): Promise<void> => {
    await streamSSE(
      `${API_URL}/knowledge-worker/stream`,
      conversationId ? { message, conversationId } : { message },
      token,
      onEvent,
      'knowledgeWorkerStream',
    )
  },

  // ─────── Documents (uploads for read_document / list_documents tools) ───────
  listDocuments: async (): Promise<KwDocument[]> => {
    const res = await apiClient.get('/knowledge-worker/documents')
    return res.data
  },

  deleteDocument: async (id: string): Promise<void> => {
    await apiClient.delete(`/knowledge-worker/documents/${id}`)
  },

  uploadDocument: async (
    file: { uri: string; name: string; type: string },
  ): Promise<{ id: string; filename: string; chunks: number }> => {
    const form = new FormData()
    // RN FormData accepts { uri, name, type } — it's the standard Expo pattern.
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any)
    const res = await apiClient.post('/knowledge-worker/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return res.data
  },
}
