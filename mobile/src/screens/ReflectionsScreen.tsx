import React, { useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { reflectionsApi, type EveningReflection, type WeeklyReflection } from '../api/reflections'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { showToast } from '../components/Toast'

const createMdStyles = (colors: typeof Colors) => StyleSheet.create({
  body: { fontSize: FontSize.sm, color: colors.text, lineHeight: 22 },
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
  link: { color: colors.primary[600] },
})

export default function ReflectionsScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const mdStyles = createMdStyles(colors)
  const [evening, setEvening] = useState<EveningReflection | null>(null)
  const [weekly, setWeekly] = useState<WeeklyReflection | null>(null)
  const [loadingEvening, setLoadingEvening] = useState(false)
  const [loadingWeekly, setLoadingWeekly] = useState(false)

  const handleEvening = async () => {
    setLoadingEvening(true)
    try {
      const data = await reflectionsApi.getEvening()
      setEvening(data)
    } catch {
      showToast('Could not generate evening reflection', 'error')
    } finally { setLoadingEvening(false) }
  }

  const handleWeekly = async () => {
    setLoadingWeekly(true)
    try {
      const data = await reflectionsApi.getWeekly()
      setWeekly(data)
    } catch {
      showToast('Could not generate weekly reflection', 'error')
    } finally { setLoadingWeekly(false) }
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Reflections</Text>
      <Text style={styles.subtitle}>{greeting}. Take a moment to pause and reflect on what matters.</Text>

      {/* Evening Reflection */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>☀️ Evening Reflection</Text>
          <TouchableOpacity style={[styles.generateBtn, loadingEvening && { opacity: 0.6 }]} onPress={handleEvening} disabled={loadingEvening}>
            {loadingEvening ? <ActivityIndicator size="small" color={colors.card} /> : <Text style={styles.generateBtnText}>{evening ? 'Regenerate' : 'How was my day?'}</Text>}
          </TouchableOpacity>
        </View>
        <Text style={styles.description}>Reviews your today's plan, mood, and thoughts to generate a personalized evening prompt.</Text>
        {evening && (
          <View style={styles.reflectionBox}>
            <Markdown style={mdStyles}>{evening.reflection}</Markdown>
          </View>
        )}
      </View>

      {/* Weekly Reflection */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>📅 Weekly Review</Text>
          <TouchableOpacity style={[styles.generateBtn, loadingWeekly && { opacity: 0.6 }]} onPress={handleWeekly} disabled={loadingWeekly}>
            {loadingWeekly ? <ActivityIndicator size="small" color={colors.card} /> : <Text style={styles.generateBtnText}>{weekly ? 'Regenerate' : 'Review my week'}</Text>}
          </TouchableOpacity>
        </View>
        <Text style={styles.description}>Analyzes your past 7 days — tasks, moods, energy, and thinking patterns.</Text>
        {weekly && (
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}><Text style={styles.statNum}>{weekly.stats.completionRate}%</Text><Text style={styles.statLabel}>Completion</Text></View>
              <View style={styles.statItem}><Text style={styles.statNum}>{weekly.stats.avgMood}</Text><Text style={styles.statLabel}>Avg Mood</Text></View>
              <View style={styles.statItem}><Text style={styles.statNum}>{weekly.stats.avgEnergy}</Text><Text style={styles.statLabel}>Avg Energy</Text></View>
              <View style={styles.statItem}><Text style={styles.statNum}>{weekly.stats.thoughtCount}</Text><Text style={styles.statLabel}>Thoughts</Text></View>
            </View>
            <View style={[styles.reflectionBox, { backgroundColor: isDark ? 'rgba(99,102,241,0.16)' : '#EEF2FF', borderColor: isDark ? '#818CF8' : '#C7D2FE' }, isDark ? { shadowColor: '#818CF8', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null]}>
              <Markdown style={mdStyles}>{weekly.reflection}</Markdown>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: Spacing.xl, paddingBottom: 120 },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm, gap: 8 },
  cardTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, flex: 1 },
  description: { fontSize: FontSize.sm, color: colors.textMuted, marginBottom: Spacing.md },
  generateBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingHorizontal: 14, paddingVertical: 8 },
  generateBtnText: { color: '#ffffff', fontSize: FontSize.sm, fontWeight: '600' },
  reflectionBox: { backgroundColor: isDark ? 'rgba(245,158,11,0.14)' : '#FFFBEB', borderWidth: 1, borderColor: isDark ? '#F59E0B' : '#FDE68A', borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, ...(isDark ? { shadowColor: '#F59E0B', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  statsGrid: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm, flexWrap: 'wrap' },
  statItem: { flex: 1, minWidth: '22%', backgroundColor: colors.gray[50], borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center', ...neonSoft(colors, isDark) },
  statNum: { fontSize: FontSize.lg, fontWeight: '700', color: colors.primary[600] },
  statLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
})
