import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { ritualsApi, type Ritual, type CreateRitualData } from '../api/rituals'
import { type RelationshipPerson } from '../api/relationships'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import { useFocusEffect } from '@react-navigation/native'

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly']

interface Props { people: RelationshipPerson[] }

export default function RitualsTab({ people }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [rituals, setRituals] = useState<Ritual[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateRitualData>({ title: '', frequency: 'weekly' })
  const [formPersonId, setFormPersonId] = useState<string | undefined>()

  const load = useCallback(async () => {
    try { const d = await ritualsApi.getAll(); setRituals(d) } catch {} finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const handleCreate = async () => {
    if (!form.title.trim()) { showToast('Title is required', 'error'); return }
    try {
      const created = await ritualsApi.create({ ...form, personId: formPersonId })
      setRituals((prev) => [{ ...created, isOverdue: true, nextDue: 'now' }, ...prev])
      resetForm()
      showToast(`"${created.title}" created`, 'success')
    } catch { showToast('Failed to create ritual', 'error') }
  }

  const handleComplete = async (id: string) => {
    try {
      const updated = await ritualsApi.complete(id)
      setRituals((prev) => prev.map((r) => r.id === id ? { ...r, ...updated, isOverdue: false } : r))
      showToast(`Streak: ${updated.streak}`, 'success')
    } catch { showToast('Failed to complete', 'error') }
  }

  const handleRemove = async (id: string) => {
    try { await ritualsApi.remove(id); setRituals((prev) => prev.filter((r) => r.id !== id)); showToast('Removed', 'success') }
    catch { showToast('Failed to remove', 'error') }
  }

  const resetForm = () => { setForm({ title: '', frequency: 'weekly' }); setFormPersonId(undefined); setShowForm(false) }

  const renderRitual = ({ item }: { item: Ritual }) => (
    <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: item.isOverdue ? colors.amber[500] : colors.green[500] }]}>
      <View style={{ flex: 1 }}>
        <View style={styles.row}>
          <Text style={styles.title}>{item.title}</Text>
          <View style={styles.freqBadge}><Text style={styles.freqBadgeText}>{item.frequency}</Text></View>
          {item.person && <View style={styles.personBadge}><Text style={styles.personBadgeText}>{item.person.name}</Text></View>}
        </View>
        <View style={[styles.row, { marginTop: 4 }]}>
          <Text style={styles.meta}>🔥 Streak: {item.streak}</Text>
          <Text style={[styles.meta, { marginLeft: 12 }]}>
            {item.isOverdue ? '⚠️ Overdue!' : `⏰ Next: ${item.nextDue === 'now' ? 'Now' : item.nextDue || '—'}`}
          </Text>
          {item.lastDoneAt && (
            <Text style={[styles.meta, { marginLeft: 12 }]}>
              Last: {new Date(item.lastDoneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.doneBtn} onPress={() => handleComplete(item.id)}>
          <Text style={styles.doneBtnText}>✓ Done</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleRemove(item.id)} style={styles.trashBtn}>
          <Text style={{ color: colors.red[500], fontSize: 16 }}>🗑</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary[500]} /></View>

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rituals}
        renderItem={renderRitual}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
        ListEmptyComponent={<EmptyState icon="🔄" title="No rituals yet" subtitle="Create recurring rituals to stay connected with your people" />}
        ListHeaderComponent={
          <TouchableOpacity style={styles.addRow} onPress={() => setShowForm(true)}>
            <Text style={styles.addRowText}>+ Create Ritual</Text>
          </TouchableOpacity>
        }
      />

      {/* Create Ritual Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={resetForm}>
        <Pressable style={styles.overlay} onPress={resetForm} />
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Create Ritual</Text>
            <TouchableOpacity onPress={resetForm}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Ritual Name *</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="e.g., Call Dad, Coffee with Sarah" placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Frequency</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              {FREQUENCIES.map((f) => (
                <TouchableOpacity key={f} style={[styles.chip, form.frequency === f && styles.chipActive]} onPress={() => setForm({ ...form, frequency: f })}>
                  <Text style={[styles.chipText, form.frequency === f && styles.chipTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Link to Person (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
              <TouchableOpacity style={[styles.chip, !formPersonId && styles.chipActive]} onPress={() => setFormPersonId(undefined)}>
                <Text style={[styles.chipText, !formPersonId && styles.chipTextActive]}>None</Text>
              </TouchableOpacity>
              {people.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, formPersonId === p.id && styles.chipActive]} onPress={() => setFormPersonId(p.id)}>
                  <Text style={[styles.chipText, formPersonId === p.id && styles.chipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
              <Text style={styles.submitBtnText}>Create Ritual</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: Spacing.xl, paddingTop: 4, paddingBottom: 120 },
  addRow: { backgroundColor: isDark ? 'rgba(56,189,248,0.14)' : colors.primary[50], borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center', marginBottom: Spacing.md, borderWidth: 1, borderColor: isDark ? '#38BDF8' : colors.primary[200], borderStyle: 'dashed', ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  addRowText: { color: isDark ? '#7DD3FC' : colors.primary[600], fontWeight: '700', fontSize: FontSize.sm },

  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...neonCard(colors, isDark, 'green') },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  title: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  freqBadge: { backgroundColor: isDark ? 'rgba(99,102,241,0.22)' : '#E0E7FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  freqBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#A5B4FC' : '#4338CA' },
  personBadge: { backgroundColor: isDark ? 'rgba(244,114,182,0.18)' : '#FFE4E6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  personBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#FDA4AF' : '#E11D48' },
  meta: { fontSize: 11, color: colors.textSecondary },
  actions: { flexDirection: 'column', gap: 6, alignItems: 'center' },
  doneBtn: { backgroundColor: colors.green[500], paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.md, ...(isDark ? { shadowColor: '#22C55E', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  doneBtnText: { color: '#ffffff', fontSize: FontSize.xs, fontWeight: '700' },
  trashBtn: { padding: 4 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.xl, paddingBottom: 20, ...neonCard(colors, isDark, 'green') },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: colors.primary[500] },

  label: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: Spacing.md },
  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, ...neonSoft(colors, isDark) },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm },
  chipActive: { backgroundColor: isDark ? 'rgba(99,102,241,0.22)' : '#E0E7FF', ...(isDark ? { borderWidth: 1, borderColor: '#A5B4FC' } : null) },
  chipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: isDark ? '#A5B4FC' : '#4338CA' },

  submitBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.lg },
  submitBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
})
