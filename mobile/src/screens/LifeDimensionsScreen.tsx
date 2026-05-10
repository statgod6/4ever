import React, { useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native'
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  dimensionsApi,
  type LifeWheelPayload,
  type DimensionDetail,
  type DimensionHistory,
} from '../api/dimensions'
import {
  LIFE_DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_DESCRIPTIONS,
  DIMENSION_COLORS,
  DIMENSION_EMOJI,
  type LifeDimension,
} from '../constants/dimensions'
import { LifeWheel } from '../components/LifeWheel'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'

type Props = NativeStackScreenProps<any, 'LifeDimensions'>

export default function LifeDimensionsScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [wheel, setWheel] = useState<LifeWheelPayload | null>(null)
  const [selected, setSelected] = useState<LifeDimension | null>(null)
  const [detail, setDetail] = useState<DimensionDetail | null>(null)
  const [history, setHistory] = useState<DimensionHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadWheel = useCallback(async () => {
    try {
      const w = await dimensionsApi.getLifeWheel()
      setWheel(w)
    } catch {
      showToast('Could not load Life Wheel', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { loadWheel() }, [loadWheel]))

  const openDimension = async (dim: LifeDimension) => {
    setSelected(dim)
    setDetail(null)
    setHistory(null)
    try {
      const [d, h] = await Promise.all([
        dimensionsApi.getDetail(dim),
        dimensionsApi.getHistory(dim),
      ])
      setDetail(d)
      setHistory(h)
    } catch {
      showToast('Could not load dimension details', 'error')
    }
  }

  const onRefresh = async () => {
    setRefreshing(true)
    await loadWheel()
    if (selected) await openDimension(selected)
    setRefreshing(false)
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary[500]} /></View>
  }

  if (!wheel) {
    return <View style={styles.center}><Text style={styles.muted}>No data yet.</Text></View>
  }

  const scores = Object.fromEntries(
    wheel.dimensions.map((d) => [d.dimension, d.observedScore]),
  ) as Partial<Record<LifeDimension, number>>

  const selfScores = Object.fromEntries(
    wheel.dimensions.filter((d) => d.selfScore !== null).map((d) => [d.dimension, d.selfScore!]),
  ) as Partial<Record<LifeDimension, number>>

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
    >
      {/* Wheel */}
      <View style={styles.wheelCard}>
        <Text style={styles.eyebrow}>Week of {wheel.weekStart}</Text>
        <LifeWheel scores={scores} secondaryScores={selfScores} size={280} />
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: colors.primary[500], opacity: 0.4 }]} />
            <Text style={styles.legendText}>observed (what the app sees)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { borderWidth: 1.5, borderColor: colors.textSecondary, borderStyle: 'dashed' }]} />
            <Text style={styles.legendText}>your self-rating</Text>
          </View>
        </View>
      </View>

      {/* Weekly check-in CTA */}
      {wheel.needsWeeklyCheckin && (
        <TouchableOpacity
          style={styles.ctaCard}
          onPress={() => navigation.navigate('WeeklyCheckin')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaTitle}>Weekly check-in</Text>
          <Text style={styles.ctaSub}>A minute to rate the 6 dimensions. No pressure — skip what you don't know.</Text>
          <Text style={styles.ctaLink}>Start →</Text>
        </TouchableOpacity>
      )}

      {/* Dimension cards */}
      <Text style={styles.sectionTitle}>Dimensions</Text>
      {wheel.dimensions.map((d) => {
        const isOpen = selected === d.dimension
        return (
          <View key={d.dimension} style={styles.dimCard}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => (isOpen ? setSelected(null) : openDimension(d.dimension))}>
              <View style={styles.dimHeader}>
                <View style={[styles.dimDot, { backgroundColor: DIMENSION_COLORS[d.dimension] }]} />
                <Text style={styles.dimEmoji}>{DIMENSION_EMOJI[d.dimension]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dimLabel}>{d.label}</Text>
                  <Text style={styles.dimDesc}>{DIMENSION_DESCRIPTIONS[d.dimension]}</Text>
                </View>
                <View style={styles.dimScoreBox}>
                  <Text style={styles.dimScore}>{d.observedScore.toFixed(1)}</Text>
                  <Text style={styles.dimTrend}>
                    {d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : '→'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {isOpen && (
              <View style={styles.dimExpanded}>
                {!detail || !history ? (
                  <ActivityIndicator color={colors.primary[500]} style={{ marginTop: Spacing.md }} />
                ) : (
                  <>
                    <TrendChart history={history} color={DIMENSION_COLORS[d.dimension]} colors={colors} />

                    <View style={styles.statsRow}>
                      <Stat label="Self" value={detail.latestSelfScore !== null ? `${detail.latestSelfScore}/10` : '—'} colors={colors} />
                      <Stat label="Observed" value={`${detail.observedScore.toFixed(1)}/10`} colors={colors} />
                      <Stat label="Signals (4w)" value={String(detail.recentSignals.length)} colors={colors} />
                    </View>

                    <Text style={styles.subSectionTitle}>Recent signals</Text>
                    {detail.recentSignals.length === 0 ? (
                      <Text style={styles.muted}>No signals picked up yet. Keep talking — Core will listen.</Text>
                    ) : (
                      detail.recentSignals.slice(0, 8).map((s) => (
                        <View key={s.id} style={styles.signalRow}>
                          <Text style={[styles.signalVal, { color: s.valence > 0 ? '#059669' : '#dc2626' }]}>
                            {s.valence > 0 ? `+${s.valence}` : s.valence}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.signalText}>{s.summary || '(no summary)'}</Text>
                            <Text style={styles.signalMeta}>
                              {s.source} · {new Date(s.createdAt).toLocaleDateString()}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </>
                )}
              </View>
            )}
          </View>
        )
      })}

      <Text style={styles.footer}>
        This isn't a scorecard. It's a mirror. Small, steady investments move the needle — and some weeks the needle holds, which is fine.
      </Text>
    </ScrollView>
  )
}

function Stat({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: FontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  )
}

function TrendChart({ history, color, colors }: { history: DimensionHistory; color: string; colors: any }) {
  const width = 300
  const height = 100
  const pad = 12
  const weeks = history.weeks
  if (weeks.length === 0) return null
  const xStep = (width - pad * 2) / Math.max(1, weeks.length - 1)
  const yFor = (v: number) => pad + (1 - (v - 1) / 9) * (height - pad * 2)
  const observedPoints = weeks.map((w, i) => `${pad + i * xStep},${yFor(w.observed)}`).join(' ')
  const selfPoints = weeks
    .map((w, i) => (w.self !== null ? `${pad + i * xStep},${yFor(w.self!)}` : null))
    .filter(Boolean)
    .join(' ')

  return (
    <View style={{ marginTop: Spacing.sm, alignItems: 'center' }}>
      <Svg width={width} height={height}>
        {[1, 5, 10].map((v, idx) => (
          <Line key={idx} x1={pad} y1={yFor(v)} x2={width - pad} y2={yFor(v)} stroke={colors.border} strokeWidth={0.5} />
        ))}
        <Polyline points={observedPoints} stroke={color} strokeWidth={2} fill="none" />
        {selfPoints.length > 0 && (
          <Polyline points={selfPoints} stroke={colors.textSecondary} strokeWidth={1.5} strokeDasharray="4,3" fill="none" />
        )}
        {weeks.map((w, i) => (
          <Circle key={i} cx={pad + i * xStep} cy={yFor(w.observed)} r={2.5} fill={color} />
        ))}
        <SvgText x={pad} y={height - 2} fontSize="9" fill={colors.textMuted}>12w ago</SvgText>
        <SvgText x={width - pad - 20} y={height - 2} fontSize="9" fill={colors.textMuted}>now</SvgText>
      </Svg>
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  muted: { color: colors.textMuted, fontSize: FontSize.sm, fontStyle: 'italic' },

  wheelCard: {
    backgroundColor: colors.card,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: { fontSize: FontSize.xs, color: colors.primary[700], fontWeight: '700', letterSpacing: 0.5, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  legendRow: { flexDirection: 'row', marginTop: Spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: Spacing.md, marginTop: 4 },
  legendSwatch: { width: 16, height: 8, borderRadius: 2, marginRight: 6 },
  legendText: { fontSize: FontSize.xs, color: colors.textSecondary },

  ctaCard: {
    marginTop: Spacing.md,
    backgroundColor: colors.primary[50],
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary[500],
  },
  ctaTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.primary[900] },
  ctaSub: { fontSize: FontSize.sm, color: isDark ? colors.textSecondary : colors.primary[900], marginTop: 4 },
  ctaLink: { marginTop: Spacing.sm, fontSize: FontSize.sm, fontWeight: '700', color: colors.primary[600] },

  sectionTitle: { marginTop: Spacing.lg, marginBottom: Spacing.sm, fontSize: FontSize.base, fontWeight: '700', color: colors.text },

  dimCard: {
    backgroundColor: colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dimHeader: { flexDirection: 'row', alignItems: 'center' },
  dimDot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  dimEmoji: { fontSize: 22, marginRight: Spacing.sm },
  dimLabel: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  dimDesc: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },
  dimScoreBox: { alignItems: 'flex-end', minWidth: 50 },
  dimScore: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  dimTrend: { fontSize: FontSize.sm, color: colors.textMuted },
  dimExpanded: { marginTop: Spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: Spacing.md },
  statsRow: { flexDirection: 'row', marginTop: Spacing.md, marginBottom: Spacing.sm },
  subSectionTitle: { fontSize: FontSize.sm, fontWeight: '700', color: colors.textSecondary, marginTop: Spacing.sm, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  signalRow: { flexDirection: 'row', paddingVertical: 6, alignItems: 'flex-start' },
  signalVal: { width: 30, fontSize: FontSize.sm, fontWeight: '700' },
  signalText: { fontSize: FontSize.sm, color: colors.text },
  signalMeta: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },

  footer: { marginTop: Spacing.lg, fontSize: FontSize.xs, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: Spacing.md },
})
