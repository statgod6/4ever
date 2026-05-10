import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, Modal, Pressable, Vibration,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useMessagingStore } from '../store/messagingStore'
import { useAuthStore } from '../store/authStore'
import { connectSocket, getSocket, disconnectSocket } from '../api/socket'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { EmptyState } from '../components/LoadingState'
import UserAvatar from '../components/UserAvatar'
import type { DirectMessage, MediatorActionCard } from '../api/messaging'
import { messagesApi } from '../api/messaging'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

export default function MessagesScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const {
    conversations, conversationsLoading, loadConversations,
    activeChat, chatMessages, openChat, closeChat,
    addIncomingMessage, addSentMessage, replaceTempWithReal,
    replyingTo, editingMessage, setReplyingTo, setEditingMessage,
    updateMessage, removeMessage, updateMessageStatus, updateReaction,
    loadUnreadCount,
    triChat, mediatorStreamingId,
    applyChatHistoryCleared, applyMediatorRenamed, applyMediatorSessionEnded, applyMediatorActionAccepted,
  } = useMessagingStore()

  const [input, setInput] = useState('')
  const [typingUser, setTypingUser] = useState<string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [contextMsg, setContextMsg] = useState<DirectMessage | null>(null)
  const [emojiPickerMsg, setEmojiPickerMsg] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  // When the screen loses focus (user hits the stack header back → Circle), clear the active chat
  // so it doesn't silently reopen the next time the screen mounts.
  useFocusEffect(
    useCallback(() => {
      return () => {
        closeChat()
      }
    }, [closeChat])
  )

  useEffect(() => {
    loadConversations()
    loadUnreadCount()
    if (!token) return
    const socket = connectSocket(token)
    if (!socket) return

    const onNewMessage = (msg: DirectMessage) => {
      const store = useMessagingStore.getState()
      store.addIncomingMessage(msg)
      store.loadConversations()
    }
    const onMessageSent = (msg: DirectMessage) => {
      const store = useMessagingStore.getState()
      store.replaceTempWithReal(msg)
      store.loadConversations()
    }
    const onUserTyping = (data: { userId: string; isTyping: boolean }) => {
      if (data.isTyping) {
        setTypingUser(data.userId)
        clearTimeout(typingTimeout.current)
        typingTimeout.current = setTimeout(() => setTypingUser(null), 3000)
      } else { setTypingUser(null) }
    }
    const onMessageStatus = (data: { messageId: string; status: 'delivered' | 'read' }) => {
      useMessagingStore.getState().updateMessageStatus(data.messageId, data.status)
    }
    const onMessagesRead = (data: { readBy: string }) => {
      const store = useMessagingStore.getState()
      const ac = store.activeChat
      if (ac && data.readBy === ac.userId) {
        store.chatMessages.forEach((m) => {
          if (m.senderId === user?.id && m.status !== 'read') {
            store.updateMessageStatus(m.id, 'read')
          }
        })
      }
    }
    const onMessageEdited = (msg: DirectMessage) => {
      useMessagingStore.getState().updateMessage(msg)
    }
    const onMessageDeleted = (data: { messageId: string; deletedAt: string }) => {
      useMessagingStore.getState().removeMessage(data.messageId, data.deletedAt)
      useMessagingStore.getState().loadConversations()
    }
    const onReactionUpdated = (data: { messageId: string; emoji: string; userId: string; action: 'added' | 'removed' }) => {
      useMessagingStore.getState().updateReaction(data.messageId, data.emoji, data.userId, data.action)
    }
    const onUserOnline = (d: { userId: string }) => setOnlineUsers((p) => new Set([...p, d.userId]))
    const onUserOffline = (d: { userId: string }) => setOnlineUsers((p) => { const n = new Set(p); n.delete(d.userId); return n })
    const onOnlineStatus = (statuses: { userId: string; online: boolean }[]) => {
      const online = new Set<string>()
      statuses.forEach((s) => { if (s.online) online.add(s.userId) })
      setOnlineUsers(online)
    }

    // --- Tri-Chat Mediator events ---
    const onTriChatToggled = (data: { connectionId: string; byUserId: string; enabled: boolean; bothEnabled: boolean }) => {
      const selfId = useAuthStore.getState().user?.id
      if (!selfId) return
      useMessagingStore.getState().applyTriChatToggle(data, selfId)
    }
    const onMediatorTyping = (data: { connectionId: string; messageId: string; sessionId?: string }) => {
      useMessagingStore.getState().startMediatorStream(data.messageId, data.sessionId)
    }
    const onMediatorChunk = (data: { messageId: string; delta: string }) => {
      useMessagingStore.getState().appendMediatorChunk(data.messageId, data.delta)
    }
    const onMediatorComplete = (data: { connectionId: string; messageId: string; actions?: string | null; sessionId?: string }) => {
      useMessagingStore.getState().finishMediatorStream(data.messageId, { actions: data.actions, sessionId: data.sessionId })
      useMessagingStore.getState().loadConversations()
    }
    const onMediatorError = (data: { error: string; messageId?: string }) => {
      useMessagingStore.getState().mediatorStreamError(data.messageId)
    }
    const onMediatorCancelled = (data: { connectionId: string; messageId: string }) => {
      if (data.messageId) useMessagingStore.getState().cancelMediatorStream(data.messageId)
    }
    const onChatHistoryCleared = (data: { connectionId: string }) => {
      useMessagingStore.getState().applyChatHistoryCleared(data.connectionId)
      useMessagingStore.getState().loadConversations()
    }
    const onMediatorRenamed = (data: { connectionId: string; mediatorName: string }) => {
      useMessagingStore.getState().applyMediatorRenamed(data.connectionId, data.mediatorName)
    }
    const onMediatorSessionEnded = (data: { connectionId: string; sessionId: string }) => {
      useMessagingStore.getState().applyMediatorSessionEnded(data.sessionId)
    }
    const onMediatorActionAccepted = (data: { messageId: string; actionIndex: number; userId: string }) => {
      useMessagingStore.getState().applyMediatorActionAccepted(data.messageId, data.actionIndex, data.userId)
    }

    socket.on('new_message', onNewMessage)
    socket.on('message_sent', onMessageSent)
    socket.on('user_typing', onUserTyping)
    socket.on('message_status', onMessageStatus)
    socket.on('messages_read', onMessagesRead)
    socket.on('message_edited', onMessageEdited)
    socket.on('message_deleted', onMessageDeleted)
    socket.on('reaction_updated', onReactionUpdated)
    socket.on('user_online', onUserOnline)
    socket.on('user_offline', onUserOffline)
    socket.on('online_status', onOnlineStatus)
    socket.on('tri_chat_toggled', onTriChatToggled)
    socket.on('mediator_typing', onMediatorTyping)
    socket.on('mediator_chunk', onMediatorChunk)
    socket.on('mediator_complete', onMediatorComplete)
    socket.on('mediator_error', onMediatorError)
        socket.on('mediator_cancelled', onMediatorCancelled)
    socket.on('chat_history_cleared', onChatHistoryCleared)
    socket.on('mediator_renamed', onMediatorRenamed)
    socket.on('mediator_session_ended', onMediatorSessionEnded)
    socket.on('mediator_action_accepted', onMediatorActionAccepted)

    const onlineStatusTimer = setTimeout(() => {
      const store = useMessagingStore.getState()
      const userIds = store.conversations.map((c) => c.user.id)
      if (userIds.length > 0) socket.emit('get_online_status', { userIds })
    }, 1000)

    return () => {
      clearTimeout(onlineStatusTimer)
      if (typingTimeout.current) clearTimeout(typingTimeout.current)
      socket.off('new_message', onNewMessage)
      socket.off('message_sent', onMessageSent)
      socket.off('user_typing', onUserTyping)
      socket.off('message_status', onMessageStatus)
      socket.off('messages_read', onMessagesRead)
      socket.off('message_edited', onMessageEdited)
      socket.off('message_deleted', onMessageDeleted)
      socket.off('reaction_updated', onReactionUpdated)
      socket.off('user_online', onUserOnline)
      socket.off('user_offline', onUserOffline)
      socket.off('online_status', onOnlineStatus)
      socket.off('tri_chat_toggled', onTriChatToggled)
      socket.off('mediator_typing', onMediatorTyping)
      socket.off('mediator_chunk', onMediatorChunk)
      socket.off('mediator_complete', onMediatorComplete)
      socket.off('mediator_error', onMediatorError)
            socket.off('mediator_cancelled', onMediatorCancelled)
      socket.off('chat_history_cleared', onChatHistoryCleared)
      socket.off('mediator_renamed', onMediatorRenamed)
      socket.off('mediator_session_ended', onMediatorSessionEnded)
      socket.off('mediator_action_accepted', onMediatorActionAccepted)
      disconnectSocket()
    }
  }, [token])

  const handleSend = () => {
    if (!input.trim() || !activeChat || !user) return
    const content = input.trim()
    setInput('')

    const socket = getSocket()
    if (!socket) return

    if (editingMessage) {
      socket.emit('edit_message', { messageId: editingMessage.id, content })
      setEditingMessage(null)
      return
    }

    const clientTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tempMsg: DirectMessage = {
      id: clientTempId, senderId: user.id, receiverId: activeChat.userId,
      content, isRead: false, status: 'sent', messageType: 'text',
      replyToId: replyingTo?.id || null,
      replyTo: replyingTo ? { id: replyingTo.id, content: replyingTo.content, senderId: replyingTo.senderId, sender: replyingTo.sender } : null,
      createdAt: new Date().toISOString(), sender: { id: user.id, name: user.name }, reactions: [],
    }
    addSentMessage(tempMsg)
    socket.emit('send_message', {
      receiverId: activeChat.userId,
      content,
      replyToId: replyingTo?.id || undefined,
      clientTempId,
    })
    setReplyingTo(null)

    // Typing stop
    socket.emit('typing', { receiverId: activeChat.userId, isTyping: false })
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleTyping = (text: string) => {
    setInput(text)
    const socket = getSocket()
    if (socket && activeChat) {
      socket.emit('typing', { receiverId: activeChat.userId, isTyping: true })
    }
  }

  const handleLongPress = (msg: DirectMessage) => {
    if (msg.deletedAt) return
    Vibration.vibrate(30)
    setContextMsg(msg)
  }

  const handleDelete = (msgId: string) => {
    Alert.alert('Delete Message', 'Delete this message for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        getSocket()?.emit('delete_message', { messageId: msgId })
        setContextMsg(null)
      }},
    ])
  }

  const handleReaction = (msgId: string, emoji: string) => {
    getSocket()?.emit('toggle_reaction', { messageId: msgId, emoji })
    setEmojiPickerMsg(null)
    setContextMsg(null)
  }

  // --- Mediator handlers (one-sided summoning) ---

  const handleSummonMediator = () => {
    if (!activeChat?.connectionId) return
    if (mediatorStreamingId) return
    if (triChat && triChat.turnsLeft !== null && triChat.turnsLeft <= 0) {
      Alert.alert('Out of turns', 'You have used all 10 free mediator turns this month. Upgrade to premium for unlimited.')
      return
    }
    getSocket()?.emit('summon_mediator', { connectionId: activeChat.connectionId, sessionId: triChat?.activeSessionId || undefined })
  }

  const handleReplyToMediator = () => {
    if (!activeChat?.connectionId || !triChat?.activeSessionId || !user) return
    const text = input.trim()
    if (!text) return
    setInput('')
    if (mediatorStreamingId) return
    getSocket()?.emit('reply_to_mediator', { connectionId: activeChat.connectionId, sessionId: triChat.activeSessionId, text })
  }

  const handleEndMediatorSession = () => {
    if (!activeChat?.connectionId || !triChat?.activeSessionId) return
    getSocket()?.emit('end_mediator_session', { connectionId: activeChat.connectionId, sessionId: triChat.activeSessionId })
  }

  const handleProposeStyle = async (_style: string) => { /* removed: mediator styles are now prompt-driven */ }

  const handleAcceptStyle = async () => { /* removed: mediator styles are now prompt-driven */ }

  const handleClearMyHistory = () => {
    if (!activeChat?.connectionId) return
    const mediatorName = (triChat?.mediatorName as any) || '4Ever'
    Alert.alert(
      'Clear this chat?',
      `This hides every message up to now — only for you. ${activeChat.name} still sees everything. ${mediatorName} will keep a short private summary so it remembers your history next time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear for me',
          style: 'destructive',
          onPress: () => {
            if (!activeChat?.connectionId) return
            const connectionId = activeChat.connectionId
            // Optimistic: wipe locally immediately so UI feels instant.
            useMessagingStore.getState().applyChatHistoryCleared(connectionId)
            // Fire server call in the background; socket echo will be a no-op since state already matches.
            const socket = getSocket()
            if (socket && socket.connected) {
              socket.emit('clear_chat_history', { connectionId })
            } else {
              messagesApi.clearChatHistory(connectionId).catch((e: any) => {
                console.warn('clear chat history failed', e?.message || e)
              })
            }
            useMessagingStore.getState().loadConversations()
          },
        },
      ],
    )
  }

  const handleToggleMediator = () => {
    if (!activeChat?.connectionId) return
    const connectionId = activeChat.connectionId
    const nextEnabled = !(triChat?.selfEnabled ?? true)
    const socket = getSocket()
    if (socket && socket.connected) {
      socket.emit('toggle_tri_chat', { connectionId, enabled: nextEnabled })
    } else {
      messagesApi.toggleTriChat(connectionId, nextEnabled).catch((e: any) => {
        console.warn('toggle mediator failed', e?.message || e)
      })
    }
  }

  const handleRenameMediator = () => {
    if (!activeChat?.connectionId) return
    const name = renameValue.trim()
    if (!name) return
    const connectionId = activeChat.connectionId
    useMessagingStore.getState().applyMediatorRenamed(connectionId, name.slice(0, 40))
    setRenameOpen(false)
    const socket = getSocket()
    if (socket && socket.connected) {
      socket.emit('rename_mediator', { connectionId, name })
    } else {
      messagesApi.renameMediator(connectionId, name).catch((e: any) => {
        console.warn('rename mediator failed', e?.message || e)
      })
    }
  }

  const handleAcceptAction = async (messageId: string, actionIndex: number) => {
    try {
      await messagesApi.acceptMediatorAction(messageId, actionIndex)
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Could not accept action')
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
    const diff = Date.now() - new Date(d).getTime()
    if (diff < 60000) return 'last seen just now'
    if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `last seen ${Math.floor(diff / 3600000)}h ago`
    return `last seen ${new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
  }

  const StatusTicks = ({ status, isMine }: { status?: string; isMine: boolean }) => {
    if (!isMine) return null
    switch (status) {
      case 'read': return <Text style={{ fontSize: 12, color: '#60a5fa', marginLeft: 4 }}>✓✓</Text>
      case 'delivered': return <Text style={{ fontSize: 12, color: colors.textMuted, marginLeft: 4 }}>✓✓</Text>
      default: return <Text style={{ fontSize: 12, color: colors.textMuted, marginLeft: 4 }}>✓</Text>
    }
  }

  // ─── Chat View ───────────────────────────────────────────────
  if (activeChat) {
    const isOnline = onlineUsers.has(activeChat.userId)
    const convUser = conversations.find((c) => c.user.id === activeChat.userId)?.user

    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {/* Header */}
        <View style={styles.chatHeader}>
          <View style={{ position: 'relative' }}>
            <UserAvatar
              name={activeChat.name}
              phoneNumber={convUser?.phoneNumber}
              avatarUrl={convUser?.avatarUrl}
              size={36}
            />
            {isOnline && <View style={styles.onlineDotSmall} />}
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <Text style={styles.chatHeaderName}>{activeChat.name}</Text>
            {typingUser === activeChat.userId ? (
              <Text style={styles.typingText}>typing...</Text>
            ) : isOnline ? (
              <Text style={styles.onlineText}>online</Text>
            ) : (
              <Text style={styles.lastSeenText}>{formatLastSeen(convUser?.lastSeenAt)}</Text>
            )}
          </View>
          {/* Three-dot menu: consolidates mediator on/off toggle, rename, and
              per-user clear-history into a single overflow menu so the header
              stays uncluttered. Session auto-ends on idle — no End button. */}
          {activeChat.connectionId && (
            <TouchableOpacity
              onPress={() => setMenuOpen(true)}
              style={styles.mediatorMenuBtn}
              accessibilityLabel="Chat options"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.mediatorMenuBtnText}>⋮</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.msgList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isMine = item.senderId === user?.id
            const isDeleted = !!item.deletedAt
            const isMediator = item.messageType === 'mediator'
            const isStreaming = mediatorStreamingId === item.id
            const reactions = item.reactions || []
            const groupedReactions: Record<string, string[]> = {}
            reactions.forEach((r: { emoji: string; userId: string }) => {
              if (!groupedReactions[r.emoji]) groupedReactions[r.emoji] = []
              groupedReactions[r.emoji].push(r.userId)
            })

            if (isMediator) {
              let actions: MediatorActionCard[] = []
              if (item.mediatorActions) {
                try { actions = JSON.parse(item.mediatorActions) as MediatorActionCard[] } catch { actions = [] }
              }
              return (
                <View style={styles.mediatorBubble}>
                  <View style={styles.mediatorHeader}>
                    <Text style={styles.mediatorLabel}>✨ {triChat?.mediatorName || '4Ever'} Mediator</Text>
                    {isStreaming && <Text style={styles.mediatorComposing}>composing…</Text>}
                  </View>
                  <Text style={styles.mediatorText}>
                    {item.content || ' '}
                    {isStreaming ? ' ▌' : ''}
                  </Text>
                  {actions.length > 0 && !isStreaming && (
                    <View style={styles.actionCardsWrap}>
                      {actions.map((card, idx) => {
                        const accepted = (card.acceptedByUserIds || []).includes(user?.id || '')
                        const isAutoLogged = card.type === 'mark_agreement'
                        const title =
                          card.type === 'suggest_ritual' ? `Ritual: ${card.payload?.label || ''}` :
                          card.type === 'suggest_task' ? `Task: ${card.payload?.label || ''}` :
                          card.type === 'log_tension' ? `Log tension: ${card.payload?.title || ''}` :
                          card.type === 'mark_agreement' ? `Agreement: ${card.payload?.summary || ''}` :
                          card.type
                        const description = card.payload?.description || card.payload?.note || ''
                        const labelByType: Record<MediatorActionCard['type'], string> = {
                          suggest_ritual: 'Add ritual',
                          suggest_task: 'Add to plan',
                          log_tension: 'Log tension',
                          mark_agreement: 'Agreement logged',
                        }
                        const iconByType: Record<MediatorActionCard['type'], string> = {
                          suggest_ritual: '🔁', suggest_task: '✓', log_tension: '⚠️', mark_agreement: '🤝',
                        }
                        return (
                          <View key={idx} style={styles.actionCard}>
                            <Text style={styles.actionCardTitle}>
                              {iconByType[card.type]} {title}
                            </Text>
                            {!!description && (
                              <Text style={styles.actionCardDesc}>{description}</Text>
                            )}
                            <TouchableOpacity
                              onPress={() => !accepted && !isAutoLogged && handleAcceptAction(item.id, idx)}
                              disabled={accepted || isAutoLogged}
                              style={[
                                styles.actionCardBtn,
                                (accepted || isAutoLogged) && styles.actionCardBtnDisabled,
                              ]}
                            >
                              <Text style={styles.actionCardBtnText}>
                                {isAutoLogged ? '✓ Logged' : accepted ? '✓ Accepted' : labelByType[card.type]}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )
                      })}
                    </View>
                  )}
                  <Text style={styles.mediatorTime}>{formatTime(item.createdAt)}</Text>
                </View>
              )
            }

            return (
              <Pressable onLongPress={() => handleLongPress(item)} delayLongPress={300}>
                {/* Reply preview */}
                {item.replyTo && !isDeleted && (
                  <View style={[styles.replyPreview, isMine ? styles.replyPreviewMine : styles.replyPreviewOther, { alignSelf: isMine ? 'flex-end' : 'flex-start' }]}>
                    <Text style={[styles.replyName, isMine && { color: '#c7d2fe' }]}>{item.replyTo.sender.name}</Text>
                    <Text style={[styles.replyContent, isMine && { color: '#c7d2fe' }]} numberOfLines={1}>{item.replyTo.content}</Text>
                  </View>
                )}

                {/* Bubble */}
                <View style={[styles.msgBubble, isMine ? styles.sentBubble : styles.receivedBubble, isDeleted && styles.deletedBubble]}>
                  {isDeleted ? (
                    <Text style={styles.deletedText}>🚫 This message was deleted</Text>
                  ) : (
                    <>
                      <Text style={[styles.msgText, isMine && { color: '#ffffff' }]}>{item.content}</Text>
                      <View style={styles.msgMeta}>
                        {item.editedAt && <Text style={[styles.metaText, isMine && { color: '#c7d2fe' }]}>edited </Text>}
                        <Text style={[styles.metaText, isMine && { color: '#c7d2fe' }]}>{formatTime(item.createdAt)}</Text>
                        <StatusTicks status={item.status} isMine={isMine} />
                      </View>
                    </>
                  )}
                </View>

                {/* Reactions */}
                {Object.keys(groupedReactions).length > 0 && (
                  <View style={[styles.reactionsRow, { alignSelf: isMine ? 'flex-end' : 'flex-start' }]}>
                    {Object.entries(groupedReactions).map(([emoji, userIds]) => (
                      <TouchableOpacity
                        key={emoji}
                        style={[styles.reactionChip, userIds.includes(user?.id || '') && styles.reactionChipActive]}
                        onPress={() => handleReaction(item.id, emoji)}
                      >
                        <Text style={{ fontSize: 12 }}>{emoji}{userIds.length > 1 ? ` ${userIds.length}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Pressable>
            )
          }}
        />

        {/* Reply/Edit bar */}
        {(replyingTo || editingMessage) && (
          <View style={styles.replyBar}>
            <View style={styles.replyBarContent}>
              <Text style={styles.replyBarTitle}>
                {editingMessage ? 'Editing message' : `Replying to ${replyingTo!.sender.name}`}
              </Text>
              <Text style={styles.replyBarText} numberOfLines={1}>
                {editingMessage ? editingMessage.content : replyingTo!.content}
              </Text>
            </View>
            <TouchableOpacity onPress={() => { setReplyingTo(null); setEditingMessage(null); setInput('') }}>
              <Text style={{ fontSize: 18, color: colors.textMuted }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          {activeChat.connectionId && (triChat?.selfEnabled ?? true) && (
            <TouchableOpacity
              style={[
                styles.mediatorBtn,
                (!!mediatorStreamingId || (triChat && triChat.turnsLeft !== null && triChat.turnsLeft <= 0)) && { opacity: 0.4 },
              ]}
              onPress={handleSummonMediator}
              disabled={!!mediatorStreamingId || (triChat ? (triChat.turnsLeft !== null && triChat.turnsLeft <= 0) : false)}
              accessibilityLabel="Summon mediator"
            >
              <Text style={{ color: '#ffffff', fontSize: 16 }}>{triChat?.activeSessionId ? '↻' : '✨'}</Text>
            </TouchableOpacity>
          )}
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={handleTyping}
            placeholder={editingMessage ? 'Edit message...' : triChat?.activeSessionId ? 'Message or ↩ reply to mediator' : 'Type a message...'}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          {triChat?.activeSessionId && input.trim().length > 0 && !editingMessage && (
            <TouchableOpacity
              style={[styles.replyMediatorBtn, !!mediatorStreamingId && { opacity: 0.4 }]}
              onPress={handleReplyToMediator}
              disabled={!!mediatorStreamingId}
            >
              <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 14 }}>↩✨</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && { backgroundColor: colors.gray[300] }]}
            onPress={handleSend}
            disabled={!input.trim()}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>
              {editingMessage ? '✓' : '↑'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Chat options overflow menu — consolidates mediator on/off,
            rename, and clear-history into one sheet. */}
        <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setMenuOpen(false)}>
            <Pressable style={styles.optionsMenu} onPress={() => {}}>
              <TouchableOpacity
                style={styles.optionsItem}
                onPress={() => {
                  setMenuOpen(false)
                  handleToggleMediator()
                }}
              >
                <Text style={styles.optionsItemIcon}>{(triChat?.selfEnabled ?? true) ? '✨' : '🌙'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionsItemText}>
                    {(triChat?.selfEnabled ?? true) ? 'Turn mediator off' : 'Turn mediator on'}
                  </Text>
                  <Text style={styles.optionsItemSub}>
                    {(triChat?.selfEnabled ?? true)
                      ? 'Hide the summon button on your side'
                      : 'Show the summon button again'}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.optionsDivider} />
              <TouchableOpacity
                style={styles.optionsItem}
                onPress={() => {
                  setMenuOpen(false)
                  setRenameValue(triChat?.mediatorName || '4Ever')
                  setRenameOpen(true)
                }}
              >
                <Text style={styles.optionsItemIcon}>✎</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionsItemText}>
                    Rename mediator
                  </Text>
                  <Text style={styles.optionsItemSub} numberOfLines={1}>
                    currently “{triChat?.mediatorName || '4Ever'}”
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.optionsDivider} />
              <TouchableOpacity
                style={styles.optionsItem}
                onPress={() => {
                  setMenuOpen(false)
                  handleClearMyHistory()
                }}
              >
                <Text style={styles.optionsItemIcon}>🗑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionsItemText, { color: '#ef4444' }]}>
                    Clear chat for me
                  </Text>
                  <Text style={styles.optionsItemSub}>
                    Hides every message on your side only
                  </Text>
                </View>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Rename Mediator Modal */}
        <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setRenameOpen(false)}>
            <Pressable style={styles.renameDialog} onPress={() => {}}>
              <Text style={styles.renameTitle}>Rename the mediator</Text>
              <Text style={styles.renameSubtitle}>
                This name is shared with {activeChat?.name}. Both of you will see it here, and the mediator will answer to it.
              </Text>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                maxLength={40}
                autoFocus
                placeholder="4Ever"
                placeholderTextColor={colors.textMuted}
                style={styles.renameInput}
                returnKeyType="done"
                onSubmitEditing={handleRenameMediator}
              />
              <View style={styles.renameButtonRow}>
                <TouchableOpacity
                  onPress={() => setRenameOpen(false)}
                  style={[styles.renameBtn, { backgroundColor: colors.card }]}
                >
                  <Text style={[styles.renameBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRenameMediator}
                  disabled={!renameValue.trim()}
                  style={[styles.renameBtn, { backgroundColor: colors.primary[500], opacity: renameValue.trim() ? 1 : 0.5 }]}
                >
                  <Text style={[styles.renameBtnText, { color: '#ffffff' }]}>Save name</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Context Menu Modal */}
        <Modal visible={!!contextMsg} transparent animationType="fade" onRequestClose={() => setContextMsg(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setContextMsg(null)}>
            <View style={styles.contextMenu}>
              {/* Emoji row */}
              <View style={styles.contextEmojiRow}>
                {QUICK_EMOJIS.map((emoji) => (
                  <TouchableOpacity key={emoji} onPress={() => contextMsg && handleReaction(contextMsg.id, emoji)} style={styles.contextEmoji}>
                    <Text style={{ fontSize: 22 }}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.contextDivider} />
              <TouchableOpacity style={styles.contextItem} onPress={() => { if (contextMsg) { setReplyingTo(contextMsg); setContextMsg(null) } }}>
                <Text style={styles.contextItemText}>↩ Reply</Text>
              </TouchableOpacity>
              {contextMsg?.senderId === user?.id && (
                <>
                  <TouchableOpacity style={styles.contextItem} onPress={() => { if (contextMsg) { setEditingMessage(contextMsg); setInput(contextMsg.content); setContextMsg(null) } }}>
                    <Text style={styles.contextItemText}>✏️ Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.contextItem} onPress={() => contextMsg && handleDelete(contextMsg.id)}>
                    <Text style={[styles.contextItemText, { color: '#ef4444' }]}>🗑 Delete for everyone</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    )
  }

  // ─── Conversation List ───────────────────────────────────────
  const sortedConversations = [...conversations]
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0
      const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0
      return bTime - aTime
    })
    .filter((c) => !c.archived)

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Messages</Text>
      <FlatList
        data={sortedConversations}
        keyExtractor={(item) => item.connectionId}
        contentContainerStyle={styles.convList}
        ListEmptyComponent={!conversationsLoading ? <EmptyState icon="💬" title="No conversations" subtitle="Connect with people to start messaging" /> : null}
        renderItem={({ item }) => {
          const isOnline = onlineUsers.has(item.user.id)
          return (
            <TouchableOpacity style={styles.convItem} onPress={() => openChat(item.user.id, item.user.name, item.connectionId)}>
              <View style={{ position: 'relative' }}>
                <UserAvatar
                  name={item.user.name}
                  phoneNumber={item.user.phoneNumber}
                  avatarUrl={item.user.avatarUrl}
                  size={48}
                />
                {isOnline && <View style={styles.onlineDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={styles.convName}>
                    {item.pinned ? '📌 ' : ''}{item.user.name}
                  </Text>
                  {item.lastMessage && (
                    <Text style={styles.convTime}>{formatTime(item.lastMessage.createdAt)}</Text>
                  )}
                </View>
                {item.lastMessage && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {item.lastMessage.senderId === user?.id && (
                      <StatusTicks status={item.lastMessage.status} isMine={true} />
                    )}
                    <Text style={styles.convPreview} numberOfLines={1}>
                      {item.lastMessage.deletedAt
                        ? '🚫 Message deleted'
                        : `${item.lastMessage.senderId === user?.id ? 'You: ' : ''}${item.lastMessage.content}`
                      }
                    </Text>
                  </View>
                )}
              </View>
              {item.unreadCount > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount}</Text></View>
              )}
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  convList: { padding: Spacing.xl, paddingTop: 0, paddingBottom: 120 },
  convItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary[100], justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: FontSize.lg, fontWeight: '700', color: colors.primary[600] },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#22c55e', borderWidth: 2, borderColor: colors.card },
  onlineDotSmall: { position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: '#22c55e', borderWidth: 2, borderColor: colors.card },
  convName: { fontSize: FontSize.base, fontWeight: '600', color: colors.text, flex: 1 },
  convTime: { fontSize: FontSize.xs, color: colors.textMuted },
  convPreview: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2, flex: 1 },
  badge: { backgroundColor: colors.primary[500], borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#ffffff', fontSize: FontSize.xs, fontWeight: '700' },

  // Chat
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  backBtn: { fontSize: FontSize.base, color: colors.primary[500], fontWeight: '600' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[100], justifyContent: 'center', alignItems: 'center' },
  headerAvatarText: { fontSize: FontSize.base, fontWeight: '700', color: colors.primary[600] },
  chatHeaderName: { fontSize: FontSize.base, fontWeight: '700', color: colors.text },
  typingText: { fontSize: FontSize.xs, color: '#22c55e', fontWeight: '600' },
  onlineText: { fontSize: FontSize.xs, color: '#22c55e' },
  lastSeenText: { fontSize: FontSize.xs, color: colors.textMuted },

  msgList: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  msgBubble: { maxWidth: '80%', padding: Spacing.md, borderRadius: BorderRadius.lg, marginBottom: 4 },
  sentBubble: { backgroundColor: colors.primary[500], alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  receivedBubble: { backgroundColor: colors.card, alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark) },
  deletedBubble: { backgroundColor: colors.gray[100], borderWidth: 1, borderColor: colors.border },
  deletedText: { fontSize: FontSize.sm, color: colors.textMuted, fontStyle: 'italic' },
  msgText: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  msgMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
  metaText: { fontSize: 10, color: colors.textMuted },

  replyPreview: { maxWidth: '80%', paddingHorizontal: Spacing.md, paddingVertical: 4, borderLeftWidth: 2, borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg, marginBottom: -2 },
  replyPreviewMine: { backgroundColor: 'rgba(99, 102, 241, 0.15)', borderLeftColor: '#818cf8' },
  replyPreviewOther: { backgroundColor: colors.gray[100], borderLeftColor: colors.primary[400] },
  replyName: { fontSize: FontSize.xs, fontWeight: '600', color: colors.primary[500] },
  replyContent: { fontSize: FontSize.xs, color: colors.textSecondary },

  reactionsRow: { flexDirection: 'row', gap: 4, marginBottom: Spacing.sm, marginTop: -2 },
  reactionChip: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 },
  reactionChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[200] },

  replyBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  replyBarContent: { flex: 1, backgroundColor: colors.gray[50], borderLeftWidth: 2, borderLeftColor: colors.primary[500], borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: 4 },
  replyBarTitle: { fontSize: FontSize.xs, fontWeight: '600', color: colors.primary[500] },
  replyBarText: { fontSize: FontSize.xs, color: colors.textSecondary },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, gap: Spacing.sm },
  textInput: { flex: 1, backgroundColor: colors.gray[50], borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, fontSize: FontSize.base, color: colors.text, maxHeight: 100, borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark) },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[500], justifyContent: 'center', alignItems: 'center' },

  // Context menu modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  contextMenu: { backgroundColor: colors.card, borderRadius: BorderRadius.xl, width: 260, overflow: 'hidden', elevation: 10, ...neonCard(colors, isDark, 'violet') },
  contextEmojiRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm },
  contextEmoji: { padding: 4 },
  contextDivider: { height: 1, backgroundColor: colors.border },
  contextItem: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  contextItemText: { fontSize: FontSize.base, color: colors.text },

  // --- Tri-Chat Mediator styles ---
  mediatorMenuBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card },
  mediatorMenuBtnText: { fontSize: 22, color: colors.text, fontWeight: '700', lineHeight: 22 },
  mediatorNameChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: isDark ? '#2a1f3d' : '#f3e8ff',
    borderWidth: 1,
    borderColor: isDark ? '#4c3a6f' : '#e9d5ff',
    maxWidth: 140,
  },
  mediatorNameChipText: { fontSize: 11, color: isDark ? '#e9d5ff' : '#6b21a8', fontWeight: '600' },
  optionsMenu: {
    backgroundColor: colors.card,
    borderRadius: 16,
    marginHorizontal: 24,
    width: '86%',
    maxWidth: 420,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  optionsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionsItemIcon: {
    fontSize: 20,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  optionsItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  optionsItemSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  optionsDivider: {
    height: 1,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    marginHorizontal: 16,
  },
  renameDialog: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    width: '86%',
    maxWidth: 420,
  },
  renameTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  renameSubtitle: { fontSize: 12, color: colors.textSecondary, marginBottom: 12, lineHeight: 16 },
  renameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.card,
  },
  renameButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  renameBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  renameBtnText: { fontSize: 13, fontWeight: '600' },
  mediatorMenu: { backgroundColor: colors.card, borderRadius: BorderRadius.xl, width: 280, padding: Spacing.lg, ...neonCard(colors, isDark, 'violet') },
  mediatorMenuHeading: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
  mediatorMenuStylesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.md },
  mediatorMenuQuota: { fontSize: FontSize.xs, color: colors.textSecondary, marginBottom: Spacing.sm },
  mediatorMenuEndBtn: { paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' },
  mediatorMenuEndText: { fontSize: FontSize.sm, color: '#ef4444', fontWeight: '700' },
  triToggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  triToggleBtnOn: { backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: '#8b5cf6' },
  triToggleBtnPending: { backgroundColor: 'rgba(251, 191, 36, 0.15)', borderColor: '#f59e0b' },
  triToggleBtnText: { fontSize: FontSize.xs, color: colors.text, fontWeight: '600' },

  triBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: 'rgba(139, 92, 246, 0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(139, 92, 246, 0.25)' },
  triBannerText: { fontSize: FontSize.xs, color: isDark ? '#c4b5fd' : '#6d28d9', fontWeight: '600' },
  triBannerQuota: { fontSize: FontSize.xs, color: isDark ? '#a78bfa' : '#7c3aed' },
  triBannerPending: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: 'rgba(251, 191, 36, 0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(251, 191, 36, 0.3)' },
  triBannerPendingText: { fontSize: FontSize.xs, color: isDark ? '#fde68a' : '#92400e' },

  mediatorBubble: { alignSelf: 'center', maxWidth: '88%', backgroundColor: isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)', borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.3)', borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginVertical: Spacing.xs },
  mediatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  mediatorLabel: { fontSize: 11, fontWeight: '700', color: isDark ? '#c4b5fd' : '#6d28d9' },
  mediatorComposing: { fontSize: 10, color: isDark ? '#a78bfa' : '#8b5cf6', fontStyle: 'italic' },
  mediatorText: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  mediatorTime: { fontSize: 10, color: isDark ? '#a78bfa' : '#7c3aed', textAlign: 'right', marginTop: 2 },

  mediatorBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#8b5cf6', justifyContent: 'center', alignItems: 'center' },
  replyMediatorBtn: { height: 40, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#a78bfa', justifyContent: 'center', alignItems: 'center' },

  stylePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.3)', backgroundColor: 'transparent' },
  stylePillActive: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  stylePillText: { fontSize: 10, color: isDark ? '#c4b5fd' : '#6d28d9', fontWeight: '600' },
  stylePillTextActive: { color: '#ffffff' },
  endSessionBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#ef4444', backgroundColor: 'transparent' },
  endSessionText: { fontSize: 10, color: '#ef4444', fontWeight: '600' },

  styleProposalBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: 'rgba(251, 191, 36, 0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(251, 191, 36, 0.3)' },
  styleProposalBannerSelf: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: 'rgba(139, 92, 246, 0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(139, 92, 246, 0.2)' },
  styleProposalText: { fontSize: FontSize.xs, color: isDark ? '#fde68a' : '#92400e', flex: 1 },
  styleProposalBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#f59e0b' },
  styleProposalBtnText: { fontSize: 11, color: '#ffffff', fontWeight: '700' },

  actionCardsWrap: { marginTop: Spacing.sm, gap: 6 },
  actionCard: { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.7)', borderRadius: BorderRadius.md, padding: Spacing.sm, borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.25)' },
  actionCardTitle: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
  actionCardDesc: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2 },
  actionCardBtn: { marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#8b5cf6', alignSelf: 'flex-start' },
  actionCardBtnDisabled: { backgroundColor: colors.gray[300] },
  actionCardBtnText: { fontSize: 11, color: '#ffffff', fontWeight: '700' },
})
