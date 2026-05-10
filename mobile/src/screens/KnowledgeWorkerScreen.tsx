import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import Markdown from 'react-native-markdown-display'
import { useAuthStore } from '../store/authStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { knowledgeWorkerApi, type KwDocument, type KwConversationSummary } from '../api/knowledge-worker'
import type { StreamEvent } from '../api/orchestration'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { BASE_URL } from '../constants/config'
import { useTheme } from '../contexts/ThemeContext'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface ToolActivity {
  tool: string
  done: boolean
}

const SUGGESTIONS = [
  'Summarize the latest trends in AI',
  'Help me analyze a research question',
  'Draft an outline for a report',
]

// Pure URL rewriter kept at module scope so it doesn't change identity
// every render (keeps memoized MessageItem stable).
function absolutizeUrlsFn(text: string): string {
  if (!text) return text
  return text.replace(
    /(\!?\[[^\]]*\]\()(\/api\/[^)\s]+)(\))/g,
    (_m, p1, p2, p3) => `${p1}${BASE_URL}${p2}${p3}`,
  )
}

// Memoized message row. Re-renders only when the message content / role
// actually changes, which keeps streaming-token parent re-renders from
// churning every prior assistant bubble's Markdown tree.
const MessageItem = React.memo(
  ({
    item,
    styles,
    markdownStyle,
    markdownRules,
  }: {
    item: ChatMessage
    styles: any
    markdownStyle: any
    markdownRules: any
  }) => {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubbleWrap}>
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        </View>
      )
    }
    return (
      <View style={styles.assistantRow}>
        <View style={styles.assistantBubble}>
          <Markdown style={markdownStyle} rules={markdownRules}>
            {absolutizeUrlsFn(item.content)}
          </Markdown>
        </View>
      </View>
    )
  },
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.item.content === next.item.content &&
    prev.item.role === next.item.role &&
    prev.markdownStyle === next.markdownStyle &&
    prev.markdownRules === next.markdownRules &&
    prev.styles === next.styles,
)

export default function KnowledgeWorkerScreen() {
  const { colors, isDark } = useTheme()
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark])
  const token = useAuthStore((s) => s.token)
  const subTier = useSubscriptionStore((s) => s.tier)
  const subActive = useSubscriptionStore((s) => s.active)
  const subLoaded = useSubscriptionStore((s) => s.loaded)
  const loadSub = useSubscriptionStore((s) => s.load)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [streamedContent, setStreamedContent] = useState('')
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [documents, setDocuments] = useState<KwDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [conversations, setConversations] = useState<KwConversationSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingConvo, setLoadingConvo] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  // Rewrite relative /api/knowledge-worker/generated/... URLs in assistant
  // markdown to absolute URLs pointing at the dev backend, so <img> and
  // links work on a real device over LAN.
  // (Implementation is at module scope as `absolutizeUrlsFn` to keep
  // memoized MessageItem stable; this alias is kept for readability.)
  const absolutizeUrls = absolutizeUrlsFn

  // Custom image renderer to avoid the `react-native-markdown-display`
  // warning: "A props object containing a 'key' prop is being spread into JSX".
  // The library's default FitImage spreads { key, ... } — React 18 forbids that.
  const markdownRules = useMemo(
    () => ({
      image: (node: any) => {
        const src: string | undefined = node?.attributes?.src
        const alt: string | undefined = node?.attributes?.alt
        if (!src) return null
        return (
          <Image
            key={node.key}
            source={{ uri: src }}
            accessible
            accessibilityLabel={alt || 'image'}
            resizeMode="contain"
            style={{
              width: '100%',
              aspectRatio: 16 / 10,
              marginVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.card,
            }}
          />
        )
      },
    }),
    [colors.card],
  )

  // Full markdown stylesheet so KW responses look polished on mobile.
  const markdownStyle = useMemo(
    () =>
      ({
        body: { color: colors.text, fontSize: FontSize.base, lineHeight: 22 },
        paragraph: { marginTop: 0, marginBottom: 8, color: colors.text, lineHeight: 22 },
        heading1: {
          fontSize: 22,
          fontWeight: '800' as const,
          color: colors.text,
          marginTop: 12,
          marginBottom: 6,
        },
        heading2: {
          fontSize: 19,
          fontWeight: '800' as const,
          color: colors.text,
          marginTop: 10,
          marginBottom: 6,
        },
        heading3: {
          fontSize: 17,
          fontWeight: '700' as const,
          color: colors.text,
          marginTop: 8,
          marginBottom: 4,
        },
        heading4: {
          fontSize: 15,
          fontWeight: '700' as const,
          color: colors.text,
          marginTop: 6,
          marginBottom: 4,
        },
        strong: { fontWeight: '700' as const, color: colors.text },
        em: { fontStyle: 'italic' as const, color: colors.textSecondary },
        bullet_list: { marginVertical: 4 },
        ordered_list: { marginVertical: 4 },
        list_item: { marginBottom: 4, color: colors.text, lineHeight: 22 },
        bullet_list_icon: { color: colors.primary[500], marginLeft: 0, marginRight: 8 },
        ordered_list_icon: { color: colors.primary[500], marginLeft: 0, marginRight: 8, fontWeight: '700' as const },
        blockquote: {
          borderLeftWidth: 3,
          borderLeftColor: colors.primary[400],
          backgroundColor: colors.card,
          paddingLeft: 12,
          paddingRight: 10,
          paddingVertical: 8,
          marginVertical: 8,
          borderRadius: 4,
        },
        hr: { backgroundColor: colors.border, height: 1, marginVertical: 10 },
        code_inline: {
          backgroundColor: colors.card,
          color: colors.primary[600],
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
          fontSize: 13,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: colors.border,
        },
        code_block: {
          backgroundColor: isDark ? '#0f172a' : '#1f2937',
          color: '#e5e7eb',
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
          fontSize: 12.5,
          padding: 10,
          borderRadius: 8,
          marginVertical: 8,
        },
        fence: {
          backgroundColor: isDark ? '#0f172a' : '#1f2937',
          color: '#e5e7eb',
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
          fontSize: 12.5,
          padding: 10,
          borderRadius: 8,
          marginVertical: 8,
        },
        table: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          marginVertical: 8,
          overflow: 'hidden' as const,
        },
        thead: { backgroundColor: colors.card },
        th: { padding: 8, fontWeight: '700' as const, color: colors.text },
        tr: { borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row' as const },
        td: { padding: 8, color: colors.text },
        link: { color: colors.primary[600], textDecorationLine: 'underline' as const },
      }) as any,
    [colors, isDark],
  )

  useEffect(() => {
    if (!subLoaded) loadSub()
  }, [subLoaded, loadSub])

  const refreshDocs = useCallback(async () => {
    try {
      const docs = await knowledgeWorkerApi.listDocuments()
      setDocuments(docs)
    } catch {
      // silent — user sees empty list
    }
  }, [])

  useEffect(() => {
    // Knowledge Worker is universal access — load docs for any authenticated user.
    if (subLoaded) refreshDocs()
  }, [subLoaded, refreshDocs])

  const refreshConversations = useCallback(async () => {
    try {
      const list = await knowledgeWorkerApi.listConversations()
      setConversations(list)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    // Knowledge Worker is universal access — load conversation history for any authenticated user.
    if (subLoaded) refreshConversations()
  }, [subLoaded, refreshConversations])

  const handleNewChat = useCallback(() => {
    if (streaming) return
    setConversationId(null)
    setMessages([])
    setStreamedContent('')
    setToolActivities([])
    setInput('')
    setShowHistory(false)
  }, [streaming])

  const handleLoadConversation = useCallback(
    async (convoId: string) => {
      if (streaming) return
      setLoadingConvo(true)
      try {
        const msgs = await knowledgeWorkerApi.getMessages(convoId)
        const mapped: ChatMessage[] = msgs.map((m) => ({
          id: m.id,
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt,
        }))
        setMessages(mapped)
        setConversationId(convoId)
        setStreamedContent('')
        setToolActivities([])
        setShowHistory(false)
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 120)
      } catch (e: any) {
        Alert.alert('Could not open chat', e?.message || 'Unknown error')
      } finally {
        setLoadingConvo(false)
      }
    },
    [streaming],
  )

  const handleDeleteConversation = useCallback(
    (convo: KwConversationSummary) => {
      Alert.alert(
        'Delete chat?',
        `"${convo.title || 'Untitled'}" will be removed permanently.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await knowledgeWorkerApi.deleteConversation(convo.id)
                if (conversationId === convo.id) {
                  setConversationId(null)
                  setMessages([])
                }
                await refreshConversations()
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Unknown error')
              }
            },
          },
        ],
      )
    },
    [conversationId, refreshConversations],
  )

  const handleAttachFile = useCallback(async () => {
    if (uploading || streaming) return
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'text/plain',
          'text/markdown',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      if (asset.size && asset.size > 25 * 1024 * 1024) {
        Alert.alert('File too large', 'Maximum size is 25 MB.')
        return
      }
      setUploading(true)
      const uploaded = await knowledgeWorkerApi.uploadDocument({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      })
      await refreshDocs()
      setShowDocs(true)
      Alert.alert('Uploaded', `"${uploaded.filename}" indexed (${uploaded.chunks} chunks). Ask the agent about it now.`)
    } catch (e: any) {
      Alert.alert('Upload failed', e?.response?.data?.message || e?.message || 'Unknown error')
    } finally {
      setUploading(false)
    }
  }, [uploading, streaming, refreshDocs])

  const handleDeleteDoc = useCallback(
    (doc: KwDocument) => {
      Alert.alert('Delete document?', `Remove "${doc.filename}" from Knowledge Worker?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await knowledgeWorkerApi.deleteDocument(doc.id)
              await refreshDocs()
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Unknown error')
            }
          },
        },
      ])
    },
    [refreshDocs],
  )

  const scrollToBottom = () => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim()
      if (!text || streaming) return

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setStreaming(true)
      setStreamedContent('')
      setToolActivities([])
      scrollToBottom()

      let fullResponse = ''

      try {
        await knowledgeWorkerApi.stream(
          text,
          conversationId,
          (event: StreamEvent) => {
            switch (event.event) {
              case 'tool_start':
                setToolActivities((prev) => [
                  ...prev,
                  { tool: event.data.tool, done: false },
                ])
                break
              case 'tool_end':
                setToolActivities((prev) =>
                  prev.map((t) =>
                    t.tool === event.data.tool && !t.done ? { ...t, done: true } : t,
                  ),
                )
                break
              case 'token_reset':
                fullResponse = ''
                setStreamedContent('')
                break
              case 'token':
                fullResponse += event.data.chunk || ''
                setStreamedContent(fullResponse)
                scrollToBottom()
                break
              case 'response':
                fullResponse = event.data.text || event.data.content || fullResponse
                setStreamedContent(fullResponse)
                break
              case 'done':
                if ((event.data as any)?.conversationId) {
                  setConversationId((event.data as any).conversationId)
                }
                const assistantMsg: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: fullResponse,
                  createdAt: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, assistantMsg])
                setStreamedContent('')
                setToolActivities([])
                setStreaming(false)
                scrollToBottom()
                refreshConversations()
                break
            }
          },
          token,
        )
      } catch (err) {
        setStreaming(false)
        setStreamedContent('')
        setToolActivities([])
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
            createdAt: new Date().toISOString(),
          },
        ])
      }
    },
    [input, streaming, token, conversationId, refreshConversations],
  )

  // Paywall removed — Knowledge Worker is universal access under the new pricing strategy.

  if (!subLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    )
  }

  // Phase-aware label for the persistent thinking indicator. Updates as the
  // agent moves through phases: initial → tool running → tool done/waiting
  // → generating tokens. Cheap to recompute on every token.
  const thinkingLabel = useMemo(() => {
    if (!streaming) return 'Thinking...'
    const activeTool = toolActivities.find((t) => !t.done)
    if (activeTool) return `Running ${activeTool.tool}...`
    if (toolActivities.length > 0 && !streamedContent) return 'Composing response...'
    if (streamedContent) return 'Generating...'
    return 'Thinking...'
  }, [streaming, toolActivities, streamedContent])

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageItem
        item={item}
        styles={styles}
        markdownStyle={markdownStyle}
        markdownRules={markdownRules}
      />
    ),
    [styles, markdownStyle, markdownRules],
  )

  const sendEnabled = !!input.trim() && !streaming

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Top toolbar: New chat + History */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={handleNewChat}
          disabled={streaming}
          style={[styles.toolbarBtn, streaming && styles.toolbarBtnDisabled]}
          activeOpacity={0.75}
        >
          <Text style={styles.toolbarBtnText}>＋ New chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            refreshConversations()
            setShowHistory(true)
          }}
          style={styles.toolbarBtnGhost}
          activeOpacity={0.75}
        >
          <Text style={styles.toolbarBtnGhostText}>
            🕑 History{conversations.length > 0 ? ` (${conversations.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* History modal */}
      <Modal
        visible={showHistory}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHistory(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowHistory(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your chats</Text>
              <TouchableOpacity onPress={() => setShowHistory(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.modalNewBtn} onPress={handleNewChat} activeOpacity={0.8}>
              <Text style={styles.modalNewBtnText}>＋ Start a new chat</Text>
            </TouchableOpacity>
            {loadingConvo && (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.primary[500]} />
                <Text style={styles.modalLoadingText}>Loading…</Text>
              </View>
            )}
            {conversations.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Text style={styles.modalEmptyText}>No past chats yet.</Text>
              </View>
            ) : (
              <FlatList
                data={conversations}
                keyExtractor={(c) => c.id}
                style={styles.modalList}
                renderItem={({ item }) => {
                  const active = item.id === conversationId
                  return (
                    <View style={[styles.convoRow, active && styles.convoRowActive]}>
                      <TouchableOpacity
                        style={styles.convoTap}
                        onPress={() => handleLoadConversation(item.id)}
                        onLongPress={() => handleDeleteConversation(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.convoTitle} numberOfLines={1}>
                          {item.title || 'Untitled chat'}
                        </Text>
                        <Text style={styles.convoDate}>
                          {new Date(item.updatedAt).toLocaleDateString()} · {new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteConversation(item)}
                        style={styles.convoDelete}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.convoDeleteText}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                  )
                }}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => scrollToBottom()}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={6}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        ListHeaderComponent={
          documents.length > 0 ? (
            <View style={styles.docsHeader}>
              <TouchableOpacity
                style={styles.docsToggle}
                onPress={() => setShowDocs((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.docsToggleText}>
                  {showDocs ? '▼' : '▶'} 📄 {documents.length} document{documents.length === 1 ? '' : 's'} indexed
                </Text>
              </TouchableOpacity>
              {showDocs && (
                <View style={styles.docsList}>
                  {documents.map((d) => (
                    <View key={d.id} style={styles.docRow}>
                      <Text style={styles.docName} numberOfLines={1}>
                        • {d.filename}
                      </Text>
                      <TouchableOpacity onPress={() => handleDeleteDoc(d)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.docDelete}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>💼</Text>
            <Text style={styles.emptyTitle}>Knowledge Worker</Text>
            <Text style={styles.emptySubtitle}>Research, analyze, summarize — your focused work agent.</Text>
            <View style={styles.suggestionGrid}>
              {SUGGESTIONS.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.suggestionChip}
                  onPress={() => handleSend(s)}
                  disabled={streaming}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        ListFooterComponent={
          streaming ? (
            <View style={styles.assistantRow}>
              <View style={styles.streamingCol}>
                {toolActivities.length > 0 && (
                  <View style={styles.toolListContainer}>
                    {toolActivities.map((activity, idx) => (
                      <View key={idx} style={styles.toolRow}>
                        <Text style={styles.toolLabel}>
                          {activity.done ? '✓' : '•'} {activity.tool}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {streamedContent ? (
                  <View style={styles.assistantBubble}>
                    <Markdown style={markdownStyle} rules={markdownRules}>
                      {absolutizeUrls(streamedContent)}
                    </Markdown>
                  </View>
                ) : null}
                {/*
                  Persistent thinking indicator — visible for the entire
                  streaming lifecycle (send → tools → tokens → done). The label
                  reflects the current phase so the user always knows the
                  agent is still working.
                */}
                <View style={styles.processingContainer}>
                  <ActivityIndicator size="small" color={colors.primary[500]} />
                  <Text style={styles.processingText}>{thinkingLabel}</Text>
                </View>
              </View>
            </View>
          ) : null
        }
      />

      <View style={styles.inputOuter}>
        <View style={styles.inputContainer}>
          <TouchableOpacity
            onPress={handleAttachFile}
            disabled={uploading || streaming}
            style={[styles.attachBtn, (uploading || streaming) && styles.attachBtnDisabled]}
            activeOpacity={0.75}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary[600]} />
            ) : (
              <Text style={styles.attachBtnText}>📎</Text>
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask or attach a document..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
            editable={!streaming}
          />
          <TouchableOpacity
            onPress={() => handleSend()}
            disabled={!sendEnabled}
            style={[styles.sendBtn, !sendEnabled && styles.sendBtnDisabled]}
            activeOpacity={0.85}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    // Top toolbar
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    toolbarBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 8,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.primary[500],
    },
    toolbarBtnDisabled: { opacity: 0.5 },
    toolbarBtnText: { color: '#FFFFFF', fontSize: FontSize.sm, fontWeight: '700' },
    toolbarBtnGhost: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 8,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    toolbarBtnGhostText: { color: colors.text, fontSize: FontSize.sm, fontWeight: '600' },

    // History modal
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    modalSheet: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '80%',
      backgroundColor: colors.background,
      borderRadius: BorderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.md,
    },
    modalTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text },
    modalClose: { fontSize: 20, color: colors.textSecondary, paddingHorizontal: 4 },
    modalNewBtn: {
      backgroundColor: colors.primary[500],
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.lg,
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    modalNewBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: FontSize.base },
    modalLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Spacing.sm },
    modalLoadingText: { color: colors.textSecondary, fontSize: FontSize.sm },
    modalEmpty: { paddingVertical: Spacing['2xl'], alignItems: 'center' },
    modalEmptyText: { color: colors.textMuted, fontSize: FontSize.sm },
    modalList: { maxHeight: 480 },
    convoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    convoRowActive: { backgroundColor: colors.card },
    convoTap: { flex: 1, paddingRight: Spacing.sm },
    convoTitle: { color: colors.text, fontSize: FontSize.base, fontWeight: '600' },
    convoDate: { color: colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
    convoDelete: { padding: 6 },
    convoDeleteText: { fontSize: 16 },

    // Paywall
    paywallContainer: {
      flex: 1,
      backgroundColor: colors.background,
      padding: Spacing['2xl'],
      justifyContent: 'center',
      alignItems: 'center',
    },
    paywallIcon: { fontSize: 56, marginBottom: Spacing.lg },
    paywallTitle: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.text,
      marginBottom: Spacing.sm,
      letterSpacing: -0.5,
    },
    paywallSubtitle: {
      fontSize: FontSize.base,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: Spacing['2xl'],
      maxWidth: 320,
    },
    paywallCard: {
      backgroundColor: colors.card,
      borderRadius: BorderRadius.xl,
      padding: Spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 360,
    },
    paywallHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    paywallHintStrong: { color: colors.primary[600], fontWeight: '700' },

    // Messages list
    messageList: { padding: Spacing.lg, paddingBottom: Spacing['2xl'] },

    // User bubble
    userBubbleWrap: { alignSelf: 'flex-end', maxWidth: '94%', marginBottom: Spacing.md },
    userBubble: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: 22,
      borderBottomRightRadius: 6,
      backgroundColor: colors.primary[500],
    },
    userText: { color: '#FFFFFF', fontSize: 15.5, lineHeight: 23, fontWeight: '500' },

    // Assistant
    assistantRow: {
      marginBottom: Spacing.md,
      maxWidth: '100%',
      alignSelf: 'flex-start',
    },
    assistantBubble: {
      backgroundColor: colors.card,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: 20,
      borderTopLeftRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    streamingCol: { gap: Spacing.sm },

    // Empty state
    emptyContainer: { alignItems: 'center', paddingTop: 80, paddingHorizontal: Spacing['2xl'] },
    emptyIcon: { fontSize: 48, marginBottom: Spacing.lg },
    emptyTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
    emptySubtitle: {
      fontSize: FontSize.base,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: Spacing.sm,
      lineHeight: 22,
      maxWidth: 300,
    },
    suggestionGrid: { marginTop: Spacing['2xl'], width: '100%', gap: Spacing.sm },
    suggestionChip: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      backgroundColor: colors.card,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    suggestionText: { fontSize: FontSize.sm, color: colors.text, fontWeight: '500' },

    // Tool list
    toolListContainer: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      gap: 6,
    },
    toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    toolLabel: { fontSize: FontSize.sm, color: colors.text },

    // Processing
    processingContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: Spacing.sm },
    processingText: { fontSize: FontSize.sm, color: colors.primary[600], fontStyle: 'italic' },

    // Input
    inputOuter: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      backgroundColor: colors.card,
      borderRadius: 26,
      paddingLeft: Spacing.lg,
      paddingRight: 6,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    textInput: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
      maxHeight: 120,
      paddingVertical: Spacing.sm,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primary[500],
    },
    sendBtnDisabled: { backgroundColor: colors.gray[300] },
    sendBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },

    // Attach (document upload)
    attachBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    attachBtnDisabled: { opacity: 0.5 },
    attachBtnText: { fontSize: 18 },

    // Documents panel
    docsHeader: {
      marginBottom: Spacing.md,
      backgroundColor: colors.card,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    docsToggle: { padding: Spacing.md },
    docsToggleText: { fontSize: FontSize.sm, color: colors.text, fontWeight: '600' },
    docsList: {
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.md,
      gap: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: Spacing.sm,
    },
    docRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    docName: { flex: 1, fontSize: FontSize.sm, color: colors.textSecondary },
    docDelete: { fontSize: 16, color: colors.textMuted, paddingHorizontal: 4 },
  })
