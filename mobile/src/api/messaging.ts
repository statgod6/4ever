import apiClient from './client'

export interface ConnectionUser {
  id: string
  name: string
  phoneNumber: string
  avatarUrl?: string | null
  lastSeenAt?: string | null
}

export interface ConnectionItem {
  id: string
  user: ConnectionUser
  connectedAt: string
}

export interface SearchResult extends ConnectionUser {
  connectionStatus: string | null
  connectionId: string | null
}

export interface PendingRequest {
  id: string
  requesterId: string
  status: string
  createdAt: string
  requester: ConnectionUser
}

export interface MessageReaction {
  id: string
  emoji: string
  userId: string
  user: { id: string; name: string }
}

export interface ReplyTo {
  id: string
  content: string
  senderId: string
  sender: { id: string; name: string }
}

export interface MediatorActionCard {
  type: 'suggest_ritual' | 'suggest_task' | 'log_tension' | 'mark_agreement'
  payload: any
  acceptedByUserIds: string[]
  createdAt: string
}

export interface DirectMessage {
  id: string
  senderId: string
  receiverId: string
  content: string
  isRead: boolean
  status: 'sent' | 'delivered' | 'read'
  messageType: string
  metadata?: string | null
  replyToId?: string | null
  replyTo?: ReplyTo | null
  editedAt?: string | null
  deletedAt?: string | null
  mediatorSessionId?: string | null
  mediatorActions?: string | null
  createdAt: string
  sender: { id: string; name: string }
  reactions?: MessageReaction[]
}

export interface ConversationPreview {
  connectionId: string
  user: ConnectionUser
  lastMessage: {
    content: string
    createdAt: string
    senderId: string
    status?: string
    deletedAt?: string | null
    messageType?: string
  } | null
  unreadCount: number
  pinned: boolean
  muted: string | null
  archived: boolean
}

export interface SharedNote {
  id: string
  connectionId: string
  authorId: string
  content: string
  noteType: string
  createdAt: string
  author: { id: string; name: string }
}

export interface SharedRelationship {
  connectionId: string
  connectedSince: string
  partner: ConnectionUser
  sharedNotes: SharedNote[]
  totalNotes: number
  totalMessages: number
  notesByType: Record<string, number>
}

export const connectionsApi = {
  search: (q: string) =>
    apiClient.get<SearchResult[]>('/connections/search', { params: { q } }).then(r => r.data),

  getAll: () =>
    apiClient.get<ConnectionItem[]>('/connections').then(r => r.data),

  getPending: () =>
    apiClient.get<PendingRequest[]>('/connections/pending').then(r => r.data),

  sendRequest: (receiverId: string) =>
    apiClient.post('/connections/request', { receiverId }).then(r => r.data),

  sendInvite: (phoneNumber: string) =>
    apiClient.post('/connections/invite', { phoneNumber }).then(r => r.data),

  resolvePhone: (phoneNumber: string) =>
    apiClient.post<{
      user: ConnectionUser | null
      connectionStatus: string | null
      connectionId: string | null
      iAmRequester?: boolean | null
    }>('/connections/resolve-phone', { phoneNumber }).then(r => r.data),

  accept: (id: string) =>
    apiClient.post(`/connections/${id}/accept`).then(r => r.data),

  reject: (id: string) =>
    apiClient.post(`/connections/${id}/reject`).then(r => r.data),

  remove: (id: string) =>
    apiClient.delete(`/connections/${id}`).then(r => r.data),

  getNotes: (connectionId: string, type?: string) =>
    apiClient.get<SharedNote[]>(`/connections/${connectionId}/notes`, { params: type ? { type } : {} }).then(r => r.data),

  addNote: (connectionId: string, content: string, noteType?: string) =>
    apiClient.post<SharedNote>(`/connections/${connectionId}/notes`, { content, noteType }).then(r => r.data),

  deleteNote: (noteId: string) =>
    apiClient.delete(`/connections/notes/${noteId}`).then(r => r.data),

  getSharedRelationship: (connectionId: string) =>
    apiClient.get<SharedRelationship>(`/connections/${connectionId}/shared`).then(r => r.data),
}

export const messagesApi = {
  getConversations: () =>
    apiClient.get<ConversationPreview[]>('/messages/conversations').then(r => r.data),

  getConversation: (userId: string, cursor?: string) =>
    apiClient.get<{ messages: DirectMessage[]; hasMore: boolean; nextCursor: string | null }>(
      `/messages/${userId}`, { params: cursor ? { cursor } : {} }
    ).then(r => r.data),

  markAsRead: (userId: string) =>
    apiClient.post(`/messages/${userId}/read`).then(r => r.data),

  getUnreadCount: () =>
    apiClient.get<{ unread: number }>('/messages/unread').then(r => r.data),

  editMessage: (messageId: string, content: string) =>
    apiClient.put(`/messages/${messageId}/edit`, { content }).then(r => r.data),

  deleteMessage: (messageId: string) =>
    apiClient.delete(`/messages/${messageId}`).then(r => r.data),

  addReaction: (messageId: string, emoji: string) =>
    apiClient.post(`/messages/${messageId}/reactions`, { emoji }).then(r => r.data),

  searchMessages: (userId: string, query: string) =>
    apiClient.get<DirectMessage[]>(`/messages/${userId}/search`, { params: { q: query } }).then(r => r.data),

  updateConversationSettings: (connectionId: string, settings: { pinned?: boolean; mutedUntil?: string | null; archived?: boolean }) =>
    apiClient.put(`/messages/conversation/${connectionId}/settings`, settings).then(r => r.data),

  getLastSeen: (userId: string) =>
    apiClient.get<{ lastSeenAt: string | null }>(`/messages/user/${userId}/last-seen`).then(r => r.data),

  // --- Tri-Chat Mediator ---
  getTriChatStatus: (connectionId: string) =>
    apiClient.get<TriChatStatus>(`/messages/conversation/${connectionId}/tri-chat/status`).then(r => r.data),

  toggleTriChat: (connectionId: string, enabled: boolean) =>
    apiClient.post<TriChatToggleResult>(`/messages/conversation/${connectionId}/tri-chat/toggle`, { enabled }).then(r => r.data),

  summonMediator: (connectionId: string, body?: { sessionId?: string; replyText?: string }) =>
    apiClient.post<DirectMessage>(`/messages/conversation/${connectionId}/summon-mediator`, body || {}).then(r => r.data),

  // --- v2 Mediator ---
  replyToMediator: (connectionId: string, sessionId: string, text: string) =>
    apiClient.post(`/messages/conversation/${connectionId}/mediator-session/${sessionId}/reply`, { text }).then(r => r.data),

  endMediatorSession: (connectionId: string, sessionId: string) =>
    apiClient.post(`/messages/conversation/${connectionId}/mediator-session/${sessionId}/end`).then(r => r.data),

  proposeMediatorStyle: (_connectionId: string, _style: never) =>
    Promise.reject(new Error('Mediator styles were removed — personality is now prompt-driven. Use clearChatHistory to start fresh.')),

  acceptMediatorStyle: (_connectionId: string) =>
    Promise.reject(new Error('Mediator styles were removed — personality is now prompt-driven. Use clearChatHistory to start fresh.')),

  clearChatHistory: (connectionId: string) =>
    apiClient.post<{ connectionId: string; clearedAt: string; summarized: boolean }>(
      `/messages/conversation/${connectionId}/clear-history`,
    ).then(r => r.data),

  renameMediator: (connectionId: string, name: string) =>
    apiClient.put<{ connectionId: string; mediatorName: string }>(
      `/messages/conversation/${connectionId}/mediator-name`,
      { name },
    ).then(r => r.data),

  acceptMediatorAction: (messageId: string, actionIndex: number) =>
    apiClient.post(`/messages/${messageId}/mediator-action/${actionIndex}/accept`).then(r => r.data),
}

export interface TriChatStatus {
  selfEnabled: boolean
  otherEnabled: boolean
  bothEnabled: boolean
  premium: boolean
  turnsLeft: number | null
  activeSessionId?: string | null
  hasClearedHistory?: boolean
  mediatorName?: string
}

export interface TriChatToggleResult {
  connectionId: string
  userId: string
  enabled: boolean
  bothEnabled: boolean
  otherUserId: string
}
