import React, { useEffect, useState, useRef, useCallback } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Pressable, Animated, Easing, Alert } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Markdown from 'react-native-markdown-display'
import { useAudioRecorder, AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import { useAuthStore } from '../store/authStore'
import { useVoiceStore } from '../store/voiceStore'
import { orchestrationApi, type StreamEvent } from '../api/orchestration'
import { transcribeAudio as apiTranscribeAudio, synthesizeSpeech as apiSynthesizeSpeech } from '../api/voice'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  createdAt: string
}

interface ToolActivity {
  tool: string
  input?: any
  done: boolean
}

// Human-readable tool labels (matches web)
function getToolLabel(tool: string, input?: any): string {
  const labels: Record<string, (i?: any) => string> = {
    weather: (i) => `Checking weather for ${i?.location || '...'}`,
    wikipedia: (i) => `Looking up ${i?.query || '...'} on Wikipedia`,
    web_search: (i) => `Searching the web for "${i?.query || '...'}"`,
    news_search: (i) => `Searching news about "${i?.query || '...'}"`,
    calculator: (i) => `Calculating ${i?.expression || '...'}`,
    url_reader: () => 'Reading a webpage',
    search_memories: () => 'Searching your memories',
    query_planner: () => 'Checking your planner',
    create_action: () => 'Creating an action item',
    create_thought: () => 'Saving a thought',
    create_checkin: () => 'Logging a check-in',
    trigger_persona_analysis: () => 'Consulting personas',
    update_user_context: () => 'Updating your context',
  }
  const labelFn = labels[tool]
  return labelFn ? labelFn(input) : `Using ${tool}`
}

// Pulsing dot (used in streaming indicators)
function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.1] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })
  return (
    <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ scale }], opacity }} />
  )
}

// Avatar for assistant messages — gradient circle with "4E"
function AssistantAvatar() {
  return (
    <LinearGradient
      colors={['#38bdf8', '#7C3AED']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={avatarStyles.avatar}
    >
      <Text style={avatarStyles.avatarText}>4E</Text>
    </LinearGradient>
  )
}

const avatarStyles = StyleSheet.create({
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#7C3AED',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
})

// Collapsible thinking block component
function ThinkingBlock({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  const { colors } = useTheme()
  const tbStyles = createStyles(colors)
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <Pressable onPress={() => setIsOpen(!isOpen)} style={tbStyles.thinkingBlock}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={tbStyles.thinkingDot} />
        <Text style={tbStyles.thinkingBlockHeader}>
          {isOpen ? '▾' : '▸'} Thinking{!isOpen ? ` · ${content.length} chars` : ''}
        </Text>
      </View>
      {isOpen && (
        <Text style={tbStyles.thinkingBlockContent}>{content}</Text>
      )}
    </Pressable>
  )
}

// Markdown styles for assistant messages
const createMdStyles = (colors: typeof Colors) => StyleSheet.create({
  body: { fontSize: FontSize.base, color: colors.text, lineHeight: 24 },
  heading1: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 12, marginBottom: 6 },
  heading2: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 10, marginBottom: 4 },
  heading3: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  paragraph: { marginTop: 0, marginBottom: 10 },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.textSecondary },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary[400], paddingLeft: 12, marginVertical: 6, backgroundColor: colors.primary[50] || '#F0F9FF' },
  code_inline: { backgroundColor: colors.gray[100], color: colors.primary[700] || '#0369a1', paddingHorizontal: 4, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  code_block: { backgroundColor: '#0F172A', color: '#F3F4F6', padding: 12, borderRadius: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginVertical: 8 },
  fence: { backgroundColor: '#0F172A', color: '#F3F4F6', padding: 12, borderRadius: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginVertical: 8 },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
  link: { color: colors.primary[600] },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, marginVertical: 8 },
  th: { padding: 8, backgroundColor: colors.gray[50], fontWeight: '600' },
  td: { padding: 8, borderTopWidth: 1, borderTopColor: colors.border },
})

const SUGGESTIONS = [
  { icon: '✨', text: "What should I focus on today?" },
  { icon: '🎯', text: "Review my goals with me" },
  { icon: '💭', text: "Help me think through something" },
]

export default function CoreChatScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const mdStyles = createMdStyles(colors)
  const token = useAuthStore((s) => s.token)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [thinkingText, setThinkingText] = useState('')
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [streamedContent, setStreamedContent] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  // Tracks whether the user is "pinned" near the bottom of the scroll.
  // When they scroll up to read, we stop auto-scrolling on new tokens.
  const pinnedToBottomRef = useRef(true)

  // ---------- Voice (talk with Core) ----------
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  // When true, the next assistant 'done' event will be spoken via TTS.
  const voiceModeRef = useRef(false)
  const ttsPlayerRef = useRef<any>(null)
  // User's preferred TTS voice (persisted in AsyncStorage via voiceStore).
  const preferredVoice = useVoiceStore((s) => s.voice)
  const loadVoicePref = useVoiceStore((s) => s.load)
  const voiceLoaded = useVoiceStore((s) => s.loaded)
  useEffect(() => {
    if (!voiceLoaded) void loadVoicePref()
  }, [voiceLoaded, loadVoicePref])

  const handleScrollEvent = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height)
    pinnedToBottomRef.current = distanceFromBottom < 80
  }, [])

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const result = await orchestrationApi.getCoreChatHistory(30)
      setMessages(result.messages.map((m) => ({ ...m, role: m.role as 'user' | 'assistant' })))
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setSessionStartedAt(result.sessionStartedAt)
    } catch {}
    setLoading(false)
  }

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !nextCursor) return
    setIsLoadingMore(true)
    try {
      const result = await orchestrationApi.getCoreChatHistory(30, nextCursor)
      const older = result.messages.map((m) => ({ ...m, role: m.role as 'user' | 'assistant' }))
      setMessages((prev) => [...older, ...prev])
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
    } catch {}
    setIsLoadingMore(false)
  }, [hasMore, isLoadingMore, nextCursor])

  const scrollToBottom = (force = false) => {
    // Only auto-scroll when the user is at/near the bottom, unless forced
    // (e.g., when they just sent a message).
    if (!force && !pinnedToBottomRef.current) return
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleSend = useCallback(async (overrideText?: string) => {
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
    setThinkingText('')
    setToolActivities([])
    // User just sent a message — force-pin to bottom for this response
    pinnedToBottomRef.current = true
    scrollToBottom(true)

    let fullResponse = ''
    let thinkingAccum = ''

    try {
      await orchestrationApi.coreChatStream(text, (event: StreamEvent) => {
        switch (event.event) {
          case 'thinking':
            setThinkingText(event.data.text || event.data.status || 'Thinking...')
            break
          case 'thinking_delta':
            thinkingAccum += event.data.chunk || ''
            setThinkingText(thinkingAccum)
            break
          case 'tool_start':
            setToolActivities((prev) => [
              ...prev,
              { tool: event.data.tool, input: event.data.input, done: false },
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
            const assistantMsg: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: fullResponse,
              thinking: thinkingAccum || undefined,
              createdAt: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, assistantMsg])
            setStreamedContent('')
            setThinkingText('')
            setToolActivities([])
            setStreaming(false)
            scrollToBottom()
            // If this turn was voice-initiated, speak the reply back.
            if (voiceModeRef.current && fullResponse.trim()) {
              voiceModeRef.current = false
              void speakText(fullResponse)
            } else {
              voiceModeRef.current = false
            }
            break
        }
      }, token)
    } catch (err) {
      setStreaming(false)
      setStreamedContent('')
      setToolActivities([])
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMsg])
    }
  }, [input, streaming, token])

  const clearHistory = async () => {
    try {
      await orchestrationApi.clearCoreChatHistory()
      setMessages([])
      setSessionStartedAt(null)
      setHasMore(false)
      setNextCursor(null)
    } catch {}
  }

  // ---------- Voice handlers ----------

  const startRecording = useCallback(async () => {
    if (streaming || isRecording || isTranscribing || isSpeaking) return
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Please allow microphone access to talk with Core.')
        return
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })
      await audioRecorder.prepareToRecordAsync()
      audioRecorder.record()
      setIsRecording(true)
    } catch (err: any) {
      setIsRecording(false)
      Alert.alert('Recording failed', err?.message || 'Could not start recording.')
    }
  }, [streaming, isRecording, isTranscribing, isSpeaking, audioRecorder])

  const stopRecording = useCallback(async () => {
    if (!isRecording) return
    setIsRecording(false)
    setIsTranscribing(true)
    try {
      await audioRecorder.stop()
      const uri = audioRecorder.uri
      if (!uri) throw new Error('No recording produced')
      const { text } = await apiTranscribeAudio(uri, 'audio/m4a')
      setIsTranscribing(false)
      const clean = (text || '').trim()
      if (!clean) {
        Alert.alert('No speech detected', 'I could not hear anything. Please try again.')
        return
      }
      // Mark this turn as voice so the reply is spoken back.
      voiceModeRef.current = true
      await handleSend(clean)
    } catch (err: any) {
      setIsTranscribing(false)
      voiceModeRef.current = false
      Alert.alert('Voice failed', err?.message || 'Could not transcribe audio.')
    }
  }, [isRecording, audioRecorder, handleSend])

  const speakText = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true)
      // Flip audio session back to playback mode so TTS plays through the main
      // speaker at full volume (after recording, iOS keeps it in record mode).
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        })
      } catch {}
      const { base64 } = await apiSynthesizeSpeech(text, token, preferredVoice)
      const fileUri = `${FileSystem.cacheDirectory}core-tts-${Date.now()}.mp3`
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      })
      // Release any previous player before creating a new one.
      try { ttsPlayerRef.current?.remove?.() } catch {}
      const player = createAudioPlayer({ uri: fileUri })
      ttsPlayerRef.current = player
      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) {
          setIsSpeaking(false)
          try { sub?.remove?.() } catch {}
          try { player.remove?.() } catch {}
          if (ttsPlayerRef.current === player) ttsPlayerRef.current = null
        }
      })
      player.play()
    } catch (err) {
      setIsSpeaking(false)
    }
  }, [token, preferredVoice])

  const handleMicPress = useCallback(() => {
    if (isRecording) {
      void stopRecording()
    } else {
      void startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // Clean up TTS player on unmount.
  useEffect(() => {
    return () => {
      try { ttsPlayerRef.current?.remove?.() } catch {}
      ttsPlayerRef.current = null
    }
  }, [])

  const startNewSession = async () => {
    if (isStartingSession) return
    setIsStartingSession(true)
    try {
      const result = await orchestrationApi.newCoreChatSession()
      setSessionStartedAt(result.sessionStartedAt)
    } catch {}
    setIsStartingSession(false)
  }

  const isSessionBoundary = (index: number) => {
    if (!sessionStartedAt || index === 0) return false
    const msg = messages[index]
    const prevMsg = messages[index - 1]
    if (!msg?.createdAt || !prevMsg?.createdAt) return false
    const sessionTime = new Date(sessionStartedAt).getTime()
    return new Date(prevMsg.createdAt).getTime() < sessionTime && new Date(msg.createdAt).getTime() >= sessionTime
  }

  const showTrailingSessionDivider = sessionStartedAt && messages.length > 0 &&
    messages.every(m => !m.createdAt || new Date(m.createdAt).getTime() < new Date(sessionStartedAt).getTime())

  const splitPersonaSections = (content: string) => {
    const regex = /## (.+?)'s Analysis of "(.+?)"\n/g
    const parts: Array<{ type: 'text' | 'persona'; personaName?: string; thoughtTitle?: string; body: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index).trim()
        if (text) parts.push({ type: 'text', body: text })
      }
      const blockStart = match.index + match[0].length
      const nextHeader = content.indexOf('\n## ', blockStart)
      const blockEnd = nextHeader !== -1 ? nextHeader : content.length
      const body = content.slice(blockStart, blockEnd).replace(/---\n_This analysis has been saved.*$/s, '').trim()
      parts.push({ type: 'persona', personaName: match[1], thoughtTitle: match[2], body })
      lastIndex = blockEnd
    }
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex).trim()
      if (text) parts.push({ type: 'text', body: text })
    }
    return parts.length > 0 ? parts : [{ type: 'text' as const, body: content }]
  }

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const sections = item.role === 'assistant' ? splitPersonaSections(item.content) : []
    const hasPersona = sections.some(s => s.type === 'persona')

    return (
      <>
        {isSessionBoundary(index) && (
          <View style={styles.sessionDivider}>
            <View style={styles.sessionDividerPill}>
              <Text style={styles.sessionDividerSparkle}>✦</Text>
              <Text style={styles.sessionDividerText}>New Session</Text>
            </View>
          </View>
        )}

        {item.role === 'user' ? (
          <View style={styles.userBubbleWrap}>
            <LinearGradient
              colors={[colors.primary[400], colors.primary[600]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.userBubble}
            >
              <Text style={styles.userText}>{item.content}</Text>
            </LinearGradient>
          </View>
        ) : (
          <View style={styles.assistantRow}>
            <AssistantAvatar />
            <View style={styles.assistantBubble}>
              {item.thinking ? <ThinkingBlock content={item.thinking} /> : null}
              {hasPersona ? (
                <View>
                  {sections.map((section, si) =>
                    section.type === 'persona' ? (
                      <View key={si} style={styles.personaCard}>
                        <View style={styles.personaCardHeader}>
                          <View style={styles.personaDot} />
                          <Text style={styles.personaName}>{section.personaName}</Text>
                          <Text style={styles.personaOn}> on </Text>
                          <Text style={styles.personaThought}>"{section.thoughtTitle}"</Text>
                        </View>
                        <Markdown style={mdStyles}>{section.body}</Markdown>
                      </View>
                    ) : (
                      <Markdown key={si} style={mdStyles}>{section.body}</Markdown>
                    )
                  )}
                </View>
              ) : (
                <Markdown style={mdStyles}>{item.content}</Markdown>
              )}
            </View>
          </View>
        )}
      </>
    )
  }

  const sendEnabled = !!input.trim() && !streaming

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header with gradient accent */}
      <LinearGradient
        colors={[colors.card, colors.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          <View style={styles.headerTitleRow}>
            <LinearGradient colors={[colors.primary[400], '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerGlow} />
            <Text style={styles.headerTitle}>Core</Text>
          </View>
          <Text style={styles.headerSubtitle}>Your intelligence layer</Text>
        </View>
        {messages.length > 0 && (
          <View style={styles.headerButtons}>
            <TouchableOpacity onPress={startNewSession} style={[styles.newSessionBtn, isStartingSession && styles.newSessionBtnDisabled]} disabled={isStartingSession}>
              {isStartingSession ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ActivityIndicator size="small" color={colors.primary[600]} />
                  <Text style={styles.newSessionBtnText}>Starting</Text>
                </View>
              ) : (
                <Text style={styles.newSessionBtnText}>+ New</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={clearHistory} style={styles.clearBtnWrap}>
              <Text style={styles.clearBtn}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}
      </LinearGradient>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => scrollToBottom()}
          onScroll={handleScrollEvent}
          scrollEventThrottle={64}
          onEndReachedThreshold={0.1}
          ListHeaderComponent={
            isLoadingMore ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" color={colors.primary[500]} />
                <Text style={styles.loadMoreText}>Loading older messages...</Text>
              </View>
            ) : hasMore ? (
              <TouchableOpacity onPress={loadMore} style={styles.loadMoreContainer}>
                <Text style={styles.loadMoreBtn}>Load older messages</Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <LinearGradient
                colors={[colors.primary[400], '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.emptyIconCircle}
              >
                <Text style={styles.emptyIcon}>🧠</Text>
              </LinearGradient>
              <Text style={styles.emptyTitle}>Your AI Life OS</Text>
              <Text style={styles.emptySubtitle}>I know your goals, people, moods, and history. Ask me anything.</Text>
              <View style={styles.suggestionGrid}>
                {SUGGESTIONS.map((s, i) => (
                  <TouchableOpacity key={i} style={styles.suggestionChip} onPress={() => handleSend(s.text)} disabled={streaming}>
                    <Text style={styles.suggestionIcon}>{s.icon}</Text>
                    <Text style={styles.suggestionText}>{s.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          ListFooterComponent={
            <>
              {showTrailingSessionDivider && !streaming && (
                <View style={styles.sessionDivider}>
                  <View style={styles.sessionDividerPill}>
                    <Text style={styles.sessionDividerSparkle}>✦</Text>
                    <Text style={styles.sessionDividerText}>New Session · AI starts fresh</Text>
                  </View>
                </View>
              )}
              {streaming ? (
                <View style={styles.assistantRow}>
                  <AssistantAvatar />
                  <View style={styles.streamingCol}>
                    {thinkingText ? (
                      <ThinkingBlock content={thinkingText} defaultOpen={true} />
                    ) : null}

                    {toolActivities.length > 0 && (
                      <View style={styles.toolListContainer}>
                        {toolActivities.map((activity, idx) => (
                          <View key={idx} style={styles.toolRow}>
                            {activity.done ? (
                              <View style={styles.toolDotDone} />
                            ) : (
                              <PulsingDot color={colors.primary[500]} size={8} />
                            )}
                            <Text style={[styles.toolLabel, activity.done && styles.toolLabelDone]}>
                              {getToolLabel(activity.tool, activity.input)}
                            </Text>
                          </View>
                        ))}
                        {toolActivities.length > 0 && toolActivities.every((t) => t.done) && (
                          <View style={styles.toolRow}>
                            <PulsingDot color={colors.primary[500]} size={8} />
                            <Text style={styles.composingText}>Composing response...</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {streamedContent ? (
                      <View style={styles.assistantBubble}>
                        <Markdown style={mdStyles}>{streamedContent}</Markdown>
                      </View>
                    ) : !thinkingText && toolActivities.length === 0 ? (
                      <View style={styles.processingContainer}>
                        <PulsingDot color={colors.primary[500]} size={8} />
                        <Text style={styles.processingText}>Processing...</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </>
          }
        />
      )}

      {/* Floating pill input */}
      <View style={styles.inputOuter}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask your Core anything..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!streaming && !isRecording && !isTranscribing}
          />
          {/* Mic button — hidden when user has typed text (Send takes over) */}
          {!input.trim() && (
            <TouchableOpacity
              onPress={handleMicPress}
              disabled={streaming || isTranscribing || isSpeaking}
              activeOpacity={0.85}
              style={{ marginRight: 6 }}
            >
              {isRecording ? (
                <View style={[styles.sendBtn, styles.micBtnRecording]}>
                  <Text style={styles.sendBtnText}>■</Text>
                </View>
              ) : isTranscribing ? (
                <View style={[styles.sendBtn, styles.sendBtnDisabled]}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                </View>
              ) : isSpeaking ? (
                <View style={[styles.sendBtn, styles.micBtnSpeaking]}>
                  <Text style={styles.sendBtnText}>♪</Text>
                </View>
              ) : (
                <LinearGradient
                  colors={[colors.primary[400], colors.primary[700]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sendBtn}
                >
                  <Text style={styles.sendBtnText}>🎤</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => handleSend()}
            disabled={!sendEnabled}
            activeOpacity={0.85}
          >
            {sendEnabled ? (
              <LinearGradient
                colors={[colors.primary[400], colors.primary[700]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendBtn}
              >
                <Text style={styles.sendBtnText}>↑</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.sendBtn, styles.sendBtnDisabled]}>
                <Text style={styles.sendBtnText}>↑</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md + 44,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerGlow: { width: 8, height: 22, borderRadius: 4 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2, marginLeft: 18, letterSpacing: 0.3 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  newSessionBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: colors.primary[50] || '#F0F9FF',
    borderWidth: 1,
    borderColor: colors.primary[200] || '#BAE6FD',
  },
  newSessionBtnText: { fontSize: FontSize.xs, color: colors.primary[700] || '#0369A1', fontWeight: '700' },
  newSessionBtnDisabled: { opacity: 0.5 },
  clearBtnWrap: { paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  clearBtn: { fontSize: FontSize.xs, color: colors.red[500], fontWeight: '600' },

  // Loading / list
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: Spacing.lg, paddingBottom: Spacing['2xl'] },

  // User bubble
  userBubbleWrap: { alignSelf: 'flex-end', maxWidth: '94%', marginBottom: Spacing.md },
  userBubble: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 22,
    borderBottomRightRadius: 6,
    shadowColor: colors.primary[500],
    shadowOpacity: isDark ? 0.55 : 0.25,
    shadowRadius: isDark ? 16 : 12,
    shadowOffset: { width: 0, height: isDark ? 0 : 4 },
    elevation: isDark ? 6 : 4,
    ...(isDark ? { borderWidth: 1.5, borderColor: colors.primary[300] } : null),
  },
  userText: { color: '#FFFFFF', fontSize: 15.5, lineHeight: 23, fontWeight: '500' },

  // Assistant
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: Spacing.md,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  assistantBubble: {
    flexShrink: 1,
    backgroundColor: colors.card,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 20,
    borderTopLeftRadius: 6,
    shadowColor: isDark ? colors.primary[400] : '#000',
    shadowOpacity: isDark ? 0.45 : 0.06,
    shadowRadius: isDark ? 16 : 14,
    shadowOffset: { width: 0, height: isDark ? 0 : 3 },
    elevation: isDark ? 6 : 2,
    borderWidth: isDark ? 1.5 : 1,
    borderColor: isDark ? colors.primary[400] : colors.border,
  },
  streamingCol: { flex: 1, flexShrink: 1, gap: Spacing.sm },

  // Empty state
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80, paddingHorizontal: Spacing['2xl'] },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    shadowColor: '#7C3AED',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  emptySubtitle: { fontSize: FontSize.base, color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22, maxWidth: 300 },
  suggestionGrid: { marginTop: Spacing['2xl'], width: '100%', gap: Spacing.sm },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    ...neonSoft(colors, isDark),
    ...(isDark ? { borderWidth: 1, borderColor: '#38BDF8', shadowColor: '#38BDF8', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null),
  },
  suggestionIcon: { fontSize: 18 },
  suggestionText: { fontSize: FontSize.sm, color: colors.text, fontWeight: '500', flex: 1 },

  // Thinking block
  thinkingBlock: {
    backgroundColor: isDark ? 'rgba(167,139,250,0.14)' : '#F5F3FF',
    borderLeftWidth: 3,
    borderLeftColor: isDark ? '#C4B5FD' : '#A78BFA',
    borderRadius: 10,
    padding: Spacing.sm + 2,
    marginBottom: Spacing.sm,
    ...(isDark
      ? {
          borderTopWidth: 1,
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderTopColor: 'rgba(196,181,253,0.55)',
          borderRightColor: 'rgba(196,181,253,0.55)',
          borderBottomColor: 'rgba(196,181,253,0.55)',
          shadowColor: '#A78BFA',
          shadowOpacity: 0.45,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        }
      : null),
  },
  thinkingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? '#C4B5FD' : '#A78BFA' },
  thinkingBlockHeader: { fontSize: FontSize.xs, fontWeight: '700', color: isDark ? '#DDD6FE' : '#7C3AED', letterSpacing: 0.3 },
  thinkingBlockContent: { fontSize: FontSize.xs, color: isDark ? '#E9D5FF' : '#6D28D9', lineHeight: 18, marginTop: 6, opacity: 0.9 },

  // Tool list
  toolListContainer: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    ...neonSoft(colors, isDark),
    ...(isDark ? { borderWidth: 1, borderColor: '#38BDF8', shadowColor: '#38BDF8', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null),
  },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolDotDone: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green[500] },
  toolLabel: { fontSize: FontSize.sm, color: colors.text, flex: 1 },
  toolLabelDone: { color: colors.textMuted, textDecorationLine: 'line-through' as any },
  composingText: { fontSize: FontSize.sm, color: colors.primary[600], fontStyle: 'italic' },

  // Processing
  processingContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: Spacing.sm },
  processingText: { fontSize: FontSize.sm, color: colors.primary[600], fontStyle: 'italic' },

  // Input (floating pill)
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
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    ...neonSoft(colors, isDark),
    ...(isDark ? { borderWidth: 1, borderColor: '#38BDF8', shadowColor: '#38BDF8', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null),
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
    shadowColor: colors.primary[500],
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sendBtnDisabled: { backgroundColor: colors.gray[300], shadowOpacity: 0 },
  sendBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  micBtnRecording: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOpacity: 0.45,
  },
  micBtnSpeaking: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.45,
  },

  // Session divider (pill style)
  sessionDivider: { alignItems: 'center', marginVertical: Spacing.lg },
  sessionDividerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: isDark ? 'rgba(245,158,11,0.16)' : '#FEF3C7',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: isDark ? '#F59E0B' : '#FDE68A',
    ...(isDark
      ? {
          shadowColor: '#F59E0B',
          shadowOpacity: 0.45,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        }
      : null),
  },
  sessionDividerSparkle: { fontSize: 12, color: isDark ? '#FBBF24' : '#D97706' },
  sessionDividerText: { fontSize: FontSize.xs, fontWeight: '700', color: isDark ? '#FCD34D' : '#B45309', letterSpacing: 0.3 },

  // Persona cards — theme-aware so dark mode stays readable + neon glow
  personaCard: {
    borderLeftWidth: 3,
    borderLeftColor: isDark ? '#C4B5FD' : '#A78BFA',
    backgroundColor: isDark ? 'rgba(167,139,250,0.14)' : '#F5F3FF',
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.sm,
    borderTopWidth: isDark ? 1 : 0,
    borderRightWidth: isDark ? 1 : 0,
    borderBottomWidth: isDark ? 1 : 0,
    borderTopColor: isDark ? 'rgba(196,181,253,0.55)' : 'transparent',
    borderRightColor: isDark ? 'rgba(196,181,253,0.55)' : 'transparent',
    borderBottomColor: isDark ? 'rgba(196,181,253,0.55)' : 'transparent',
    shadowColor: isDark ? '#A78BFA' : 'transparent',
    shadowOpacity: isDark ? 0.55 : 0,
    shadowRadius: isDark ? 14 : 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: isDark ? 6 : 0,
  },
  personaCardHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4, gap: 4 },
  personaDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? '#C4B5FD' : '#7C3AED' },
  personaName: { fontSize: FontSize.xs, fontWeight: '800', color: isDark ? '#DDD6FE' : '#7C3AED', letterSpacing: 0.3 },
  personaOn: { fontSize: FontSize.xs, color: isDark ? '#C4B5FD' : '#A78BFA' },
  personaThought: { fontSize: FontSize.xs, fontWeight: '600', color: isDark ? '#DDD6FE' : '#7C3AED', fontStyle: 'italic' },

  // Load more
  loadMoreContainer: { alignItems: 'center', paddingVertical: Spacing.md, flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  loadMoreText: { fontSize: FontSize.xs, color: colors.textMuted },
  loadMoreBtn: { fontSize: FontSize.sm, color: colors.primary[600], fontWeight: '700' },
})
