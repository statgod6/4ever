import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Switch, TouchableOpacity } from 'react-native'
import { insightsApi, type InsightStats, type RelationshipHealthResponse } from '../api/insights'
import { userContextApi } from '../api/userContext'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'

const STYLE_LABELS: Record<string, string> = {
  neutral: 'Neutral', warm_coach: 'Warm coach', socratic: 'Socratic', playful: 'Playful',
}

export default function InsightsScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [stats, setStats] = useState<InsightStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<RelationshipHealthResponse | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [optingIn, setOptingIn] = useState(false)

  const loadHealth = async () => {
    setHealthLoading(true)
    try { setHealth(await insightsApi.getRelationshipHealth({ days: 30 })) }
    catch {} finally { setHealthLoading(false) }
  }

  useEffect(() => {
    insightsApi.getStats().then(setStats).catch(() => {}).finally(() => setLoading(false))
    loadHealth()
  }, [])

  const handleToggleOptIn = async (enabled: boolean) => {
    setOptingIn(true)
    try {
      await userContextApi.setRelationshipHealthOptIn(enabled)
      await loadHealth()
    } catch {} finally { setOptingIn(false) }
  }

  const renderTrend = (n: number) => {
    if (n === 0) return <Text style={styles.trendFlat}>↔ flat</Text>
    if (n > 0) return <Text style={styles.trendUp}>↑ {Math.round(n * 100)}%</Text>
    return <Text style={styles.trendDown}>↓ {Math.round(Math.abs(n) * 100)}%</Text>
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary[500]} /></View>

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Insights</Text>

      {/* Relationship Health */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Relationship Health (30d)</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.optInLabel}>opt-in</Text>
            <Switch
              value={!!health?.optIn}
              onValueChange={handleToggleOptIn}
              disabled={optingIn || healthLoading}
            />
          </View>
        </View>
        {!health?.optIn && (
          <Text style={styles.subText}>
            Enable opt-in to see trends across your mediated connections. Data stays between you and your people.
          </Text>
        )}
        {health?.optIn && healthLoading && <ActivityIndicator color={colors.primary[500]} />}
        {health?.optIn && !healthLoading && health.reports.length === 0 && (
          <Text style={styles.subText}>No mediated connections yet.</Text>
        )}
        {health?.optIn && health.reports.map((r) => (
          <View key={r.connectionId} style={styles.healthCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.partnerName}>{r.partner.name}</Text>
              <View style={styles.styleChip}>
                <Text style={styles.styleChipText}>{STYLE_LABELS[r.mediatorStyle] || r.mediatorStyle}</Text>
              </View>
            </View>
            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Sessions</Text>
                <Text style={styles.metricValue}>{r.metrics.mediationSessions.current}</Text>
                {renderTrend(r.metrics.mediationSessions.trend)}
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Messages</Text>
                <Text style={styles.metricValue}>{r.metrics.directMessages.current}</Text>
                {renderTrend(r.metrics.directMessages.trend)}
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Actions</Text>
                <Text style={styles.metricValue}>{r.metrics.actionsAccepted}/{r.metrics.actionsCreated}</Text>
                <Text style={styles.trendFlat}>accepted</Text>
              </View>
            </View>
            {r.topTopics.length > 0 && (
              <View style={styles.topicsRow}>
                {r.topTopics.slice(0, 5).map((t, i) => (
                  <View key={i} style={styles.topicChip}><Text style={styles.topicChipText}>{t}</Text></View>
                ))}
              </View>
            )}
            {r.lastSessionSummary && (
              <Text style={styles.summaryQuote} numberOfLines={3}>“{r.lastSessionSummary}”</Text>
            )}
          </View>
        ))}
      </View>

      {stats?.topicDistribution && stats.topicDistribution.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Thought Distribution</Text>
          {stats.topicDistribution.map((t) => (
            <View key={t.type} style={styles.barRow}>
              <Text style={styles.barLabel}>{t.type}</Text>
              <View style={styles.barBg}><View style={[styles.barFill, { width: `${t.percentage}%` }]} /></View>
              <Text style={styles.barValue}>{t.count}</Text>
            </View>
          ))}
        </View>
      )}

      {stats?.statusFlow && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resolution Rate</Text>
          <Text style={styles.bigNumber}>{stats.statusFlow.resolutionRate}%</Text>
          <Text style={styles.subText}>{stats.statusFlow.total} total thoughts</Text>
        </View>
      )}

      {stats?.personaEffectiveness && stats.personaEffectiveness.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Persona Effectiveness</Text>
          {stats.personaEffectiveness.slice(0, 5).map((p) => (
            <View key={p.personaId} style={styles.personaRow}>
              <Text style={styles.personaName}>{p.personaName}</Text>
              <Text style={styles.personaStat}>{p.totalResponses} responses</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: Spacing.xl, paddingBottom: 120 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, marginBottom: Spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  cardTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, marginBottom: Spacing.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  barLabel: { width: 80, fontSize: FontSize.sm, color: colors.textSecondary },
  barBg: { flex: 1, height: 8, backgroundColor: colors.gray[200], borderRadius: 4 },
  barFill: { height: 8, backgroundColor: colors.primary[500], borderRadius: 4 },
  barValue: { width: 30, fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'right' },
  bigNumber: { fontSize: 48, fontWeight: '800', color: colors.primary[600], textAlign: 'center' },
  subText: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  personaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  personaName: { fontSize: FontSize.base, color: colors.text },
  personaStat: { fontSize: FontSize.sm, color: colors.textSecondary },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optInLabel: { fontSize: FontSize.xs, color: colors.textMuted },
  healthCard: { backgroundColor: isDark ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.05)', borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.md, borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.2)' },
  partnerName: { fontSize: FontSize.base, fontWeight: '700', color: colors.text },
  styleChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(139, 92, 246, 0.2)' },
  styleChipText: { fontSize: 10, color: isDark ? '#c4b5fd' : '#6d28d9', fontWeight: '600' },
  metricsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  metricBox: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, backgroundColor: colors.card, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: colors.border },
  metricLabel: { fontSize: 10, color: colors.textMuted, textTransform: 'uppercase' },
  metricValue: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginVertical: 2 },
  trendUp: { fontSize: 10, color: '#22c55e', fontWeight: '600' },
  trendDown: { fontSize: 10, color: '#ef4444', fontWeight: '600' },
  trendFlat: { fontSize: 10, color: colors.textMuted },
  topicsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: Spacing.sm },
  topicChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.gray[100] },
  topicChipText: { fontSize: 10, color: colors.textSecondary },
  summaryQuote: { fontSize: FontSize.xs, color: colors.textSecondary, fontStyle: 'italic', marginTop: Spacing.sm },
})
