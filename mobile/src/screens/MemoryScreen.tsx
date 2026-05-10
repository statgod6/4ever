import React, { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { memoriesApi, type Memory, type MemoryStats, type SessionSummary, type ProfileChangeEntry } from '../api/memories'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'

type Tab = 'memories' | 'sessions' | 'changelog'

export default function MemoryScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [tab, setTab] = useState<Tab>('memories')
  const [memories, setMemories] = useState<Memory[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [changelog, setChangelog] = useState<ProfileChangeEntry[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<(Memory & { similarity: number })[] | null>(null)
  const [consolidating, setConsolidating] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [mems, statsData] = await Promise.all([
        memoriesApi.list({ status: 'active', limit: 100 }).catch(() => []),
        memoriesApi.getStats().catch(() => null),
      ])
      setMemories(mems)
      if (statsData) setStats(statsData)
    } catch {} finally { setLoading(false) }
  }, [])

  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false) }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    try {
      const results = await memoriesApi.search(searchQuery, 15)
      setSearchResults(results)
    } catch { Alert.alert('Error', 'Search failed') }
  }

  const handleDelete = (id: string) => {
    Alert.alert('Delete Memory', 'This will permanently archive this memory.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await memoriesApi.delete(id)
          setMemories((prev) => prev.filter((m) => m.id !== id))
          loadData()
        } catch { Alert.alert('Error', 'Failed to delete') }
      }},
    ])
  }

  const handleConsolidate = async () => {
    setConsolidating(true)
    try {
      const result = await memoriesApi.consolidate()
      Alert.alert('Done', `Merged: ${result.merged}, Contradictions: ${result.contradictions}`)
      loadData()
    } catch { Alert.alert('Error', 'Consolidation failed') } finally { setConsolidating(false) }
  }

  const loadSessions = useCallback(async () => {
    if (sessions.length > 0) return
    try { const s = await memoriesApi.getSessionSummaries(30); setSessions(s) } catch {}
  }, [sessions.length])

  const loadChangelog = useCallback(async () => {
    if (changelog.length > 0) return
    try { const c = await memoriesApi.getProfileChangelog(100); setChangelog(c) } catch {}
  }, [changelog.length])

  const displayMemories = searchResults || memories

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary[500]} /></View>
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Memory System</Text>
        <Text style={styles.subtitle}>{stats ? `${stats.active} active memories` : "Core's long-term memory"}</Text>
      </View>

      {/* Stats */}
      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.active}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.total - stats.active}</Text>
            <Text style={styles.statLabel}>Archived</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.byType.length}</Text>
            <Text style={styles.statLabel}>Types</Text>
          </View>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['memories', 'sessions', 'changelog'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => { setTab(t); if (t === 'sessions') loadSessions(); if (t === 'changelog') loadChangelog() }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'memories' ? 'Memories' : t === 'sessions' ? 'Sessions' : 'Profile Log'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Memories Tab */}
      {tab === 'memories' && (
        <View style={styles.section}>
          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={(t) => { setSearchQuery(t); if (!t) setSearchResults(null) }}
              placeholder="Search memories..."
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults(null) }} style={styles.clearBtn}>
                <Text style={{ color: colors.textMuted }}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.purple[100] }]} onPress={handleConsolidate} disabled={consolidating}>
              <Text style={[styles.actionBtnText, { color: colors.purple[600] }]}>{consolidating ? '...' : '✨ Consolidate'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.gray[100] }]} onPress={() => { setSearchResults(null); loadData() }}>
              <Text style={[styles.actionBtnText, { color: colors.gray[600] }]}>↻ Refresh</Text>
            </TouchableOpacity>
          </View>

          {searchResults && (
            <Text style={styles.searchLabel}>{searchResults.length} results for "{searchQuery}"</Text>
          )}

          {/* Memory List */}
          {displayMemories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🧠</Text>
              <Text style={styles.emptyText}>No memories found</Text>
            </View>
          ) : (
            displayMemories.map((mem) => (
              <View key={mem.id} style={styles.memoryCard}>
                <View style={styles.memoryRow}>
                  <View style={[styles.memoryDot, { backgroundColor: mem.status === 'active' ? '#10B981' : mem.status === 'superseded' ? '#F59E0B' : '#9CA3AF' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memoryContent}>{mem.content}</Text>
                    <View style={styles.memoryMeta}>
                      {(mem as any).similarity !== undefined && (
                        <Text style={styles.matchBadge}>{((mem as any).similarity * 100).toFixed(0)}%</Text>
                      )}
                      {mem.category ? <Text style={styles.categoryBadge}>{mem.category}</Text> : null}
                      <Text style={styles.metaText}>⬆{(mem.importanceScore * 10).toFixed(0)}%</Text>
                      <Text style={styles.metaText}>{mem.accessCount}x</Text>
                      <Text style={styles.metaText}>{new Date(mem.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => handleDelete(mem.id)} style={styles.deleteBtn}>
                    <Text style={{ color: '#EF4444', fontSize: 14 }}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* Sessions Tab */}
      {tab === 'sessions' && (
        <View style={styles.section}>
          {sessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={styles.emptyText}>No session summaries yet</Text>
            </View>
          ) : (
            sessions.map((s) => (
              <View key={s.id} style={styles.memoryCard}>
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionDate}>{new Date(s.sessionStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                  <Text style={styles.matchBadge}>{s.messageCount} msgs</Text>
                </View>
                {s.keyTopics ? <Text style={styles.topicsText}>{s.keyTopics}</Text> : null}
                <Text style={styles.summaryText}>{s.summary}</Text>
              </View>
            ))
          )}
        </View>
      )}

      {/* Changelog Tab */}
      {tab === 'changelog' && (
        <View style={styles.section}>
          {changelog.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyText}>No profile changes logged</Text>
            </View>
          ) : (
            changelog.map((entry) => (
              <View key={entry.id} style={styles.memoryCard}>
                <View style={styles.changelogHeader}>
                  <Text style={styles.changelogField}>{entry.field.toUpperCase()}</Text>
                  <Text style={[styles.matchBadge, { backgroundColor: entry.source === 'core_chat' ? '#EDE9FE' : '#DBEAFE' }]}>
                    {entry.source === 'core_chat' ? 'Core Chat' : 'Manual'}
                  </Text>
                  <Text style={styles.metaText}>{new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                </View>
                {entry.oldValue ? <Text style={styles.oldValue}>{entry.oldValue}</Text> : null}
                <Text style={styles.newValue}>{entry.newValue}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl + 44, paddingBottom: Spacing.md },
  title: { fontSize: FontSize['2xl'], fontWeight: '700', color: colors.text },
  subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
  statsRow: { flexDirection: 'row', paddingHorizontal: Spacing.xl, gap: Spacing.md, marginBottom: Spacing.md },
  statCard: { flex: 1, backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark) },
  statNumber: { fontSize: FontSize.lg, fontWeight: '700', color: colors.primary[600] },
  statLabel: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', marginHorizontal: Spacing.xl, backgroundColor: colors.gray[100], borderRadius: BorderRadius.lg, padding: 4, marginBottom: Spacing.md },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.primary[600] },
  section: { paddingHorizontal: Spacing.xl },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm, ...neonSoft(colors, isDark) },
  searchInput: { flex: 1, paddingVertical: Spacing.sm, fontSize: FontSize.sm, color: colors.text },
  clearBtn: { padding: Spacing.xs },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  actionBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: '600' },
  searchLabel: { fontSize: FontSize.xs, color: colors.primary[500], fontWeight: '600', marginBottom: Spacing.sm },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl * 2 },
  emptyEmoji: { fontSize: 32, marginBottom: Spacing.sm },
  emptyText: { fontSize: FontSize.sm, color: colors.textMuted },
  memoryCard: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  memoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  memoryDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  memoryContent: { fontSize: FontSize.sm, color: colors.text, lineHeight: 20 },
  memoryMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  matchBadge: { backgroundColor: isDark ? 'rgba(99,102,241,0.22)' : '#EEF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontSize: 10, fontWeight: '700', color: isDark ? '#A5B4FC' : '#4F46E5' },
  categoryBadge: { backgroundColor: isDark ? 'rgba(167,139,250,0.22)' : '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontSize: 10, fontWeight: '700', color: isDark ? '#DDD6FE' : '#7C3AED' },
  metaText: { fontSize: 10, color: colors.textMuted },
  deleteBtn: { padding: Spacing.xs },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  sessionDate: { fontSize: FontSize.xs, fontWeight: '700', color: colors.text },
  topicsText: { fontSize: 11, color: colors.purple[500], fontWeight: '500', marginBottom: 4 },
  summaryText: { fontSize: FontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  changelogHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  changelogField: { fontSize: 11, fontWeight: '700', color: colors.text },
  oldValue: { fontSize: FontSize.xs, color: '#F87171', textDecorationLine: 'line-through', marginBottom: 2 },
  newValue: { fontSize: FontSize.sm, color: colors.text },
})
