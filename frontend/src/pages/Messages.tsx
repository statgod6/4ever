import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MessageCircle, Send, Loader2, ArrowLeft, ChevronUp, Check, CheckCheck,
  Reply, Pencil, Trash2, X, Smile, Search, Sparkles,
} from 'lucide-react'
import { useMessagingStore } from '../store/messagingStore'
import { useAuthStore } from '../store/authStore'
import { getSocket, connectSocket } from '../api/socket'
import type { DirectMessage, MediatorActionCard } from '../api/messaging'
import { messagesApi } from '../api/messaging'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

export default function Messages() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()
  const {
    conversations, conversationsLoading, loadConversations,
    activeChat, chatMessages, chatLoading, chatHasMore,
    openChat, loadMoreMessages, addSentMessage, closeChat, loadUnreadCount,
    replyingTo, editingMessage, setReplyingTo, setEditingMessage,
    triChat, mediatorStreamingId,
  } = useMessagingStore()

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typingUser, setTypingUser] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ msg: DirectMessage; x: number; y: number } | null>(null)
  const [emojiPicker, setEmojiPicker] = useState<string | null>(null) // messageId
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState<boolean>(false)
  const [clearing, setClearing] = useState<boolean>(false)
  const [renameOpen, setRenameOpen] = useState<boolean>(false)
  const [renameValue, setRenameValue] = useState<string>('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)

  // Load conversations on mount
  useEffect(() => {
    loadConversations()
    loadUnreadCount()
    const socket = connectSocket()

    if (socket) {
      socket.on('new_message', (msg: DirectMessage) => {
        const store = useMessagingStore.getState()
        store.addIncomingMessage(msg)
        store.loadConversations()
      })
      socket.on('message_sent', (msg: DirectMessage) => {
        const store = useMessagingStore.getState()
        store.replaceTempWithReal(msg)
        store.loadConversations()
      })
      socket.on('user_typing', (data: { userId: string; isTyping: boolean }) => {
        if (data.isTyping) {
          setTypingUser(data.userId)
          clearTimeout(typingTimeout.current)
          typingTimeout.current = setTimeout(() => setTypingUser(null), 3000)
        } else {
          setTypingUser(null)
        }
      })
      socket.on('message_status', (data: { messageId: string; status: 'delivered' | 'read' }) => {
        useMessagingStore.getState().updateMessageStatus(data.messageId, data.status)
      })
      socket.on('messages_read', (data: { readBy: string }) => {
        // Mark all messages to this user as read
        const store = useMessagingStore.getState()
        const ac = store.activeChat
        if (ac && data.readBy === ac.userId) {
          store.chatMessages.forEach((m) => {
            if (m.senderId === user?.id && m.status !== 'read') {
              store.updateMessageStatus(m.id, 'read')
            }
          })
        }
      })
      socket.on('message_edited', (msg: DirectMessage) => {
        useMessagingStore.getState().updateMessage(msg)
      })
      socket.on('message_deleted', (data: { messageId: string; deletedAt: string }) => {
        useMessagingStore.getState().removeMessage(data.messageId, data.deletedAt)
        useMessagingStore.getState().loadConversations()
      })
      socket.on('reaction_updated', (data: { messageId: string; emoji: string; userId: string; action: 'added' | 'removed' }) => {
        useMessagingStore.getState().updateReaction(data.messageId, data.emoji, data.userId, data.action)
      })
      socket.on('user_online', (data: { userId: string }) => {
        setOnlineUsers((prev) => new Set([...prev, data.userId]))
      })
      socket.on('user_offline', (data: { userId: string }) => {
        setOnlineUsers((prev) => { const n = new Set(prev); n.delete(data.userId); return n })
      })

      // --- Tri-Chat Mediator events ---
      socket.on('tri_chat_toggled', (data: { connectionId: string; byUserId: string; enabled: boolean; bothEnabled: boolean }) => {
        const store = useMessagingStore.getState()
        const selfId = useAuthStore.getState().user?.id
        if (!selfId) return
        store.applyTriChatToggle(data, selfId)
      })
      socket.on('mediator_typing', (data: { connectionId: string; messageId: string; sessionId?: string }) => {
        useMessagingStore.getState().startMediatorStream(data.messageId, data.sessionId)
      })
      socket.on('mediator_chunk', (data: { messageId: string; delta: string }) => {
        useMessagingStore.getState().appendMediatorChunk(data.messageId, data.delta)
      })
      socket.on('mediator_complete', (data: { connectionId: string; messageId: string; sessionId?: string; actions?: string | null }) => {
        useMessagingStore.getState().finishMediatorStream(data.messageId, { actions: data.actions, sessionId: data.sessionId })
        useMessagingStore.getState().loadConversations()
      })
      socket.on('mediator_error', (data: { error: string; messageId?: string }) => {
        useMessagingStore.getState().mediatorStreamError(data.messageId)
      })
      socket.on('mediator_cancelled', (data: { connectionId: string; messageId: string }) => {
        if (data.messageId) useMessagingStore.getState().cancelMediatorStream(data.messageId)
      })
      socket.on('chat_history_cleared', (data: { connectionId: string }) => {
        useMessagingStore.getState().applyChatHistoryCleared(data.connectionId)
        useMessagingStore.getState().loadConversations()
      })
      socket.on('mediator_renamed', (data: { connectionId: string; mediatorName: string }) => {
        useMessagingStore.getState().applyMediatorRenamed(data.connectionId, data.mediatorName)
      })
      socket.on('mediator_session_ended', (data: { connectionId: string; sessionId: string; topic?: string; summary?: string }) => {
        useMessagingStore.getState().applyMediatorSessionEnded(data.sessionId)
      })
      socket.on('mediator_action_accepted', (data: { messageId: string; actionIndex: number; userId: string }) => {
        useMessagingStore.getState().applyMediatorActionAccepted(data.messageId, data.actionIndex, data.userId)
      })

      // Request online status for all connections
      const requestOnlineStatus = () => {
        const store = useMessagingStore.getState()
        const userIds = store.conversations.map((c) => c.user.id)
        if (userIds.length > 0) {
          socket.emit('get_online_status', { userIds })
        }
      }
      socket.on('online_status', (statuses: { userId: string; online: boolean }[]) => {
        const online = new Set<string>()
        statuses.forEach((s) => { if (s.online) online.add(s.userId) })
        setOnlineUsers(online)
      })
      // Request after conversations load
      setTimeout(requestOnlineStatus, 1000)
    }

    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current)
      const s = getSocket()
      if (s) {
        s.off('new_message'); s.off('message_sent'); s.off('user_typing')
        s.off('message_status'); s.off('messages_read'); s.off('message_edited')
        s.off('message_deleted'); s.off('reaction_updated')
        s.off('user_online'); s.off('user_offline'); s.off('online_status')
        s.off('tri_chat_toggled'); s.off('mediator_typing')
        s.off('mediator_chunk'); s.off('mediator_complete'); s.off('mediator_error')
        s.off('mediator_cancelled')
        s.off('chat_history_cleared')
        s.off('mediator_renamed')
        s.off('mediator_session_ended'); s.off('mediator_action_accepted')
      }
    }
  }, [])

  // Open chat from URL params
  useEffect(() => {
    const userId = searchParams.get('user')
    const name = searchParams.get('name')
    if (userId && name) {
      openChat(userId, name)
    }
  }, [searchParams])

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => { setContextMenu(null); setEmojiPicker(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // Focus input when editing
  useEffect(() => {
    if (editingMessage) {
      setInput(editingMessage.content)
      inputRef.current?.focus()
    }
  }, [editingMessage])

  const handleSend = () => {
    if (!input.trim() || !activeChat || sending) return
    const content = input.trim()
    setInput('')

    const socket = getSocket()
    if (!socket) return

    if (editingMessage) {
      // Edit mode
      socket.emit('edit_message', { messageId: editingMessage.id, content })
      setEditingMessage(null)
      return
    }

    setSending(true)

    const clientTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    socket.emit('send_message', {
      receiverId: activeChat.userId,
      content,
      replyToId: replyingTo?.id || undefined,
      clientTempId,
    })

    // Optimistic: add message locally with matching id so replaceTempWithReal
    // can swap it deterministically when the server echoes back.
    const tempMsg: DirectMessage = {
      id: clientTempId,
      senderId: user?.id || '',
      receiverId: activeChat.userId,
      content,
      isRead: false,
      status: 'sent',
      messageType: 'text',
      replyToId: replyingTo?.id || null,
      replyTo: replyingTo ? { id: replyingTo.id, content: replyingTo.content, senderId: replyingTo.senderId, sender: replyingTo.sender } : null,
      createdAt: new Date().toISOString(),
      sender: { id: user?.id || '', name: user?.name || '' },
      reactions: [],
    }
    addSentMessage(tempMsg)
    setReplyingTo(null)

    // Stop typing
    socket.emit('typing', { receiverId: activeChat.userId, isTyping: false })
    setSending(false)
  }

  const handleTyping = () => {
    const socket = getSocket()
    if (socket && activeChat) {
      socket.emit('typing', { receiverId: activeChat.userId, isTyping: true })
    }
  }

  const handleBack = () => {
    closeChat()
    setSearchParams({})
  }

  const selectConversation = (userId: string, name: string, connectionId?: string) => {
    openChat(userId, name, connectionId)
    setSearchParams({ user: userId, name })
  }

  const handleContextMenu = (e: React.MouseEvent, msg: DirectMessage) => {
    e.preventDefault()
    setContextMenu({ msg, x: e.clientX, y: e.clientY })
    setEmojiPicker(null)
  }

  const handleDelete = (msgId: string) => {
    const socket = getSocket()
    if (socket) socket.emit('delete_message', { messageId: msgId })
    setContextMenu(null)
  }

  const handleReaction = (msgId: string, emoji: string) => {
    const socket = getSocket()
    if (socket) socket.emit('toggle_reaction', { messageId: msgId, emoji })
    setEmojiPicker(null)
    setContextMenu(null)
  }

  // --- Tri-Chat handlers ---

  const handleSummonMediator = () => {
    if (!activeChat?.connectionId) return
    if (mediatorStreamingId) return
    if (triChat && triChat.turnsLeft !== null && triChat.turnsLeft <= 0) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('summon_mediator', {
      connectionId: activeChat.connectionId,
      sessionId: triChat?.activeSessionId || undefined,
    })
  }

  const handleReplyToMediator = (text: string) => {
    if (!activeChat?.connectionId || !triChat?.activeSessionId) return
    if (mediatorStreamingId) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('reply_to_mediator', {
      connectionId: activeChat.connectionId,
      sessionId: triChat.activeSessionId,
      text,
    })
  }

  const handleEndMediatorSession = () => {
    if (!activeChat?.connectionId || !triChat?.activeSessionId) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('end_mediator_session', {
      connectionId: activeChat.connectionId,
      sessionId: triChat.activeSessionId,
    })
  }

  const handleRenameMediator = () => {
    if (!activeChat?.connectionId) return
    const name = renameValue.trim()
    if (!name) return
    const connectionId = activeChat.connectionId
    // Optimistic local update
    useMessagingStore.getState().applyMediatorRenamed(connectionId, name.slice(0, 40))
    setRenameOpen(false)
    // Prefer socket so the other party hears about it; fall back to REST.
    const socket = getSocket()
    if (socket && socket.connected) {
      socket.emit('rename_mediator', { connectionId, name })
    } else {
      messagesApi.renameMediator(connectionId, name).catch((e: any) => {
        console.warn('rename mediator failed', e?.message || e)
      })
    }
  }

  const handleClearMyHistory = () => {
    if (!activeChat?.connectionId || clearing) return
    const connectionId = activeChat.connectionId
    setClearing(true)
    // Optimistic: wipe locally immediately so UI feels instant.
    useMessagingStore.getState().applyChatHistoryCleared(connectionId)
    setClearConfirmOpen(false)
    setClearing(false)
    // Fire server call in the background; socket echo will be a no-op since state already matches.
    const socket = getSocket()
    if (socket && socket.connected) {
      socket.emit('clear_chat_history', { connectionId })
    } else {
      messagesApi.clearChatHistory(connectionId).catch((e) => {
        console.warn('clear chat history failed', e)
      })
    }
    // Refresh conversations list in background (updates last-message preview).
    useMessagingStore.getState().loadConversations()
  }

  const handleAcceptAction = async (messageId: string, actionIndex: number) => {
    try {
      await messagesApi.acceptMediatorAction(messageId, actionIndex)
    } catch (e) {
      console.warn('accept action failed', e)
    }
  }

  const formatTime = (d: string) => {
    const date = new Date(d)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diff < 604800000) return date.toLocaleDateString([], { weekday: 'short' })
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const formatLastSeen = (d?: string | null) => {
    if (!d) return 'offline'
    const date = new Date(d)
    const diff = Date.now() - date.getTime()
    if (diff < 60000) return 'last seen just now'
    if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `last seen ${Math.floor(diff / 3600000)}h ago`
    return `last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
  }

  // Status ticks component
  const StatusTicks = ({ status, isMine }: { status?: string; isMine: boolean }) => {
    if (!isMine) return null
    switch (status) {
      case 'read':
        return <CheckCheck className="w-3.5 h-3.5 text-blue-400 inline-block ml-1" />
      case 'delivered':
        return <CheckCheck className="w-3.5 h-3.5 text-gray-400 inline-block ml-1" />
      default:
        return <Check className="w-3.5 h-3.5 text-gray-400 inline-block ml-1" />
    }
  }

  // Sort conversations: pinned first, then by last message time
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0
    return bTime - aTime
  }).filter((c) => !c.archived)

  // Two-panel layout: sidebar + chat
  return (
    <div className="flex h-full -m-4 lg:-m-8">
      {/* Conversation List */}
      <div className={`w-80 border-r border-gray-200 bg-white flex flex-col shrink-0 ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary-600" />
            Messages
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversationsLoading ? (
            <div className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
          ) : sortedConversations.length === 0 ? (
            <div className="text-center py-12 px-4 text-gray-500 text-sm">
              No conversations yet. Connect with someone to start messaging!
            </div>
          ) : (
            sortedConversations.map((conv) => {
              const isOnline = onlineUsers.has(conv.user.id)
              return (
                <button
                  key={conv.connectionId}
                  onClick={() => selectConversation(conv.user.id, conv.user.name, conv.connectionId)}
                  className={`w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                    activeChat?.userId === conv.user.id ? 'bg-primary-50' : ''
                  }`}
                >
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary-700">{conv.user.name?.[0]?.toUpperCase()}</span>
                    </div>
                    {/* Online dot */}
                    {isOnline && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <p className="font-medium text-gray-900 truncate text-sm flex items-center gap-1">
                        {conv.pinned && <span className="text-xs">📌</span>}
                        {conv.user.name}
                      </p>
                      {conv.lastMessage && (
                        <span className="text-xs text-gray-400 shrink-0 ml-2">{formatTime(conv.lastMessage.createdAt)}</span>
                      )}
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center">
                        {conv.lastMessage.senderId === user?.id && (
                          <StatusTicks status={conv.lastMessage.status} isMine={true} />
                        )}
                        <span className="ml-0.5">
                          {conv.lastMessage.deletedAt
                            ? '🚫 Message deleted'
                            : `${conv.lastMessage.senderId === user?.id ? 'You: ' : ''}${conv.lastMessage.content}`
                          }
                        </span>
                      </p>
                    )}
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="bg-primary-600 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex flex-col bg-gray-50 ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {!activeChat ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-200" />
              <p className="text-lg font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose from your connections to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
              <button onClick={handleBack} className="md:hidden p-1 hover:bg-gray-100 rounded">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary-700">{activeChat.name?.[0]?.toUpperCase()}</span>
                </div>
                {onlineUsers.has(activeChat.userId) && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 text-sm">{activeChat.name}</p>
                {typingUser === activeChat.userId ? (
                  <p className="text-xs text-green-600 font-medium">typing...</p>
                ) : onlineUsers.has(activeChat.userId) ? (
                  <p className="text-xs text-green-600">online</p>
                ) : (
                  <p className="text-xs text-gray-400">
                    {formatLastSeen(conversations.find((c) => c.user.id === activeChat.userId)?.user.lastSeenAt)}
                  </p>
                )}
              </div>
              {/* Mediator-name chip with inline rename (pencil edit).
                  Clear-history button — one-sided clear of this user's own
                  transcript. The other party keeps their full view.
                  Personality is purely prompt-driven — no more style picker. */}
              {activeChat.connectionId && (
                <div className="relative flex items-center gap-1">
                  <button
                    onClick={() => {
                      setRenameValue(triChat?.mediatorName || '4Ever')
                      setRenameOpen(true)
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-md flex items-center gap-1"
                    title="Rename the mediator (shared with the other side)"
                  >
                    <Sparkles className="w-3 h-3" />
                    {triChat?.mediatorName || '4Ever'}
                    <Pencil className="w-3 h-3 opacity-60" />
                  </button>
                  <button
                    onClick={() => setClearConfirmOpen(true)}
                    className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                    title="Clear chat history (for me only)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {triChat?.activeSessionId && (
                    <button
                      onClick={handleEndMediatorSession}
                      className="ml-1 text-[11px] px-2 py-1 rounded-md border border-red-300 text-red-600 hover:bg-red-50"
                      title="End the current mediator session"
                    >
                      End
                    </button>
                  )}
                </div>
              )}
              <button onClick={() => setShowSearch(!showSearch)} className="p-2 hover:bg-gray-100 rounded-lg">
                <Search className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Rename-mediator dialog (shared rename) */}
            {renameOpen && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
                  <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                    Rename the mediator
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    This name is shared with {activeChat.name}. Both of you
                    will see it in this chat, and the mediator will answer to it.
                  </p>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    maxLength={40}
                    autoFocus
                    placeholder="4Ever"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRenameMediator() }
                      if (e.key === 'Escape') setRenameOpen(false)
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                  <div className="flex items-center justify-end gap-2 mt-4">
                    <button
                      onClick={() => setRenameOpen(false)}
                      className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRenameMediator}
                      disabled={!renameValue.trim()}
                      className="px-3 py-1.5 text-sm rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      Save name
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Clear-history confirm dialog */}
            {clearConfirmOpen && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Clear this chat?</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    This hides every message up to now — only for you. {activeChat.name} still sees everything.
                    {' '}{triChat?.mediatorName || '4Ever'} will keep a short private summary so it remembers your history next time.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setClearConfirmOpen(false)}
                      disabled={clearing}
                      className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleClearMyHistory}
                      disabled={clearing}
                      className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 flex items-center gap-1.5"
                    >
                      {clearing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Clear for me
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search bar */}
            {showSearch && (
              <div className="bg-white border-b border-gray-200 px-4 py-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in conversation..."
                  className="input w-full text-sm"
                  autoFocus
                />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {chatHasMore && (
                <button onClick={loadMoreMessages} className="mx-auto flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 mb-2">
                  <ChevronUp className="w-3 h-3" /> Load earlier messages
                </button>
              )}
              {chatLoading ? (
                <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
              ) : chatMessages.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No messages yet. Say hello! 👋
                </div>
              ) : (
                chatMessages
                  .filter((msg) => !searchQuery || msg.content.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((msg) => {
                    const isMine = msg.senderId === user?.id
                    const isDeleted = !!msg.deletedAt
                    const isMediator = msg.messageType === 'mediator'
                    const isStreaming = mediatorStreamingId === msg.id
                    const reactions = msg.reactions || []
                    const groupedReactions = reactions.reduce<Record<string, string[]>>((acc, r) => {
                      if (!acc[r.emoji]) acc[r.emoji] = []
                      acc[r.emoji].push(r.userId)
                      return acc
                    }, {})

                    if (isMediator) {
                      let actions: MediatorActionCard[] = []
                      if (msg.mediatorActions) {
                        try { actions = JSON.parse(msg.mediatorActions) || [] } catch { /* */ }
                      }
                      return (
                        <div key={msg.id} className="flex justify-center my-2">
                          <div className="max-w-[85%] bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 rounded-2xl px-4 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Sparkles className="w-3 h-3 text-violet-600" />
                              <span className="text-[11px] font-medium text-violet-700">{triChat?.mediatorName || '4Ever'} Mediator</span>
                              {isStreaming && (
                                <span className="text-[10px] text-violet-500 italic">composing…</span>
                              )}
                            </div>
                            <p className="text-sm whitespace-pre-wrap text-gray-800">
                              {msg.content}
                              {isStreaming && <span className="inline-block w-1.5 h-3 bg-violet-400 ml-0.5 animate-pulse align-middle" />}
                            </p>
                            {actions.length > 0 && !isStreaming && (
                              <div className="mt-2 space-y-1.5">
                                {actions.map((card, idx) => {
                                  const accepted = Array.isArray(card.acceptedByUserIds) && card.acceptedByUserIds.includes(user?.id || '')
                                  const label =
                                    card.type === 'suggest_ritual' ? `Ritual: ${card.payload?.label || ''}` :
                                    card.type === 'suggest_task' ? `Task: ${card.payload?.label || ''}` :
                                    card.type === 'log_tension' ? `Log tension: ${card.payload?.title || ''}` :
                                    card.type === 'mark_agreement' ? `Agreement: ${card.payload?.summary || ''}` :
                                    card.type
                                  return (
                                    <button
                                      key={idx}
                                      disabled={accepted || card.type === 'mark_agreement'}
                                      onClick={() => handleAcceptAction(msg.id, idx)}
                                      className={`w-full text-left text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${
                                        accepted || card.type === 'mark_agreement'
                                          ? 'bg-violet-100 border-violet-300 text-violet-700 cursor-default'
                                          : 'bg-white border-violet-200 text-violet-800 hover:bg-violet-50'
                                      }`}
                                    >
                                      <span className="font-medium">{label}</span>
                                      {accepted && <span className="ml-2 text-[10px]">✓ accepted</span>}
                                      {card.type === 'mark_agreement' && <span className="ml-2 text-[10px]">logged</span>}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            <div className="text-[10px] text-violet-500 mt-1 text-right">
                              {formatTime(msg.createdAt)}
                            </div>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group`}>
                        <div
                          className="relative max-w-[70%]"
                          onContextMenu={(e) => !isDeleted && handleContextMenu(e, msg)}
                        >
                          {/* Reply preview */}
                          {msg.replyTo && !isDeleted && (
                            <div className={`text-xs px-3 py-1.5 rounded-t-2xl border-l-2 ${
                              isMine ? 'bg-primary-700/20 border-primary-300 text-primary-100' : 'bg-gray-100 border-primary-400 text-gray-600'
                            }`}>
                              <span className="font-medium">{msg.replyTo.sender.name}</span>
                              <p className="truncate opacity-80">{msg.replyTo.content}</p>
                            </div>
                          )}

                          {/* Message bubble */}
                          <div className={`rounded-2xl px-4 py-2 ${
                            isDeleted
                              ? 'bg-gray-100 text-gray-400 italic border border-gray-200'
                              : isMine
                                ? `bg-primary-600 text-white ${msg.replyTo ? 'rounded-tr-md' : 'rounded-br-md'}`
                                : `bg-white text-gray-900 border border-gray-200 ${msg.replyTo ? 'rounded-tl-md' : 'rounded-bl-md'}`
                          }`}>
                            {isDeleted ? (
                              <p className="text-sm flex items-center gap-1">🚫 This message was deleted</p>
                            ) : (
                              <>
                                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                <div className={`flex items-center justify-end gap-1 mt-0.5 ${isMine ? 'text-primary-200' : 'text-gray-400'}`}>
                                  {msg.editedAt && <span className="text-[10px] italic">edited</span>}
                                  <span className="text-[10px]">{formatTime(msg.createdAt)}</span>
                                  <StatusTicks status={msg.status} isMine={isMine} />
                                </div>
                              </>
                            )}
                          </div>

                          {/* Reactions */}
                          {Object.keys(groupedReactions).length > 0 && (
                            <div className={`flex flex-wrap gap-1 mt-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
                              {Object.entries(groupedReactions).map(([emoji, userIds]) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                    userIds.includes(user?.id || '')
                                      ? 'bg-primary-50 border-primary-200 text-primary-700'
                                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                  }`}
                                >
                                  {emoji} {userIds.length > 1 && userIds.length}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Hover actions */}
                          {!isDeleted && (
                            <div className={`absolute top-0 ${isMine ? '-left-8' : '-right-8'} hidden group-hover:flex flex-col gap-0.5`}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEmojiPicker(emojiPicker === msg.id ? null : msg.id) }}
                                className="p-1 rounded hover:bg-gray-200 text-gray-400"
                                title="React"
                              >
                                <Smile className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setReplyingTo(msg) }}
                                className="p-1 rounded hover:bg-gray-200 text-gray-400"
                                title="Reply"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {/* Emoji quick picker */}
                          {emojiPicker === msg.id && (
                            <div className={`absolute ${isMine ? 'right-0' : 'left-0'} -top-10 bg-white shadow-lg rounded-full border border-gray-200 px-2 py-1 flex gap-0.5 z-10`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {QUICK_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className="hover:scale-125 transition-transform text-base p-0.5"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Context Menu */}
            {contextMenu && (
              <div
                className="fixed bg-white shadow-xl rounded-xl border border-gray-200 py-1 z-50 min-w-[160px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { setReplyingTo(contextMenu.msg); setContextMenu(null) }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <Reply className="w-4 h-4" /> Reply
                </button>
                {contextMenu.msg.senderId === user?.id && (
                  <>
                    <button
                      onClick={() => { setEditingMessage(contextMenu.msg); setContextMenu(null) }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Pencil className="w-4 h-4" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(contextMenu.msg.id)}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Delete for everyone
                    </button>
                  </>
                )}
                <div className="border-t border-gray-100 my-1" />
                <div className="px-3 py-1.5 flex gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(contextMenu.msg.id, emoji)}
                      className="hover:scale-125 transition-transform text-lg p-0.5"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reply/Edit bar */}
            {(replyingTo || editingMessage) && (
              <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-3">
                <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 border-l-2 border-primary-500">
                  <p className="text-xs font-medium text-primary-600">
                    {editingMessage ? 'Editing message' : `Replying to ${replyingTo!.sender.name}`}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {editingMessage ? editingMessage.content : replyingTo!.content}
                  </p>
                </div>
                <button
                  onClick={() => { setReplyingTo(null); setEditingMessage(null); setInput('') }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            )}

            {/* Input */}
            <div className="bg-white border-t border-gray-200 p-3">
              <form
                onSubmit={(e) => { e.preventDefault(); handleSend() }}
                className="flex gap-2"
              >
                {/* Summon mediator button (one-sided) */}
                {activeChat.connectionId && (
                  <button
                    type="button"
                    onClick={handleSummonMediator}
                    disabled={
                      !!mediatorStreamingId ||
                      (triChat ? (triChat.turnsLeft !== null && triChat.turnsLeft <= 0) : false)
                    }
                    className="p-2.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-xl hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={
                      mediatorStreamingId
                        ? `${triChat?.mediatorName || '4Ever'} is composing…`
                        : triChat && triChat.turnsLeft !== null && triChat.turnsLeft <= 0
                          ? 'Out of free mediator turns this month'
                          : triChat?.activeSessionId
                            ? 'Continue the mediation'
                            : `Summon ${triChat?.mediatorName || '4Ever'}`
                    }
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                )}
                {triChat?.activeSessionId && input.trim() && !mediatorStreamingId && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = input.trim()
                      if (!text) return
                      handleReplyToMediator(text)
                      setInput('')
                    }}
                    className="px-3 py-2 text-xs bg-violet-100 text-violet-700 rounded-xl hover:bg-violet-200 transition-colors whitespace-nowrap"
                    title="Send as reply to the mediator (instead of to your partner)"
                  >
                    ↩ mediator
                  </button>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); handleTyping() }}
                  placeholder={editingMessage ? 'Edit message...' : 'Type a message...'}
                  className="input flex-1"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  className="p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {editingMessage ? <Check className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
