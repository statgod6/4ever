import { create } from 'zustand'
import { connectionsApi, messagesApi } from '../api/messaging'
import type { ConnectionItem, PendingRequest, ConversationPreview, DirectMessage, TriChatStatus } from '../api/messaging'
import { useAuthStore } from './authStore'

interface MessagingState {
  connections: ConnectionItem[]
  pendingRequests: PendingRequest[]
  connectionsLoading: boolean
  conversations: ConversationPreview[]
  conversationsLoading: boolean
  activeChat: { userId: string; name: string; connectionId?: string } | null
  chatMessages: DirectMessage[]
  chatLoading: boolean
  chatHasMore: boolean
  chatNextCursor: string | null
  totalUnread: number
  replyingTo: DirectMessage | null
  editingMessage: DirectMessage | null

  // Tri-Chat Mediator
  triChat: TriChatStatus | null
  triChatLoading: boolean
  mediatorStreamingId: string | null

  loadConnections: () => Promise<void>
  loadPendingRequests: () => Promise<void>
  loadConversations: () => Promise<void>
  loadUnreadCount: () => Promise<void>
  openChat: (userId: string, name: string, connectionId?: string) => Promise<void>
  loadMoreMessages: () => Promise<void>
  addIncomingMessage: (msg: DirectMessage) => void
  addSentMessage: (msg: DirectMessage) => void
  replaceTempWithReal: (msg: DirectMessage) => void
  markChatRead: (userId: string) => void
  closeChat: () => void
  setReplyingTo: (msg: DirectMessage | null) => void
  setEditingMessage: (msg: DirectMessage | null) => void
  updateMessage: (msg: DirectMessage) => void
  removeMessage: (messageId: string, deletedAt: string) => void
  updateMessageStatus: (messageId: string, status: 'sent' | 'delivered' | 'read') => void
  updateReaction: (messageId: string, emoji: string, userId: string, action: 'added' | 'removed') => void

  // Tri-Chat actions
  loadTriChatStatus: (connectionId: string) => Promise<void>
  applyTriChatToggle: (payload: { connectionId: string; byUserId: string; enabled: boolean; bothEnabled: boolean }, selfUserId: string) => void
  startMediatorStream: (messageId: string, sessionId?: string) => void
  appendMediatorChunk: (messageId: string, delta: string) => void
    cancelMediatorStream: (messageId: string) => void
  finishMediatorStream: (messageId: string, patch?: { actions?: string | null; sessionId?: string }) => void
  mediatorStreamError: (messageId: string | undefined) => void
  applyChatHistoryCleared: (connectionId: string) => void
  applyMediatorRenamed: (connectionId: string, mediatorName: string) => void
  applyMediatorSessionEnded: (sessionId: string) => void
  applyMediatorActionAccepted: (messageId: string, actionIndex: number, userId: string) => void
  resetTriChat: () => void
}

export const useMessagingStore = create<MessagingState>((set, get) => ({
  connections: [],
  pendingRequests: [],
  connectionsLoading: false,
  conversations: [],
  conversationsLoading: false,
  activeChat: null,
  chatMessages: [],
  chatLoading: false,
  chatHasMore: false,
  chatNextCursor: null,
  totalUnread: 0,
  replyingTo: null,
  editingMessage: null,
  triChat: null,
  triChatLoading: false,
  mediatorStreamingId: null,

  loadConnections: async () => {
    set({ connectionsLoading: true })
    try {
      const connections = await connectionsApi.getAll()
      set({ connections })
    } catch {} finally { set({ connectionsLoading: false }) }
  },

  loadPendingRequests: async () => {
    try {
      const pendingRequests = await connectionsApi.getPending()
      set({ pendingRequests })
    } catch {}
  },

  loadConversations: async () => {
    set({ conversationsLoading: true })
    try {
      const conversations = await messagesApi.getConversations()
      set({ conversations })
    } catch {} finally { set({ conversationsLoading: false }) }
  },

  loadUnreadCount: async () => {
    try {
      const { unread } = await messagesApi.getUnreadCount()
      set({ totalUnread: unread })
    } catch {}
  },

  openChat: async (userId: string, name: string, connectionId?: string) => {
    set({ activeChat: { userId, name, connectionId }, chatMessages: [], chatLoading: true, chatHasMore: false, chatNextCursor: null, replyingTo: null, editingMessage: null, triChat: null, mediatorStreamingId: null })
    try {
      const data = await messagesApi.getConversation(userId)
      set({ chatMessages: data.messages, chatHasMore: data.hasMore, chatNextCursor: data.nextCursor })
      await messagesApi.markAsRead(userId)
      // Refresh tab badge so totalUnread stays in sync with server truth
      get().loadUnreadCount()
      get().markChatRead(userId)
      if (connectionId) {
        get().loadTriChatStatus(connectionId)
      }
    } catch {} finally { set({ chatLoading: false }) }
  },

  loadMoreMessages: async () => {
    const { activeChat, chatNextCursor } = get()
    if (!activeChat || !chatNextCursor) return
    try {
      const data = await messagesApi.getConversation(activeChat.userId, chatNextCursor)
      set((s) => ({
        chatMessages: [...data.messages, ...s.chatMessages],
        chatHasMore: data.hasMore,
        chatNextCursor: data.nextCursor,
      }))
    } catch {}
  },

  addIncomingMessage: (msg: DirectMessage) => {
    const { activeChat } = get()
    const selfId = useAuthStore.getState().user?.id
    // Same upsert rule as web: include self-authored mediator placeholders
    // that land in the currently-open chat, so the summoner sees the bubble.
    const belongsToActiveChat = !!(
      activeChat &&
      (msg.senderId === activeChat.userId ||
        (msg.receiverId === activeChat.userId && msg.senderId === selfId))
    )
    if (belongsToActiveChat) {
      const exists = get().chatMessages.some((m) => m.id === msg.id)
      if (!exists) {
        set((s) => ({ chatMessages: [...s.chatMessages, msg] }))
      }
      if (msg.senderId !== selfId && activeChat) {
        messagesApi.markAsRead(activeChat.userId)
          .then(() => get().loadUnreadCount())
          .catch(() => {})
      }
    } else if (msg.senderId !== selfId) {
      set((s) => ({ totalUnread: s.totalUnread + 1 }))
    }
  },

  addSentMessage: (msg: DirectMessage) => {
    set((s) => ({ chatMessages: [...s.chatMessages, msg] }))
  },

  replaceTempWithReal: (realMsg: DirectMessage) => {
    set((s) => {
      // 1. Preferred: match by clientTempId echoed back by the server
      const tempId = (realMsg as any).clientTempId as string | undefined
      if (tempId) {
        const i = s.chatMessages.findIndex((m) => m.id === tempId)
        if (i >= 0) {
          const updated = [...s.chatMessages]
          updated[i] = realMsg
          return { chatMessages: updated }
        }
      }
      // 2. Fallback: legacy content+receiver match (handles older clients)
      const idx = s.chatMessages.findIndex(
        (m) => m.id.startsWith('temp-') && m.content === realMsg.content && m.receiverId === realMsg.receiverId
      )
      if (idx >= 0) {
        const updated = [...s.chatMessages]
        updated[idx] = realMsg
        return { chatMessages: updated }
      }
      const exists = s.chatMessages.some((m) => m.id === realMsg.id)
      if (!exists) return { chatMessages: [...s.chatMessages, realMsg] }
      return {}
    })
  },

  markChatRead: (userId: string) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.user.id === userId ? { ...c, unreadCount: 0 } : c
      ),
    }))
  },

  closeChat: () => {
    set({ activeChat: null, chatMessages: [], chatHasMore: false, chatNextCursor: null, replyingTo: null, editingMessage: null, triChat: null, mediatorStreamingId: null })
  },

  setReplyingTo: (msg: DirectMessage | null) => {
    set({ replyingTo: msg, editingMessage: null })
  },

  setEditingMessage: (msg: DirectMessage | null) => {
    set({ editingMessage: msg, replyingTo: null })
  },

  updateMessage: (msg: DirectMessage) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => m.id === msg.id ? msg : m),
    }))
  },

  removeMessage: (messageId: string, deletedAt: string) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, content: '', deletedAt } : m
      ),
    }))
  },

  updateMessageStatus: (messageId: string, status: 'sent' | 'delivered' | 'read') => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, status } : m
      ),
    }))
  },

  updateReaction: (messageId: string, emoji: string, userId: string, action: 'added' | 'removed') => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => {
        if (m.id !== messageId) return m
        const reactions = [...(m.reactions || [])]
        if (action === 'removed') {
          return { ...m, reactions: reactions.filter((r) => !(r.emoji === emoji && r.userId === userId)) }
        }
        const exists = reactions.some((r) => r.emoji === emoji && r.userId === userId)
        if (!exists) {
          reactions.push({ id: `temp-${Date.now()}`, emoji, userId, user: { id: userId, name: '' } })
        }
        return { ...m, reactions }
      }),
    }))
  },

  // --- Tri-Chat actions ---

  loadTriChatStatus: async (connectionId: string) => {
    set({ triChatLoading: true })
    try {
      const status = await messagesApi.getTriChatStatus(connectionId)
      set({ triChat: status })
    } catch {
      set({ triChat: null })
    } finally {
      set({ triChatLoading: false })
    }
  },

  applyTriChatToggle: (payload, selfUserId: string) => {
    set((s) => {
      if (!s.triChat) return {}
      const isSelf = payload.byUserId === selfUserId
      return {
        triChat: {
          ...s.triChat,
          selfEnabled: isSelf ? payload.enabled : s.triChat.selfEnabled,
          otherEnabled: isSelf ? s.triChat.otherEnabled : payload.enabled,
          bothEnabled: payload.bothEnabled,
        },
      }
    })
  },

  startMediatorStream: (messageId: string, sessionId?: string) => {
    set((s) => ({
      mediatorStreamingId: messageId,
      triChat: s.triChat && sessionId ? { ...s.triChat, activeSessionId: sessionId } : s.triChat,
    }))
  },

  appendMediatorChunk: (messageId: string, delta: string) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, content: (m.content || '') + delta } : m
      ),
    }))
  },

  cancelMediatorStream: (messageId: string) => {
    set((s) => ({
      mediatorStreamingId: s.mediatorStreamingId === messageId ? null : s.mediatorStreamingId,
      chatMessages: s.chatMessages.filter((m) => m.id !== messageId),
    }))
  },

  finishMediatorStream: (messageId: string, patch?: { actions?: string | null; sessionId?: string }) => {
    set((s) => ({
      mediatorStreamingId: s.mediatorStreamingId === messageId ? null : s.mediatorStreamingId,
      chatMessages: patch?.actions !== undefined
        ? s.chatMessages.map((m) =>
            m.id === messageId
              ? { ...m, mediatorActions: patch.actions || null, mediatorSessionId: patch.sessionId || m.mediatorSessionId }
              : m,
          )
        : s.chatMessages,
      triChat: s.triChat && s.triChat.turnsLeft !== null
        ? { ...s.triChat, turnsLeft: Math.max(0, s.triChat.turnsLeft - 1) }
        : s.triChat,
    }))
  },

  mediatorStreamError: (messageId) => {
    set((s) => ({
      mediatorStreamingId: messageId && s.mediatorStreamingId === messageId ? null : s.mediatorStreamingId,
    }))
  },

  applyChatHistoryCleared: (connectionId: string) => {
    set((s) => ({
      chatMessages:
        s.activeChat?.connectionId === connectionId ? [] : s.chatMessages,
      triChat: s.triChat
        ? { ...s.triChat, hasClearedHistory: true, activeSessionId: null }
        : s.triChat,
      mediatorStreamingId: null,
    }))
  },

  applyMediatorRenamed: (connectionId: string, mediatorName: string) => {
    set((s) => ({
      triChat:
        s.triChat && s.activeChat?.connectionId === connectionId
          ? { ...s.triChat, mediatorName }
          : s.triChat,
    }))
  },

  applyMediatorSessionEnded: (sessionId) => {
    set((s) => s.triChat && s.triChat.activeSessionId === sessionId
      ? { triChat: { ...s.triChat, activeSessionId: null } }
      : {})
  },

  applyMediatorActionAccepted: (messageId, actionIndex, userId) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => {
        if (m.id !== messageId || !m.mediatorActions) return m
        try {
          const cards = JSON.parse(m.mediatorActions)
          if (Array.isArray(cards) && cards[actionIndex]) {
            const card = cards[actionIndex]
            const ids: string[] = Array.isArray(card.acceptedByUserIds) ? card.acceptedByUserIds : []
            if (!ids.includes(userId)) {
              cards[actionIndex] = { ...card, acceptedByUserIds: [...ids, userId] }
            }
            return { ...m, mediatorActions: JSON.stringify(cards) }
          }
        } catch { /* */ }
        return m
      }),
    }))
  },

  resetTriChat: () => {
    set({ triChat: null, mediatorStreamingId: null })
  },
}))
