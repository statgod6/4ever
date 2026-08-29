import React, { useEffect, useState, useRef, useCallback } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useAuthStore } from '../store/authStore'
import { orchestrationApi, type StreamEvent } from '../api/orchestration'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'PersonaChat'>

interface ChatMsg { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }

const createMdStyles = (colors: typeof Colors) => StyleSheet.create({
  body: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  heading1: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 12, marginBottom: 6 },
  heading2: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 10, marginBottom: 4 },
  heading3: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.textSecondary },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 2 },
  code_inline: { backgroundColor: colors.gray[100], paddingHorizontal: 4, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  fence: { backgroundColor: '#1F2937', color: '#F3F4F6', padding: 12, borderRadius: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginVertical: 8 },
  link: { color: colors.primary[600] },
})

export default function PersonaChatScreen({ route }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const mdStyles = createMdStyles(colors)
  const { personaId, personaName } = route.params as { personaId: string; personaName: string }
  const token = useAuthStore((s) => s.token)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const flatListRef = useRef<FlatList>(null)

  useEffect(() => {
    orchestrationApi.getPersonaChatHistory(personaId).then((h) =>
      setMessages(h.map((m) => ({ ...m, role: m.role as 'user' | 'assistant' })))
    ).catch(() => {})
  }, [personaId])

  const scrollToBottom = () => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() }])
    setInput(''); setStreaming(true); setStreamedContent(''); scrollToBottom()

    let full = ''
    try {
      await orchestrationApi.personaDirectChatStream(personaId, text, (event: StreamEvent) => {
        if (event.event === 'token') { full += event.data.text || event.data.chunk || ''; setStreamedContent(full); scrollToBottom() }
        else if (event.event === 'response') { full = event.data.text || event.data.content || full; setStreamedContent(full) }
        else if (event.event === 'done') {
          setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: full, createdAt: new Date().toISOString() }])
          setStreamedContent(''); setStreaming(false); scrollToBottom()
        }
      }, token)
    } catch { setStreaming(false); setStreamedContent('') }
  }, [input, streaming, personaId, token])

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={flatListRef} data={messages} keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list} onContentSizeChange={scrollToBottom}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
            {item.role === 'user' ? (
              <Text style={[styles.bubbleText, { color: '#ffffff' }]}>{item.content}</Text>
            ) : (
              <Markdown style={mdStyles}>{item.content}</Markdown>
            )}
          </View>
        )}
        ListHeaderComponent={<Text style={styles.headerLabel}>Chat with {personaName}</Text>}
        ListFooterComponent={streaming && streamedContent ? (
          <View style={[styles.bubble, styles.aiBubble]}><Markdown style={mdStyles}>{streamedContent}</Markdown></View>
        ) : streaming ? <ActivityIndicator style={{ padding: Spacing.md }} color={colors.primary[500]} /> : null}
      />
      <View style={styles.inputRow}>
        <TextInput style={styles.textInput} value={input} onChangeText={setInput} placeholder={`Ask ${personaName}...`} placeholderTextColor={colors.textMuted} multiline editable={!streaming} />
        <TouchableOpacity style={[styles.sendBtn, (!input.trim() || streaming) && { backgroundColor: colors.gray[300] }]} onPress={handleSend} disabled={!input.trim() || streaming}>
          <Text style={styles.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: Spacing.lg },
  headerLabel: { fontSize: FontSize.sm, color: colors.textMuted, textAlign: 'center', marginBottom: Spacing.lg },
  bubble: { maxWidth: '85%', padding: Spacing.md, borderRadius: BorderRadius.lg, marginBottom: Spacing.sm },
  userBubble: { backgroundColor: colors.primary[500], alignSelf: 'flex-end', borderBottomRightRadius: 4, ...(isDark ? { shadowColor: colors.primary[400], shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 5, borderWidth: 1.5, borderColor: colors.primary[300] } : null) },
  aiBubble: { backgroundColor: colors.card, alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark, 'violet') },
  bubbleText: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: Spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, gap: Spacing.sm },
  textInput: { flex: 1, backgroundColor: colors.gray[50], borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, fontSize: FontSize.base, color: colors.text, maxHeight: 100, borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark) },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[500], justifyContent: 'center', alignItems: 'center' },
  sendText: { color: '#ffffff', fontSize: FontSize.lg, fontWeight: '700' },
})
