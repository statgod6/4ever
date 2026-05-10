import React, { useState, useCallback, useRef, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useAuthStore } from '../store/authStore'
import { thoughtsApi, type Thought } from '../api/thoughts'
import { personasApi } from '../api/personas'
import { plannerApi, type PlanTask } from '../api/planner'
import { actionsApi, type ActionItem } from '../api/actions'
import { relationshipsApi, type RelationshipHealthData } from '../api/relationships'
import { checkInApi, type DailyCheckIn } from '../api/checkin'
import { ontologyApi, type OntologySnapshot } from '../api/ontology'
import { dimensionsApi, type LifeWheelPayload } from '../api/dimensions'
import { LifeWheel } from '../components/LifeWheel'
import { DIMENSION_COLORS, DIMENSION_LABELS, type LifeDimension } from '../constants/dimensions'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard, neonSoft } from '../constants/neonStyles'
import UserAvatar from '../components/UserAvatar'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'DashboardHome'>

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
}

const thoughtTypeColorMapLight: Record<string, { bg: string; text: string }> = {
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
}
const thoughtTypeColorMapDark: Record<string, { bg: string; text: string }> = {
  'business idea': { bg: 'rgba(59,130,246,0.18)', text: '#60A5FA' },
  'personal decision': { bg: 'rgba(34,197,94,0.18)', text: '#4ADE80' },
  'career concern': { bg: 'rgba(139,92,246,0.18)', text: '#A78BFA' },
  'emotional situation': { bg: 'rgba(236,72,153,0.18)', text: '#F472B6' },
  'relationship issue': { bg: 'rgba(244,63,94,0.18)', text: '#FB7185' },
  'research thought': { bg: 'rgba(99,102,241,0.18)', text: '#818CF8' },
  'content idea': { bg: 'rgba(245,158,11,0.18)', text: '#FCD34D' },
  'ethical dilemma': { bg: 'rgba(249,115,22,0.18)', text: '#FB923C' },
  'startup plan': { bg: 'rgba(6,182,212,0.18)', text: '#22D3EE' },
  'life choice': { bg: 'rgba(20,184,166,0.18)', text: '#2DD4BF' },
  'general reflection': { bg: 'rgba(148,163,184,0.18)', text: '#CBD5E1' },
}

export default function DashboardScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const thoughtTypeColorMap = isDark ? thoughtTypeColorMapDark : thoughtTypeColorMapLight
  const insets = useSafeAreaInsets()
  const user = useAuthStore((s) => s.user)
  const [refreshing, setRefreshing] = useState(false)
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [personaCount, setPersonaCount] = useState(0)
  const [todayTasks, setTodayTasks] = useState<PlanTask[]>([])
  const [pendingActions, setPendingActions] = useState<ActionItem[]>([])
  const [health, setHealth] = useState<RelationshipHealthData | null>(null)
  const [checkIn, setCheckIn] = useState<DailyCheckIn | null>(null)
  const [showAllThoughts, setShowAllThoughts] = useState(false)
  const [snapshot, setSnapshot] = useState<OntologySnapshot | null>(null)
  const [refreshingOntology, setRefreshingOntology] = useState(false)
  const [lifeWheel, setLifeWheel] = useState<LifeWheelPayload | null>(null)

  const today = new Date().toISOString().split('T')[0]

  // --- Dashboard cache (stale-while-revalidate + 30s debounce) ---
  // Shows last cached snapshot instantly; refreshes in background.
  const cacheKey = user?.id ? `dashboard_cache:${user.id}` : null
  const lastFetchRef = useRef<number>(0)
  const hydratedRef = useRef<boolean>(false)
  const DEBOUNCE_MS = 30_000

  // Hydrate from cache on first mount — runs once per screen lifetime.
  useEffect(() => {
    if (!cacheKey || hydratedRef.current) return
    hydratedRef.current = true
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(cacheKey)
        if (!raw) return
        const c = JSON.parse(raw) as any
        if (c.thoughts) setThoughts(c.thoughts)
        if (typeof c.personaCount === 'number') setPersonaCount(c.personaCount)
        if (c.todayTasks) setTodayTasks(c.todayTasks)
        if (c.pendingActions) setPendingActions(c.pendingActions)
        if (c.health !== undefined) setHealth(c.health)
        if (c.checkIn !== undefined) setCheckIn(c.checkIn)
        if (c.snapshot !== undefined) setSnapshot(c.snapshot)
        if (c.lifeWheel !== undefined) setLifeWheel(c.lifeWheel)
      } catch {
        // ignore cache errors
      }
    })()
  }, [cacheKey])

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    // Debounce: skip refetch if called again within DEBOUNCE_MS (unless forced).
    const now = Date.now()
    if (!opts?.force && now - lastFetchRef.current < DEBOUNCE_MS) return
    lastFetchRef.current = now
    try {
      const [thoughts, personas, plan, actions, healthData, todayCheckIn, snap, wheel] = await Promise.all([
        thoughtsApi.getAll().catch(() => []),
        personasApi.getAll().catch(() => []),
        plannerApi.getPlan(today).catch(() => null),
        actionsApi.getActionItems('pending').catch(() => []),
        relationshipsApi.getHealth().catch(() => null),
        checkInApi.getCheckIn(today).catch(() => null),
        ontologyApi.getSnapshot().catch(() => null),
        dimensionsApi.getLifeWheel().catch(() => null),
      ])
      const personaCount = personas.length
      const todayTasks = plan?.tasks || []
      const pendingActions = actions.slice(0, 3)
      setThoughts(thoughts)
      setPersonaCount(personaCount)
      setTodayTasks(todayTasks)
      setPendingActions(pendingActions)
      setHealth(healthData)
      setCheckIn(todayCheckIn)
      setSnapshot(snap)
      setLifeWheel(wheel)
      // Persist latest snapshot for next cold start.
      if (cacheKey) {
        AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({
            thoughts,
            personaCount,
            todayTasks,
            pendingActions,
            health: healthData,
            checkIn: todayCheckIn,
            snapshot: snap,
            lifeWheel: wheel,
            ts: now,
          }),
        ).catch(() => {})
      }
    } catch {}
  }, [today, cacheKey])

  useFocusEffect(
    useCallback(() => {
      loadData()
    }, [loadData])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await ontologyApi.refresh().catch(() => null)
    } finally {
      // Pull-to-refresh always bypasses debounce.
      await loadData({ force: true })
      setRefreshing(false)
    }
  }

  const refreshOntology = async () => {
    setRefreshingOntology(true)
    try {
      await ontologyApi.refresh().catch(() => null)
      const snap = await ontologyApi.getSnapshot().catch(() => null)
      setSnapshot(snap)
      // Force next loadData to bypass debounce so the rest of the dashboard re-syncs too.
      lastFetchRef.current = 0
    } finally {
      setRefreshingOntology(false)
    }
  }

  const trendArrow = (t: string) => (t === 'up' ? '↗' : t === 'down' ? '↘' : '→')
  const weatherEmoji = (w: string) => {
    const k = (w || '').toLowerCase()
    if (k.includes('storm')) return '⛈️'
    if (k.includes('rain')) return '🌧️'
    if (k.includes('cloud')) return '☁️'
    if (k.includes('sun') || k.includes('clear')) return '☀️'
    if (k.includes('fog') || k.includes('mist')) return '🌫️'
    return '🌤️'
  }

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const greetingEmoji = () => {
    const hour = new Date().getHours()
    if (hour < 12) return '🌅'
    if (hour < 17) return '☀️'
    if (hour < 20) return '🌇'
    return '🌙'
  }

  const doneTasks = todayTasks.filter((t) => t.status === 'done').length
  const firstName = user?.name?.split(' ')[0] || 'there'
  const initial = (user?.name?.trim()?.[0] || 'Y').toUpperCase()

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
      >
        {/* Hero Header with gradient */}
        <LinearGradient
          colors={isDark ? ['#0c4a6e', '#1e3a8a', '#3b0764'] : ['#0ea5e9', '#6366f1', '#a855f7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + Spacing.lg }]}
        >
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>{greetingEmoji()}  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
              <Text style={styles.heroGreeting}>{greeting()},</Text>
              <Text style={styles.heroName}>{firstName}.</Text>
            </View>
            <TouchableOpacity style={styles.heroAvatar} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.8}>
              <UserAvatar
                name={user?.name}
                phoneNumber={user?.phoneNumber}
                avatarUrl={user?.avatarUrl}
                size={72}
                style={{ width: 72, height: 92, borderRadius: 12 }}
                fontSize={28}
                textStyle={{ color: '#ffffff', fontWeight: '700' }}
              />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Floating stats row — overlaps hero bottom */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>💭</Text>
            <Text style={styles.statNumber}>{thoughts.length}</Text>
            <Text style={styles.statLabel}>Thoughts</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🎭</Text>
            <Text style={styles.statNumber}>{personaCount}</Text>
            <Text style={styles.statLabel}>Personas</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>💞</Text>
            <Text style={[styles.statNumber, { color: health ? (health.overallScore >= 70 ? colors.green[600] : colors.amber[600]) : colors.textMuted }]}>
              {health ? `${Math.round(health.overallScore)}%` : '--'}
            </Text>
            <Text style={styles.statLabel}>Circle</Text>
          </View>
        </View>

        {/* Where you are — Ontology snapshot */}
        {snapshot && (
          <View style={styles.ontologyCard}>
            <LinearGradient
              colors={isDark ? ['rgba(14,165,233,0.10)', 'rgba(168,85,247,0.08)'] : ['#f0f9ff', '#faf5ff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ontologyGradient}
            >
              <View style={styles.ontologyHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ontologyEyebrow}>✦  Where you are</Text>
                  <Text style={styles.ontologyTrajectory}>{snapshot.trajectory}</Text>
                </View>
                <TouchableOpacity onPress={refreshOntology} disabled={refreshingOntology} style={styles.ontologyRefreshBtn} activeOpacity={0.7}>
                  <Text style={styles.ontologyRefreshText}>{refreshingOntology ? '…' : '↻'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.ontologyPillRow}>
                <View style={styles.ontologyPill}>
                  <Text style={styles.ontologyPillText}>{weatherEmoji(snapshot.weather)}  {snapshot.weather}</Text>
                </View>
                <View style={styles.ontologyPill}>
                  <Text style={styles.ontologyPillText}>mood {trendArrow(snapshot.moodTrend)}</Text>
                </View>
                <View style={styles.ontologyPill}>
                  <Text style={styles.ontologyPillText}>energy {trendArrow(snapshot.energyTrend)}</Text>
                </View>
                {snapshot.dominantTheme && (
                  <View style={[styles.ontologyPill, styles.ontologyPillAccent]}>
                    <Text style={[styles.ontologyPillText, styles.ontologyPillAccentText]}>{snapshot.dominantTheme}</Text>
                  </View>
                )}
              </View>

              {snapshot.topTensions && snapshot.topTensions.length > 0 && (
                <View style={styles.ontologySection}>
                  <Text style={styles.ontologySectionLabel}>Top tensions</Text>
                  <View style={styles.ontologyPillRow}>
                    {snapshot.topTensions.slice(0, 2).map((t, i) => (
                      <View key={i} style={styles.ontologyTensionPill}>
                        <Text style={styles.ontologyTensionText}>{t.title}{t.personName ? `  ·  ${t.personName}` : ''}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {snapshot.driftingPeople && snapshot.driftingPeople.length > 0 && (
                <View style={styles.ontologySection}>
                  <Text style={styles.ontologySectionLabel}>Drifting</Text>
                  <View style={styles.ontologyPillRow}>
                    {snapshot.driftingPeople.slice(0, 3).map((p) => (
                      <View key={p.personId} style={styles.ontologyDriftPill}>
                        <Text style={styles.ontologyDriftText}>{p.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.ontologyFocus}>
                <Text style={styles.ontologyFocusLabel}>→ Recommended focus</Text>
                <Text style={styles.ontologyFocusText}>{snapshot.recommendedFocus}</Text>
              </View>

              {(snapshot.staleness?.self || snapshot.staleness?.emotional || snapshot.staleness?.relational) && (
                <Text style={styles.ontologyStale}>• Some layers are stale — pull to refresh</Text>
              )}
            </LinearGradient>
          </View>
        )}

        {/* Life Wheel hero — 6 dimensions at a glance */}
        {lifeWheel && (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.wheelCard}
            onPress={() => navigation.navigate('LifeDimensions')}
          >
            <LinearGradient
              colors={isDark ? ['rgba(14,165,233,0.08)', 'rgba(236,72,153,0.06)'] : ['#f0f9ff', '#fdf2f8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.wheelGradient}
            >
              <View style={styles.wheelHeader}>
                <Text style={styles.wheelEyebrow}>◎  Life Wheel</Text>
                <Text style={styles.wheelWeek}>week of {lifeWheel.weekStart}</Text>
              </View>

              <View style={styles.wheelBody}>
                <LifeWheel
                  size={240}
                  scores={Object.fromEntries(
                    lifeWheel.dimensions.map((d) => [d.dimension, d.observedScore]),
                  ) as Partial<Record<LifeDimension, number>>}
                  secondaryScores={Object.fromEntries(
                    lifeWheel.dimensions
                      .filter((d) => d.selfScore !== null)
                      .map((d) => [d.dimension, d.selfScore as number]),
                  ) as Partial<Record<LifeDimension, number>>}
                />
              </View>

              <View style={styles.wheelLegend}>
                {lifeWheel.dimensions.map((d) => (
                  <View key={d.dimension} style={styles.wheelLegendItem}>
                    <View style={[styles.wheelDot, { backgroundColor: DIMENSION_COLORS[d.dimension] }]} />
                    <Text style={styles.wheelLegendLabel}>{DIMENSION_LABELS[d.dimension]}</Text>
                    <Text style={styles.wheelLegendScore}>{d.observedScore.toFixed(1)}</Text>
                    <Text style={styles.wheelLegendTrend}>
                      {d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : '→'}
                    </Text>
                  </View>
                ))}
              </View>

              {lifeWheel.needsWeeklyCheckin ? (
                <TouchableOpacity
                  style={styles.wheelCta}
                  onPress={() => navigation.navigate('WeeklyCheckin')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.wheelCtaText}>Do this week's check-in →</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.wheelFoot}>Tap for details · keep nourishing what matters</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Today's Plan */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>📅  Today's Plan</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Planner')}>
              <Text style={styles.cardAction}>View all →</Text>
            </TouchableOpacity>
          </View>
          {todayTasks.length === 0 ? (
            <Text style={styles.cardSubtitle}>No tasks planned for today</Text>
          ) : (
            <>
              <Text style={styles.cardSubtitle}>{doneTasks}/{todayTasks.length} completed</Text>
              <View style={styles.progressBar}>
                <LinearGradient
                  colors={['#22c55e', '#0ea5e9']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${todayTasks.length > 0 ? (doneTasks / todayTasks.length) * 100 : 0}%` }]}
                />
              </View>
            </>
          )}
        </View>

        {/* Pending Actions */}
        {pendingActions.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>✅  Action Items</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Actions')}>
                <Text style={styles.cardAction}>View all →</Text>
              </TouchableOpacity>
            </View>
            {pendingActions.map((action) => (
              <View key={action.id} style={styles.actionItem}>
                <View style={styles.actionBullet} />
                <Text style={styles.actionText} numberOfLines={1}>{action.content}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Drifting Relationships */}
        {health && health.driftingPeople.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>💛  Need Attention</Text>
            <View style={{ height: Spacing.xs }} />
            {health.driftingPeople.slice(0, 3).map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.actionItem}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('PersonDetail', { personId: p.id })}
              >
                <View style={[styles.actionBullet, { backgroundColor: colors.amber[500] }]} />
                <Text style={styles.actionText}>
                  <Text style={{ fontWeight: '600' }}>{p.name}</Text>
                  {' — '}
                  <Text style={{ color: colors.textSecondary }}>{p.daysSinceInteraction ? `${p.daysSinceInteraction}d ago` : 'never reached out'}</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Recent Thoughts */}
        {thoughts.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>💭  Recent Thoughts</Text>
              <TouchableOpacity onPress={() => navigation.getParent()?.navigate('NewThoughtTab')}>
                <Text style={styles.cardAction}>New →</Text>
              </TouchableOpacity>
            </View>
            {(showAllThoughts ? thoughts : thoughts.slice(0, 5)).map((thought) => {
              const typeColor = thoughtTypeColorMap[thought.thoughtType] || { bg: colors.gray[100], text: colors.gray[600] }
              return (
                <TouchableOpacity key={thought.id} style={styles.thoughtItem} onPress={() => navigation.navigate('ThoughtDetail', { thoughtId: thought.id })} activeOpacity={0.7}>
                  <View style={[styles.thoughtDot, { backgroundColor: typeColor.text }]} />
                  <View style={styles.thoughtContent}>
                    <Text style={styles.thoughtTitle} numberOfLines={1}>{thought.title}</Text>
                    <View style={styles.thoughtMeta}>
                      <View style={[styles.thoughtTypeBadge, { backgroundColor: typeColor.bg }]}>
                        <Text style={[styles.thoughtTypeText, { color: typeColor.text }]}>
                          {thoughtTypeLabels[thought.thoughtType] || thought.thoughtType}
                        </Text>
                      </View>
                      <View style={[styles.thoughtStatusBadge, thought.status === 'open' ? styles.statusOpen : thought.status === 'resolved' ? styles.statusResolved : styles.statusArchived]}>
                        <Text style={[styles.thoughtStatusText, thought.status === 'open' ? styles.statusOpenText : thought.status === 'resolved' ? styles.statusResolvedText : styles.statusArchivedText]}>
                          {thought.status.charAt(0).toUpperCase() + thought.status.slice(1)}
                        </Text>
                      </View>
                      <Text style={styles.thoughtDate}>
                        {new Date(thought.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )
            })}
            {thoughts.length > 5 && (
              <TouchableOpacity onPress={() => setShowAllThoughts(!showAllThoughts)}>
                <Text style={styles.moreText}>{showAllThoughts ? 'Show less' : `View all ${thoughts.length} thoughts`}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
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

  // Hero
  hero: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['3xl'] + Spacing.lg, // extra room for overlapping stat cards
    borderBottomLeftRadius: BorderRadius.xl + 12,
    borderBottomRightRadius: BorderRadius.xl + 12,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: Spacing.sm,
  },
  heroGreeting: {
    fontSize: FontSize.xl,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '500',
  },
  heroName: {
    fontSize: FontSize['3xl'],
    color: '#ffffff',
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  heroAvatar: {
    width: 72,
    height: 92,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroAvatarText: { color: '#ffffff', fontSize: FontSize.lg, fontWeight: '700' },

  // Stats — overlap hero
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginTop: -Spacing['2xl'] - 4,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
    ...shadow(6),
    ...neonSoft(colors, isDark),
  },
  statIcon: { fontSize: 18, marginBottom: 2 },
  statNumber: { fontSize: FontSize.xl, fontWeight: '800', color: colors.primary[600], letterSpacing: -0.5 },
  statLabel: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2, fontWeight: '500' },

  // Quick actions
  quickActions: { flexDirection: 'row', paddingHorizontal: Spacing.xl, gap: Spacing.md, marginBottom: Spacing.lg },
  quickBtnWrap: { flex: 1, borderRadius: BorderRadius.xl, overflow: 'hidden', ...shadow(4) },
  quickBtn: { padding: Spacing.lg, alignItems: 'flex-start' },
  quickBtnIcon: { fontSize: 26, marginBottom: Spacing.xs },
  quickBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700', letterSpacing: -0.2 },
  quickBtnSub: { color: 'rgba(255,255,255,0.85)', fontSize: FontSize.xs, fontWeight: '500', marginTop: 2 },

  // Generic card
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  cardTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs, lineHeight: 20 },
  cardAction: { fontSize: FontSize.sm, color: colors.primary[500], fontWeight: '600' },

  progressBar: { height: 8, backgroundColor: colors.gray[200], borderRadius: 4, marginTop: Spacing.md, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },

  actionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.xs + 2, gap: Spacing.sm },
  actionBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary[500] },
  actionText: { fontSize: FontSize.sm, color: colors.text, flex: 1, lineHeight: 20 },

  // Check-in card
  checkinCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: isDark ? '#F59E0B' : '#fde68a',
    ...shadow(3),
    ...(isDark ? { shadowColor: '#F59E0B', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null),
  },
  checkinGradient: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, gap: Spacing.md },
  checkinIcon: { fontSize: 28 },
  checkinArrow: { fontSize: FontSize.xl, color: colors.amber[600], fontWeight: '700' },

  // Recent Thoughts
  thoughtItem: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.sm, gap: Spacing.sm },
  thoughtDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  thoughtContent: { flex: 1 },
  thoughtTitle: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text, marginBottom: 4 },
  thoughtMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  thoughtTypeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  thoughtTypeText: { fontSize: 10, fontWeight: '700' },
  thoughtStatusBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  thoughtStatusText: { fontSize: 10, fontWeight: '700' },
  statusOpen: { backgroundColor: isDark ? 'rgba(34,197,94,0.20)' : '#D1FAE5' },
  statusOpenText: { color: isDark ? '#4ADE80' : '#059669' },
  statusResolved: { backgroundColor: isDark ? 'rgba(59,130,246,0.20)' : '#DBEAFE' },
  statusResolvedText: { color: isDark ? '#60A5FA' : '#2563EB' },
  statusArchived: { backgroundColor: colors.gray[100] },
  statusArchivedText: { color: colors.gray[500] },
  thoughtDate: { fontSize: 10, color: colors.textMuted },
  moreText: { fontSize: FontSize.xs, color: colors.primary[500], textAlign: 'center', marginTop: Spacing.sm, fontWeight: '600' },

  // Ontology card
  ontologyCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: isDark ? '#A78BFA' : '#3b82f6',
    ...shadow(4),
    ...(isDark ? { shadowColor: '#A78BFA', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 5 } : null),
  },
  ontologyGradient: { padding: Spacing.lg },
  ontologyHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  ontologyEyebrow: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[600], textTransform: 'uppercase', letterSpacing: 0.6 },
  ontologyTrajectory: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text, marginTop: Spacing.xs, letterSpacing: -0.3 },
  ontologyRefreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: isDark ? 'rgba(14,165,233,0.15)' : '#ffffff',
    borderWidth: 1,
    borderColor: isDark ? colors.border : colors.primary[100],
    alignItems: 'center', justifyContent: 'center',
  },
  ontologyRefreshText: { fontSize: 18, color: colors.primary[600], fontWeight: '700' },
  ontologyPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  ontologyPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
    borderWidth: 1,
    borderColor: isDark ? colors.border : colors.gray[200],
  },
  ontologyPillText: { fontSize: FontSize.xs, color: colors.text, fontWeight: '600' },
  ontologyPillAccent: { backgroundColor: colors.primary[500], borderColor: colors.primary[500] },
  ontologyPillAccentText: { color: '#ffffff' },
  ontologySection: { marginTop: Spacing.md },
  ontologySectionLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  ontologyTensionPill: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: BorderRadius.full,
    backgroundColor: isDark ? 'rgba(245,158,11,0.18)' : colors.amber[50], borderWidth: 1, borderColor: isDark ? '#F59E0B' : colors.amber[100],
  },
  ontologyTensionText: { fontSize: FontSize.xs, color: isDark ? '#FCD34D' : colors.amber[600], fontWeight: '600' },
  ontologyDriftPill: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: BorderRadius.full,
    backgroundColor: isDark ? 'rgba(239,68,68,0.18)' : colors.red[50], borderWidth: 1, borderColor: isDark ? '#F87171' : colors.red[100],
  },
  ontologyDriftText: { fontSize: FontSize.xs, color: isDark ? '#FCA5A5' : colors.red[600], fontWeight: '600' },
  ontologyFocus: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: isDark ? 'rgba(14,165,233,0.15)' : colors.primary[50],
    borderLeftWidth: 3,
    borderLeftColor: colors.primary[500],
  },
  ontologyFocusLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[700], marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  ontologyFocusText: { fontSize: FontSize.sm, color: isDark ? colors.text : colors.primary[900], fontWeight: '500', lineHeight: 21 },
  ontologyStale: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: Spacing.sm, fontStyle: 'italic' },

  // Life Wheel hero card
  wheelCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  wheelGradient: { padding: Spacing.lg },
  wheelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  wheelEyebrow: { fontSize: FontSize.sm, fontWeight: '700', color: colors.primary[700], letterSpacing: 0.5 },
  wheelWeek: { fontSize: FontSize.xs, color: colors.textMuted, fontWeight: '500' },
  wheelBody: { alignItems: 'center', marginVertical: Spacing.sm },
  wheelLegend: { marginTop: Spacing.sm, flexDirection: 'row', flexWrap: 'wrap' },
  wheelLegendItem: { width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  wheelDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  wheelLegendLabel: { flex: 1, fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '500' },
  wheelLegendScore: { fontSize: FontSize.xs, color: colors.text, fontWeight: '700', marginRight: 4 },
  wheelLegendTrend: { fontSize: FontSize.xs, color: colors.textMuted, width: 12 },
  wheelCta: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: colors.primary[500],
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  wheelCtaText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '700' },
  wheelFoot: { marginTop: Spacing.sm, fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
})
