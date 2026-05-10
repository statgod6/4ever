import React, { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import Slider from '@react-native-community/slider'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { dimensionsApi } from '../api/dimensions'
import {
  LIFE_DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_DESCRIPTIONS,
  DIMENSION_COLORS,
  DIMENSION_EMOJI,
  type LifeDimension,
} from '../constants/dimensions'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'

type Props = NativeStackScreenProps<any, 'WeeklyCheckin'>

export default function WeeklyCheckinScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)

  // Start every dimension at null — user opts in to the ones they want to rate
  const [ratings, setRatings] = useState<Partial<Record<LifeDimension, number>>>({})
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const setScore = (dim: LifeDimension, score: number) => {
    setRatings((prev) => ({ ...prev, [dim]: Math.round(score) }))
  }

  const clearScore = (dim: LifeDimension) => {
    setRatings((prev) => {
      const next = { ...prev }
      delete next[dim]
      return next
    })
  }

  const rated = Object.keys(ratings).length
  const canSubmit = rated > 0 && !submitting

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await dimensionsApi.weeklyCheckin(ratings, note.trim() || undefined)
      showToast(`Check-in saved · ${rated} dimension${rated === 1 ? '' : 's'}`, 'success')
      navigation.goBack()
    } catch {
      showToast('Could not save check-in. Try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>This week</Text>
        <Text style={styles.subtitle}>
          Rate how each dimension feels right now. Skip what you don't want to touch — there's no wrong answer, and no streak to break.
        </Text>

        {LIFE_DIMENSIONS.map((dim) => {
          const score = ratings[dim]
          const isRated = score !== undefined
          return (
            <View key={dim} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.dot, { backgroundColor: DIMENSION_COLORS[dim] }]} />
                <Text style={styles.emoji}>{DIMENSION_EMOJI[dim]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{DIMENSION_LABELS[dim]}</Text>
                  <Text style={styles.desc}>{DIMENSION_DESCRIPTIONS[dim]}</Text>
                </View>
                <View style={styles.scoreBadge}>
                  <Text style={[styles.scoreValue, !isRated && { color: colors.textMuted }]}>
                    {isRated ? score : '—'}
                  </Text>
                </View>
              </View>

              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={10}
                step={1}
                value={score ?? 5}
                minimumTrackTintColor={DIMENSION_COLORS[dim]}
                maximumTrackTintColor={colors.border}
                thumbTintColor={DIMENSION_COLORS[dim]}
                onValueChange={(v) => setScore(dim, v)}
              />

              <View style={styles.scaleRow}>
                <Text style={styles.scaleText}>1 · struggling</Text>
                <Text style={styles.scaleText}>5 · getting by</Text>
                <Text style={styles.scaleText}>10 · thriving</Text>
              </View>

              {isRated && (
                <TouchableOpacity onPress={() => clearScore(dim)} style={styles.skipBtn}>
                  <Text style={styles.skipText}>Skip this one</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        })}

        <Text style={styles.sectionTitle}>Note (optional)</Text>
        <TextInput
          style={styles.noteInput}
          multiline
          placeholder="What's behind these numbers this week?"
          placeholderTextColor={colors.textMuted}
          value={note}
          onChangeText={setNote}
          maxLength={500}
        />

        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              {rated === 0 ? 'Rate at least one dimension' : `Save check-in (${rated}/${LIFE_DIMENSIONS.length})`}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footer}>
          This is a mirror, not a report card. Your numbers stay private and only shape how Core understands you.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, _isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: FontSize['2xl'], fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.lg, lineHeight: 20 },

  card: {
    backgroundColor: colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  emoji: { fontSize: 22, marginRight: Spacing.sm },
  label: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  desc: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },
  scoreBadge: {
    minWidth: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  scoreValue: { fontSize: FontSize.base, fontWeight: '700', color: colors.text },

  slider: { marginTop: Spacing.sm, height: 36 },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  scaleText: { fontSize: 10, color: colors.textMuted },

  skipBtn: { marginTop: Spacing.sm, alignSelf: 'flex-start' },
  skipText: { fontSize: FontSize.xs, color: colors.textMuted, textDecorationLine: 'underline' },

  sectionTitle: { marginTop: Spacing.md, marginBottom: Spacing.sm, fontSize: FontSize.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  noteInput: {
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    minHeight: 80,
    color: colors.text,
    fontSize: FontSize.sm,
    textAlignVertical: 'top',
  },

  submitBtn: {
    marginTop: Spacing.lg,
    backgroundColor: colors.primary[500],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  submitText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },

  footer: { marginTop: Spacing.lg, fontSize: FontSize.xs, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center' },
})
