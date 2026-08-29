import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { thoughtsApi, type Thought, type PersonaRun } from '../api/thoughts'
import { personasApi, type Persona } from '../api/personas'
import { orchestrationApi, type StreamEvent } from '../api/orchestration'
import { useAuthStore } from '../store/authStore'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import PersonaPickerSheet from '../components/PersonaPickerSheet'

type Props = NativeStackScreenProps<any, 'ThoughtDetail'>

const thoughtTypeLabels: Record<string, string> = {
  'business idea': 'Business Idea',
  'personal decision': 'Personal Decision',
  'career concern': 'Career Concern',
  'emotional situation': 'Emotional',
  'relationship issue': 'Relationship',
  'research thought': 'Research',
  'content idea': 'Content Idea',
  'ethical dilemma': 'Ethical Dilemma',
  'startup plan': 'Startup Plan',
  'life choice': 'Life Choice',
  'general reflection': 'Reflection',
  idea: 'Idea', decision: 'Decision', problem: 'Problem',
  reflection: 'Reflection', goal: 'Goal', journal: 'Journal',
}

const typeColorMap: Record<string, { bg: string; text: string }> = {
  'business idea': { bg: '#DBEAFE', text: '#1D4ED8' },
  'personal decision': { bg: '#D1FAE5', text: '#059669' },
  'career concern': { bg: '#EDE9FE', text: '#7C3AED' },
  'emotional situation': { bg: '#FCE7F3', text: '#DB2777' },
  'relationship issue': { bg: '#FFE4E6', text: '#E11D48' },
  'research thought': { bg: '#E0E7FF', text: '#4338CA' },
  'content idea': { bg: '#FEF3C7', text: '#D97706' },
  'ethical dilemma': { bg: '#FFEDD5', text: '#EA580C' },
  'startup plan': { bg: '#CFFAFE', text: '#0891B2' },
  'life choice': { bg: '#CCFBF1', text: '#0D9488' },
  'general reflection': { bg: '#F3F4F6', text: '#4B5563' },
  idea: { bg: '#DBEAFE', text: '#1D4ED8' },
  decision: { bg: '#D1FAE5', text: '#059669' },
  problem: { bg: '#FFE4E6', text: '#E11D48' },
  reflection: { bg: '#F3F4F6', text: '#4B5563' },
  goal: { bg: '#CFFAFE', text: '#0891B2' },
  journal: { bg: '#FEF3C7', text: '#D97706' },
}

export default function ThoughtDetailScreen({ route, navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const mdStyles = createMdStyles(colors)
  const mdStylesUser = createMdStylesUser(colors)
  const thoughtId: string = route.params?.thoughtId
  const token = useAuthStore((s) => s.token)

  const [thought, setThought] = useState<Thought | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Personas & analysis
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // Continue thread
  const [continueText, setContinueText] = useState('')
  const [isContinuing, setIsContinuing] = useState(false)

  // Per-persona reply
  const [replyingTo, setReplyingTo] = useState<{ personaId: string; name: string } | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [streamingReply, setStreamingReply] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')

  const loadThought = useCallback(async () => {
    try {
      const data = await thoughtsApi.getById(thoughtId)
      setThought(data)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load thought')
    } finally {
      setLoading(false)
    }
  }, [thoughtId])

  const loadPersonas = useCallback(async () => {
    try {
      const data = await personasApi.getActive()
      setPersonas(data)
    } catch {}
  }, [])

  useEffect(() => {
    loadThought()
    loadPersonas()
  }, [loadThought, loadPersonas])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadThought()
    setRefreshing(false)
  }

  // --- Analyze ---
  const togglePersona = (id: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const handleAnalyze = async () => {
    if (selectedPersonas.length === 0) return
    setIsAnalyzing(true)
    try {
      await orchestrationApi.analyzeThought(thoughtId, selectedPersonas)
      await loadThought()
      setSelectedPersonas([])
      showToast(`${selectedPersonas.length} persona(s) analyzed`, 'success')
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Analysis failed', 'error')
    }
    setIsAnalyzing(false)
  }

  // --- Continue thread ---
  const handleContinue = async () => {
    if (!continueText.trim()) return
    setIsContinuing(true)
    try {
      const threadId = thought?.threads?.[0]?.id
      if (threadId) {
        await thoughtsApi.continueThread(threadId, continueText.trim())
        setContinueText('')
        // Re-run previously used personas
        const prevPersonaIds = [...new Set((thought?.threads?.[0]?.runs || []).map((r) => r.personaId))]
        if (prevPersonaIds.length > 0) {
          setIsAnalyzing(true)
          await orchestrationApi.analyzeThought(thoughtId, prevPersonaIds)
          setIsAnalyzing(false)
        }
        await loadThought()
        showToast('Follow-up sent', 'success')
      }
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to continue', 'error')
    }
    setIsContinuing(false)
  }

  // --- Reply to persona (streaming) ---
  const handleReply = async () => {
    if (!replyText.trim() || !replyingTo) return
    setIsReplying(true)
    setStreamingReply('')
    setStreamingThinking('')
    let accum = ''
    let thinkAccum = ''
    try {
      await orchestrationApi.replyToPersonaStream(
        thoughtId, replyingTo.personaId, replyText.trim(),
        (event: StreamEvent) => {
          if (event.event === 'thinking_delta') {
            thinkAccum += event.data.chunk || event.data.text || ''
            setStreamingThinking(thinkAccum)
          } else if (event.event === 'token') {
            accum += event.data.text || event.data.chunk || ''
            setStreamingReply(accum)
          } else if (event.event === 'response') {
            setStreamingReply(event.data.text || accum)
          }
        },
        token,
      )
      setReplyText('')
      setReplyingTo(null)
      setStreamingReply('')
      setStreamingThinking('')
      await loadThought()
      showToast('Reply received', 'success')
    } catch (err: any) {
      showToast('Reply failed', 'error')
    }
    setIsReplying(false)
  }

  // --- Status change ---
  const handleStatusChange = async (newStatus: string) => {
    try {
      await thoughtsApi.update(thoughtId, { status: newStatus })
      await loadThought()
      showToast(`Marked as ${newStatus}`, 'success')
    } catch {
      showToast('Failed to update status', 'error')
    }
  }

  // --- Format date ---
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  // --- Render ---
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    )
  }

  if (error || !thought) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Thought not found'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadThought}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const thread = thought.threads?.[0]
  const runs: PersonaRun[] = thread?.runs || []
  const messages = thread?.messages || []
  const tc = typeColorMap[thought.thoughtType] || { bg: colors.gray[100], text: colors.gray[600] }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
      >
        {/* Header card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.typeBadge, { backgroundColor: tc.bg }]}>
              <Text style={[styles.typeBadgeText, { color: tc.text }]}>
                {thoughtTypeLabels[thought.thoughtType] || thought.thoughtType}
              </Text>
            </View>
            <View style={[styles.statusBadge,
              thought.status === 'open' ? styles.statusOpen :
              thought.status === 'resolved' ? styles.statusResolved : styles.statusArchived
            ]}>
              <Text style={[styles.statusText,
                thought.status === 'open' ? styles.statusOpenText :
                thought.status === 'resolved' ? styles.statusResolvedText : styles.statusArchivedText
              ]}>
                {thought.status.charAt(0).toUpperCase() + thought.status.slice(1)}
              </Text>
            </View>
          </View>

          <Text style={styles.title}>{thought.title}</Text>
          <Text style={styles.rawText}>{thought.rawText}</Text>
          <Text style={styles.dateText}>Created {fmt(thought.createdAt)}</Text>

          {/* Status buttons */}
          <View style={styles.statusActions}>
            {thought.status === 'open' && (
              <>
                <TouchableOpacity style={styles.statusBtn} onPress={() => handleStatusChange('resolved')}>
                  <Text style={styles.statusBtnText}>✓ Resolve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.statusBtn, styles.statusBtnMuted]} onPress={() => handleStatusChange('archived')}>
                  <Text style={styles.statusBtnMutedText}>Archive</Text>
                </TouchableOpacity>
              </>
            )}
            {thought.status === 'resolved' && (
              <>
                <TouchableOpacity style={[styles.statusBtn, styles.statusBtnMuted]} onPress={() => handleStatusChange('archived')}>
                  <Text style={styles.statusBtnMutedText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.statusBtn} onPress={() => handleStatusChange('open')}>
                  <Text style={styles.statusBtnText}>↻ Reopen</Text>
                </TouchableOpacity>
              </>
            )}
            {thought.status === 'archived' && (
              <TouchableOpacity style={styles.statusBtn} onPress={() => handleStatusChange('open')}>
                <Text style={styles.statusBtnText}>↻ Reopen</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Persona Analysis Runs */}
        {runs.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Persona Analysis</Text>
            {runs.map((run) => (
              <View key={run.id} style={styles.runCard}>
                <View style={styles.runHeader}>
                  <Text style={styles.runPersonaName}>{run.persona?.name || 'Unknown'}</Text>
                  <Text style={styles.runDate}>{fmt(run.createdAt)}</Text>
                </View>
                <View style={styles.mdWrap}>
                  <Markdown style={mdStyles}>{run.outputText}</Markdown>
                </View>
                <TouchableOpacity
                  style={styles.replyLink}
                  onPress={() => {
                    setReplyingTo({ personaId: run.personaId, name: run.persona?.name || 'Persona' })
                    setReplyText('')
                  }}
                >
                  <Text style={styles.replyLinkText}>↩ Reply to {run.persona?.name}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Streaming reply preview */}
        {isReplying && (streamingThinking || streamingReply) && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {replyingTo?.name} is responding...
            </Text>
            {streamingThinking ? (
              <View style={styles.thinkingBlock}>
                <Text style={styles.thinkingLabel}>🧠 Thinking...</Text>
                <Text style={styles.thinkingText} numberOfLines={6}>{streamingThinking}</Text>
              </View>
            ) : null}
            {streamingReply ? (
              <View style={styles.mdWrap}>
                <Markdown style={mdStyles}>{streamingReply}</Markdown>
              </View>
            ) : null}
          </View>
        )}

        {/* Reply input */}
        {replyingTo && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reply to {replyingTo.name}</Text>
            <TextInput
              style={styles.input}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Your follow-up..."
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={styles.replyActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setReplyingTo(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, isReplying && styles.sendBtnDisabled]}
                onPress={handleReply}
                disabled={isReplying}
              >
                <Text style={styles.sendBtnText}>{isReplying ? 'Sending...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Thread follow-ups — only show the user's follow-up questions here.
            Persona responses are already rendered in the "Persona Analysis" section above,
            so rendering the assistant thread messages again would duplicate each Q&A pair. */}
        {(() => {
          const followUpUserMsgs = messages.filter((m, i) => i > 0 && m.role === 'user')
          if (followUpUserMsgs.length === 0) return null
          return (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Your Follow-ups</Text>
              {followUpUserMsgs.map((msg) => (
                <View key={msg.id} style={[styles.msgBubble, styles.msgUser]}>
                  <Text style={styles.msgSender}>You</Text>
                  <View style={styles.mdWrap}>
                    <Markdown style={mdStylesUser}>{msg.content}</Markdown>
                  </View>
                  <Text style={styles.msgDate}>{fmt(msg.createdAt)}</Text>
                </View>
              ))}
            </View>
          )
        })()}

        {/* Continue thread */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Continue Thread</Text>
          <TextInput
            style={styles.input}
            value={continueText}
            onChangeText={setContinueText}
            placeholder="Add a follow-up thought..."
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, { marginTop: Spacing.sm }, (isContinuing || isAnalyzing) && styles.sendBtnDisabled]}
            onPress={handleContinue}
            disabled={isContinuing || isAnalyzing}
          >
            <Text style={styles.sendBtnText}>
              {isContinuing ? 'Sending...' : isAnalyzing ? 'Analyzing...' : 'Send Follow-up'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Analyze with personas */}
        <View style={styles.card}>
          <PersonaPickerSheet
            personas={personas}
            selectedIds={selectedPersonas}
            onToggle={togglePersona}
            label="Analyze with Personas"
          />
          <TouchableOpacity
            style={[styles.sendBtn, { marginTop: Spacing.md }, (isAnalyzing || selectedPersonas.length === 0) && styles.sendBtnDisabled]}
                onPress={handleAnalyze}
                disabled={isAnalyzing || selectedPersonas.length === 0}
              >
                <Text style={styles.sendBtnText}>
                  {isAnalyzing ? 'Analyzing...' : `Analyze (${selectedPersonas.length})`}
                </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createMdStyles = (colors: typeof Colors) => StyleSheet.create({
  body: { color: colors.text, fontSize: FontSize.sm, lineHeight: 22 },
  heading1: { fontSize: FontSize.lg, fontWeight: '700' as any, color: colors.text, marginBottom: 8 },
  heading2: { fontSize: FontSize.base, fontWeight: '700' as any, color: colors.text, marginBottom: 6 },
  heading3: { fontSize: FontSize.sm, fontWeight: '700' as any, color: colors.text, marginBottom: 4 },
  paragraph: { marginBottom: 8 },
  strong: { fontWeight: '700' as any },
  em: { fontStyle: 'italic' as any },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  code_inline: { backgroundColor: colors.gray[100], color: colors.primary[700], paddingHorizontal: 4, borderRadius: 4, fontSize: 13 },
  fence: { backgroundColor: colors.gray[100], padding: 12, borderRadius: 8, marginBottom: 8 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary[300], paddingLeft: 12, marginBottom: 8, backgroundColor: colors.primary[50] },
  link: { color: colors.primary[500] },
})

const createMdStylesUser = (colors: typeof Colors) => StyleSheet.create({
  body: { color: colors.text, fontSize: FontSize.sm, lineHeight: 22 },
  paragraph: { marginBottom: 4 },
})

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  errorText: { fontSize: FontSize.base, color: colors.red[600], marginBottom: Spacing.md },
  retryBtn: { backgroundColor: colors.primary[500], paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  retryBtnText: { color: '#ffffff', fontWeight: '700' },

  card: { backgroundColor: colors.card, marginHorizontal: Spacing.lg, marginTop: Spacing.md, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.sm },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full },
  typeBadgeText: { fontSize: FontSize.xs, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusOpen: { backgroundColor: isDark ? 'rgba(34,197,94,0.20)' : '#D1FAE5' },
  statusOpenText: { color: isDark ? '#4ADE80' : '#059669' },
  statusResolved: { backgroundColor: isDark ? 'rgba(59,130,246,0.20)' : '#DBEAFE' },
  statusResolvedText: { color: isDark ? '#60A5FA' : '#2563EB' },
  statusArchived: { backgroundColor: colors.gray[100] },
  statusArchivedText: { color: colors.gray[500] },

  title: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
  rawText: { fontSize: FontSize.sm, color: colors.textSecondary, lineHeight: 22, marginBottom: Spacing.sm },
  dateText: { fontSize: FontSize.xs, color: colors.textMuted },

  statusActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  statusBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  statusBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary[700] },
  statusBtnMuted: { backgroundColor: colors.gray[50], borderColor: colors.gray[200] },
  statusBtnMutedText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.gray[600] },

  sectionTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, marginBottom: Spacing.md },

  runCard: { backgroundColor: colors.gray[50], borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark, 'violet') },
  runHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  runPersonaName: { fontSize: FontSize.sm, fontWeight: '700', color: colors.primary[700] },
  runDate: { fontSize: FontSize.xs, color: colors.textMuted },
  mdWrap: { overflow: 'hidden' },

  replyLink: { marginTop: Spacing.sm },
  replyLinkText: { fontSize: FontSize.xs, color: colors.primary[500], fontWeight: '600' },

  thinkingBlock: { backgroundColor: colors.purple[50], borderRadius: BorderRadius.sm, padding: Spacing.md, marginBottom: Spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.purple[500] },
  thinkingLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.purple[600], marginBottom: 4 },
  thinkingText: { fontSize: FontSize.xs, color: colors.purple[600], lineHeight: 18 },

  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, minHeight: 60, textAlignVertical: 'top', ...neonSoft(colors, isDark) },

  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.sm },
  cancelBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  cancelBtnText: { fontSize: FontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  sendBtn: { backgroundColor: colors.primary[500], paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#ffffff', fontSize: FontSize.sm, fontWeight: '700' },

  msgBubble: { borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  msgUser: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[100], ...neonSoft(colors, isDark) },
  msgAssistant: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark, 'violet') },
  msgSender: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[700], marginBottom: 4 },
  msgDate: { fontSize: 10, color: colors.textMuted, marginTop: 4, textAlign: 'right' },

  muted: { fontSize: FontSize.sm, color: colors.textMuted },
})
