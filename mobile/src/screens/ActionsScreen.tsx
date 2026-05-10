import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Modal, TextInput, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native'
import { actionsApi, type ActionItem } from '../api/actions'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'

const DIMENSION_COLORS_LIGHT: Record<string, { bg: string; text: string }> = {
  Health: { bg: '#dcfce7', text: '#15803d' },
  Career: { bg: '#dbeafe', text: '#1d4ed8' },
  Relationships: { bg: '#fce7f3', text: '#be185d' },
  Finance: { bg: '#fef9c3', text: '#854d0e' },
  Learning: { bg: '#e0e7ff', text: '#4338ca' },
  Creativity: { bg: '#f3e8ff', text: '#7e22ce' },
  Spirituality: { bg: '#ccfbf1', text: '#0f766e' },
}
const DIMENSION_COLORS_DARK: Record<string, { bg: string; text: string }> = {
  Health: { bg: 'rgba(34,197,94,0.18)', text: '#4ADE80' },
  Career: { bg: 'rgba(59,130,246,0.18)', text: '#60A5FA' },
  Relationships: { bg: 'rgba(236,72,153,0.18)', text: '#F472B6' },
  Finance: { bg: 'rgba(234,179,8,0.18)', text: '#FACC15' },
  Learning: { bg: 'rgba(99,102,241,0.18)', text: '#818CF8' },
  Creativity: { bg: 'rgba(168,85,247,0.18)', text: '#C084FC' },
  Spirituality: { bg: 'rgba(20,184,166,0.18)', text: '#2DD4BF' },
}

export default function ActionsScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const dimPalette = isDark ? DIMENSION_COLORS_DARK : DIMENSION_COLORS_LIGHT
  const [actions, setActions] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | undefined>('pending')

  // Planner modal state
  const [plannerModal, setPlannerModal] = useState<{ itemId: string; content: string } | null>(null)
  const [plannerDate, setPlannerDate] = useState(() => new Date().toISOString().split('T')[0])
  const [plannerTimeSlot, setPlannerTimeSlot] = useState('')
  const [plannerSaving, setPlannerSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const data = await actionsApi.getActionItems(filter); setActions(data) } catch {} finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  const handleMarkDone = async (id: string) => {
    try {
      await actionsApi.updateActionStatus(id, 'done')
      setActions((prev) => prev.filter((a) => a.id !== id))
      showToast('Action item completed', 'success')
    } catch { showToast('Failed to update', 'error') }
  }

  const handleDismiss = async (id: string) => {
    try {
      await actionsApi.updateActionStatus(id, 'dismissed')
      setActions((prev) => prev.filter((a) => a.id !== id))
      showToast('Action dismissed', 'success')
    } catch { showToast('Failed to dismiss', 'error') }
  }

  const handleAddToPlanner = async () => {
    if (!plannerModal || !plannerTimeSlot.trim()) return
    setPlannerSaving(true)
    try {
      await actionsApi.linkToPlanner(plannerModal.itemId, plannerDate, plannerTimeSlot)
      setActions((prev) => prev.filter((a) => a.id !== plannerModal.itemId))
      setPlannerModal(null)
      setPlannerTimeSlot('')
      showToast('Added to planner', 'success')
    } catch { showToast('Failed to add to planner', 'error') } finally { setPlannerSaving(false) }
  }

  // Group by thought
  const grouped = actions.reduce<Record<string, ActionItem[]>>((acc, item) => {
    const key = item.thoughtTitle || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const renderItem = ({ item }: { item: [string, ActionItem[]] }) => {
    const [thoughtTitle, groupItems] = item
    return (
      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupHeaderIcon}>✦</Text>
          <Text style={styles.groupHeaderText}>From: {thoughtTitle}</Text>
        </View>
        {groupItems.map((action) => (
          <View key={action.id} style={[styles.card, action.status === 'done' && styles.cardDone]}>
            <View style={styles.cardContent}>
              <Text style={[styles.content, action.status === 'done' && styles.contentDone]}>{action.content}</Text>
              <View style={styles.metaRow}>
                {action.dimension && (
                  <View style={[styles.dimBadge, { backgroundColor: dimPalette[action.dimension]?.bg || colors.gray[100] }]}>
                    <Text style={[styles.dimText, { color: dimPalette[action.dimension]?.text || colors.textSecondary }]}>{action.dimension}</Text>
                  </View>
                )}
                {action.personaName ? (
                  <Text style={styles.meta}>via {action.personaName}</Text>
                ) : !action.threadId ? (
                  <Text style={styles.metaCore}>🧠 4Ever Core</Text>
                ) : null}
                <Text style={styles.metaDate}>{new Date(action.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
              </View>
            </View>
            {action.status === 'pending' && (
              <View style={styles.actionBtns}>
                <TouchableOpacity style={styles.btnDone} onPress={() => handleMarkDone(action.id)}>
                  <Text style={styles.btnDoneText}>✓</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnCalendar} onPress={() => setPlannerModal({ itemId: action.id, content: action.content })}>
                  <Text style={styles.btnCalendarText}>📅</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnDismiss} onPress={() => handleDismiss(action.id)}>
                  <Text style={styles.btnDismissText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    )
  }

  const groupedEntries = Object.entries(grouped)

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Action Items</Text>
      <Text style={styles.subtitle}>Tasks extracted from persona responses</Text>
      <View style={styles.filterRow}>
        {[{ key: 'pending', label: 'Pending' }, { key: undefined as string | undefined, label: 'All' }, { key: 'done', label: 'Done' }].map((f) => (
          <TouchableOpacity key={f.label} style={[styles.filterChip, filter === f.key && styles.filterActive]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={groupedEntries}
        keyExtractor={(item) => item[0]}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary[500]} />}
        ListEmptyComponent={!loading ? <EmptyState icon="✅" title={filter === 'pending' ? 'All caught up!' : 'No actions'} subtitle={filter === 'pending' ? 'Submit thoughts to generate new action items.' : 'Action items from your conversations will appear here'} /> : null}
        renderItem={renderItem}
      />

      {/* Add to Planner Modal */}
      <Modal visible={!!plannerModal} transparent animationType="fade" onRequestClose={() => setPlannerModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add to Day Planner</Text>
            {plannerModal && <Text style={styles.modalSubtitle} numberOfLines={2}>{plannerModal.content}</Text>}
            <Text style={styles.inputLabel}>Date</Text>
            <TextInput style={styles.input} value={plannerDate} onChangeText={setPlannerDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
            <Text style={styles.inputLabel}>Time Slot</Text>
            <TextInput style={styles.input} value={plannerTimeSlot} onChangeText={setPlannerTimeSlot} placeholder="e.g. 9:00 - 10:00 AM" placeholderTextColor={colors.textMuted} />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setPlannerModal(null); setPlannerTimeSlot('') }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSubmit, (!plannerTimeSlot.trim() || plannerSaving) && { opacity: 0.5 }]} onPress={handleAddToPlanner} disabled={!plannerTimeSlot.trim() || plannerSaving}>
                {plannerSaving ? <ActivityIndicator size="small" color={colors.card} /> : <Text style={styles.modalSubmitText}>Add to Plan</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, paddingHorizontal: Spacing.xl, marginTop: 2 },
  filterRow: { flexDirection: 'row', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, gap: Spacing.sm },
  filterChip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100] },
  filterActive: { backgroundColor: colors.primary[500] },
  filterText: { fontSize: FontSize.sm, color: colors.textSecondary },
  filterTextActive: { color: '#ffffff', fontWeight: '600' },
  list: { padding: Spacing.xl, paddingTop: 0, paddingBottom: 120 },
  group: { marginBottom: Spacing.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  groupHeaderIcon: { fontSize: 12, color: colors.textMuted },
  groupHeaderText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },
  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  cardDone: { opacity: 0.5 },
  cardContent: { flex: 1 },
  content: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  contentDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  dimBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.full },
  dimText: { fontSize: 11, fontWeight: '600' },
  meta: { fontSize: FontSize.xs, color: colors.textMuted },
  metaCore: { fontSize: FontSize.xs, color: isDark ? '#F59E0B' : '#d97706', fontWeight: '600' },
  metaDate: { fontSize: FontSize.xs, color: colors.gray[400] },
  actionBtns: { flexDirection: 'row', gap: 8, marginTop: Spacing.sm },
  btnDone: { width: 36, height: 36, borderRadius: BorderRadius.md, backgroundColor: isDark ? 'rgba(34,197,94,0.16)' : '#ecfdf5', justifyContent: 'center', alignItems: 'center', ...(isDark ? { shadowColor: '#22C55E', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 2 } : null) },
  btnDoneText: { fontSize: 16, color: isDark ? '#4ADE80' : '#059669', fontWeight: '700' },
  btnCalendar: { width: 36, height: 36, borderRadius: BorderRadius.md, backgroundColor: colors.primary[50], justifyContent: 'center', alignItems: 'center' },
  btnCalendarText: { fontSize: 16 },
  btnDismiss: { width: 36, height: 36, borderRadius: BorderRadius.md, backgroundColor: colors.gray[100], justifyContent: 'center', alignItems: 'center' },
  btnDismissText: { fontSize: 14, color: colors.gray[400], fontWeight: '700' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  modalCard: { backgroundColor: colors.card, borderRadius: BorderRadius.xl, padding: Spacing.xl, width: '100%', maxWidth: 400, ...neonCard(colors, isDark, 'violet') },
  modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.lg },
  inputLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  input: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.base, color: colors.text, marginBottom: Spacing.md, ...neonSoft(colors, isDark) },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.md, marginTop: Spacing.md },
  modalCancel: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  modalCancelText: { fontSize: FontSize.base, color: colors.textSecondary },
  modalSubmit: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: colors.primary[500] },
  modalSubmitText: { fontSize: FontSize.base, color: '#ffffff', fontWeight: '600' },
})
