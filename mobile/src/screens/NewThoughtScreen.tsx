import React, { useState, useCallback } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { thoughtsApi } from '../api/thoughts'
import { personasApi, type Persona } from '../api/personas'
import { orchestrationApi } from '../api/orchestration'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import PersonaPickerSheet from '../components/PersonaPickerSheet'

const TYPES: Array<{ key: string; label: string; icon: string }> = [
  { key: 'idea', label: 'Idea', icon: '💡' },
  { key: 'decision', label: 'Decision', icon: '🎯' },
  { key: 'problem', label: 'Problem', icon: '🧩' },
  { key: 'reflection', label: 'Reflection', icon: '🪞' },
  { key: 'goal', label: 'Goal', icon: '🚀' },
  { key: 'journal', label: 'Journal', icon: '📓' },
]

export default function NewThoughtScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<any>()
  const [title, setTitle] = useState('')
  const [rawText, setRawText] = useState('')
  const [thoughtType, setThoughtType] = useState('idea')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // Re-fetch personas every time the tab gains focus so newly added
  // personas from the Library show up immediately.
  useFocusEffect(
    useCallback(() => {
      personasApi.getActive().then(setPersonas).catch(() => {})
    }, []),
  )

  const handleSubmit = async () => {
    if (loading) return
    if (!title.trim() || !rawText.trim()) {
      showToast('Please fill in title and content', 'error')
      return
    }
    setLoading(true)
    try {
      const thought = await thoughtsApi.create({ title: title.trim(), rawText: rawText.trim(), thoughtType })
      if (selectedPersonas.length > 0) {
        await orchestrationApi.analyzeThought(thought.id, selectedPersonas)
      }
      showToast('Thought created!', 'success')
      setTitle('')
      setRawText('')
      setSelectedPersonas([])
      // Push ThoughtDetail onto the NewThought stack so back returns here
      // without polluting the Dashboard tab's navigation state.
      navigation.navigate('ThoughtDetail', { thoughtId: thought.id })
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to create thought', 'error')
    }
    setLoading(false)
  }

  const togglePersona = (id: string) => {
    setSelectedPersonas((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  const canSubmit = title.trim().length > 0 && rawText.trim().length > 0 && !loading

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Hero header */}
        <LinearGradient
          colors={isDark ? ['#1e3a8a', '#3b0764', '#831843'] : ['#0ea5e9', '#a855f7', '#ec4899']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + Spacing.lg }]}
        >
          <Text style={styles.heroEyebrow}>✨  Capture</Text>
          <Text style={styles.heroTitle}>New Thought</Text>
          <Text style={styles.heroSubtitle}>What's on your mind? Jot it down and route it to the right personas.</Text>
        </LinearGradient>

        {/* Title card */}
        <View style={styles.card}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="A short line that sums it up..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* Type selector */}
        <View style={styles.card}>
          <Text style={styles.label}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
            {TYPES.map((t) => {
              const active = thoughtType === t.key
              return (
                <TouchableOpacity key={t.key} activeOpacity={0.8} onPress={() => setThoughtType(t.key)} style={styles.typeChipWrap}>
                  {active ? (
                    <LinearGradient
                      colors={['#0ea5e9', '#6366f1']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.typeChip, styles.typeChipActive]}
                    >
                      <Text style={styles.typeChipIcon}>{t.icon}</Text>
                      <Text style={[styles.typeChipText, styles.typeChipTextActive]}>{t.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.typeChip}>
                      <Text style={styles.typeChipIcon}>{t.icon}</Text>
                      <Text style={styles.typeChipText}>{t.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>

        {/* Content card */}
        <View style={styles.card}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Content</Text>
            <Text style={styles.counter}>{rawText.length} chars</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={rawText}
            onChangeText={setRawText}
            placeholder="Express your thought in detail — context, feelings, options, anything that helps..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Personas card */}
        <View style={styles.card}>
          <PersonaPickerSheet
            personas={personas}
            selectedIds={selectedPersonas}
            onToggle={togglePersona}
          />
          {selectedPersonas.length > 0 && (
            <Text style={styles.hint}>
              ✓ {selectedPersonas.length} persona{selectedPersonas.length === 1 ? '' : 's'} will analyze this thought.
            </Text>
          )}
        </View>

        {/* Submit button */}
        <TouchableOpacity activeOpacity={0.9} style={styles.submitWrap} onPress={handleSubmit} disabled={!canSubmit}>
          <LinearGradient
            colors={canSubmit ? ['#0ea5e9', '#6366f1', '#a855f7'] : [colors.gray[300], colors.gray[400]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.submitBtn}
          >
            <Text style={styles.submitBtnText}>{loading ? 'Creating…' : 'Create Thought →'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const shadow = (elevation: number) =>
  Platform.select({
    ios: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: elevation / 2 },
      shadowOpacity: 0.08,
      shadowRadius: elevation,
    },
    android: { elevation },
    default: {},
  }) as object

const createStyles = (colors: typeof Colors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 140 },

  // Hero
  hero: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['2xl'],
    borderBottomLeftRadius: BorderRadius.xl + 12,
    borderBottomRightRadius: BorderRadius.xl + 12,
    marginBottom: Spacing.lg,
  },
  heroEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
  },
  heroTitle: {
    fontSize: FontSize['3xl'],
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.92)',
    marginTop: Spacing.xs,
    lineHeight: 20,
    maxWidth: 320,
  },

  // Cards
  card: {
    backgroundColor: colors.card,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
    ...shadow(3),
    ...neonCard(colors, isDark),
  },

  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing.sm },
  counter: { fontSize: FontSize.xs, color: colors.textMuted, marginBottom: Spacing.sm },

  input: {
    backgroundColor: isDark ? colors.gray[100] : colors.gray[50],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    fontSize: FontSize.base,
    color: colors.text,
    ...neonSoft(colors, isDark),
  },
  textArea: { minHeight: 140, lineHeight: 22 },

  // Type chips
  typeRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2, paddingRight: Spacing.lg },
  typeChipWrap: { borderRadius: BorderRadius.full, overflow: 'hidden' },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: isDark ? colors.gray[100] : colors.gray[100],
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: {
    borderColor: 'transparent',
    ...shadow(3),
  },
  typeChipIcon: { fontSize: 14 },
  typeChipText: { fontSize: FontSize.sm, color: colors.text, fontWeight: '600' },
  typeChipTextActive: { color: '#ffffff', fontWeight: '700' },

  hint: {
    fontSize: FontSize.xs,
    color: colors.primary[600],
    fontWeight: '600',
    marginTop: Spacing.sm,
  },

  // Submit
  submitWrap: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...shadow(5),
  },
  submitBtn: {
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
  },
  submitBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '800', letterSpacing: 0.2 },
})
