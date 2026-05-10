import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import Slider from '@react-native-community/slider'
import { tensionsApi, type TensionEntry, type CreateTensionData } from '../api/tensions'
import { type RelationshipPerson } from '../api/relationships'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import { useFocusEffect } from '@react-navigation/native'

const COOL_DOWN_OPTIONS = [
  { value: 0, label: 'No cool-down' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
]

interface Props { people: RelationshipPerson[] }

export default function TensionsTab({ people }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [tensions, setTensions] = useState<TensionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateTensionData>({ title: '', description: '', intensity: 5 })
  const [formPersonId, setFormPersonId] = useState<string | undefined>()
  const [formCoolDown, setFormCoolDown] = useState(0)

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolveInput, setResolveInput] = useState('')

  const load = useCallback(async () => {
    try { const d = await tensionsApi.getAll(); setTensions(d) } catch {} finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const handleCreate = async () => {
    if (!form.title.trim() || !form.description.trim()) { showToast('Title and description required', 'error'); return }
    try {
      const created = await tensionsApi.create({
        ...form, personId: formPersonId,
        coolDownMinutes: formCoolDown || undefined,
      })
      setTensions((prev) => [created, ...prev])
      resetForm()
      showToast(`"${created.title}" logged`, 'success')
    } catch { showToast('Failed to log tension', 'error') }
  }

  const handleCoolDown = async (id: string) => {
    try {
      const updated = await tensionsApi.startCoolDown(id, 30)
      setTensions((prev) => prev.map((t) => t.id === id ? updated : t))
      showToast('Cool-down started (30 min)', 'success')
    } catch { showToast('Failed', 'error') }
  }

  const handleResolve = async (id: string) => {
    try {
      const updated = await tensionsApi.resolve(id, resolveInput || undefined)
      setTensions((prev) => prev.map((t) => t.id === id ? updated : t))
      setResolvingId(null); setResolveInput('')
      showToast('Resolved', 'success')
    } catch { showToast('Failed', 'error') }
  }

  const handleRemove = async (id: string) => {
    try { await tensionsApi.remove(id); setTensions((prev) => prev.filter((t) => t.id !== id)); showToast('Removed', 'success') }
    catch { showToast('Failed', 'error') }
  }

  const resetForm = () => { setForm({ title: '', description: '', intensity: 5 }); setFormPersonId(undefined); setFormCoolDown(0); setShowForm(false) }

  const getCoolDownRemaining = (t: TensionEntry): string | null => {
    if (t.status !== 'cooling_down' || !t.coolDownUntil) return null
    const rem = new Date(t.coolDownUntil).getTime() - Date.now()
    if (rem <= 0) return null
    const mins = Math.ceil(rem / 60000)
    return mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  }

  const getIntensityColor = (i: number) => i >= 7 ? '#EF4444' : i >= 4 ? '#F59E0B' : '#FACC15'
  const getIntensityBg = (i: number) => {
    if (isDark) {
      return i >= 7 ? 'rgba(239,68,68,0.18)' : i >= 4 ? 'rgba(245,158,11,0.18)' : 'rgba(250,204,21,0.18)'
    }
    return i >= 7 ? '#FEE2E2' : i >= 4 ? '#FEF3C7' : '#FEF9C3'
  }

  const renderTension = ({ item }: { item: TensionEntry }) => {
    const coolDown = getCoolDownRemaining(item)
    const isResolved = item.status === 'resolved'
    const isCooling = item.status === 'cooling_down'
    return (
      <View style={[
        styles.card,
        isResolved && { opacity: 0.6 },
        !isResolved && { borderLeftWidth: 4, borderLeftColor: isCooling ? '#3B82F6' : colors.red[500] },
      ]}>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={styles.title}>{item.title}</Text>
            {item.person && <View style={styles.personBadge}><Text style={styles.personBadgeText}>{item.person.name}</Text></View>}
            <View style={[styles.intensityBadge, { backgroundColor: getIntensityBg(item.intensity) }]}>
              <Text style={[styles.intensityText, { color: getIntensityColor(item.intensity) }]}>{item.intensity}/10</Text>
            </View>
            {isCooling && coolDown && (
              <View style={styles.coolBadge}><Text style={styles.coolBadgeText}>⏱ {coolDown}</Text></View>
            )}
            {isResolved && (
              <View style={styles.resolvedBadge}><Text style={styles.resolvedBadgeText}>✓ Resolved</Text></View>
            )}
          </View>
          <Text style={styles.desc} numberOfLines={3}>{item.description}</Text>
          {item.resolution && (
            <View style={styles.resolutionBox}><Text style={styles.resolutionText}>Resolution: {item.resolution}</Text></View>
          )}
          <Text style={styles.meta}>
            {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>

        {!isResolved && (
          <View style={styles.actions}>
            {!isCooling && (
              <TouchableOpacity style={styles.coolBtn} onPress={() => handleCoolDown(item.id)}>
                <Text style={styles.coolBtnText}>⏱ Cool</Text>
              </TouchableOpacity>
            )}
            {resolvingId === item.id ? (
              <View>
                <TextInput style={styles.resolveInput} value={resolveInput} onChangeText={setResolveInput} placeholder="How resolved?" placeholderTextColor={colors.textMuted} autoFocus />
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                  <TouchableOpacity style={styles.resolveSaveBtn} onPress={() => handleResolve(item.id)}>
                    <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700' }}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setResolvingId(null); setResolveInput('') }} style={styles.resolveXBtn}>
                    <Text style={{ fontSize: 10, color: colors.textSecondary }}>X</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.resolveBtn} onPress={() => setResolvingId(item.id)}>
                <Text style={styles.resolveBtnText}>✓ Resolve</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleRemove(item.id)} style={{ padding: 4 }}>
              <Text style={{ color: colors.red[500], fontSize: 14 }}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.red[500]} /></View>

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={tensions}
        renderItem={renderTension}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.red[500]} />}
        ListEmptyComponent={<EmptyState icon="⚡" title="No tensions logged" subtitle="When conflicts arise, log them here to process before reacting" />}
        ListHeaderComponent={
          <TouchableOpacity style={styles.addRow} onPress={() => setShowForm(true)}>
            <Text style={styles.addRowText}>+ Log Tension</Text>
          </TouchableOpacity>
        }
      />

      {/* Create Tension Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={resetForm}>
        <Pressable style={styles.overlay} onPress={resetForm} />
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Log a Tension</Text>
            <TouchableOpacity onPress={resetForm}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>What's the tension? *</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="e.g., Disagreement about finances" placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Describe what happened *</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} placeholder="Write freely. This helps process the emotion..." placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.label}>Person involved</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              <TouchableOpacity style={[styles.chip, !formPersonId && styles.chipActive]} onPress={() => setFormPersonId(undefined)}>
                <Text style={[styles.chipText, !formPersonId && styles.chipTextActive]}>None</Text>
              </TouchableOpacity>
              {people.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, formPersonId === p.id && styles.chipActive]} onPress={() => setFormPersonId(p.id)}>
                  <Text style={[styles.chipText, formPersonId === p.id && styles.chipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Intensity: {form.intensity ?? 5}</Text>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Mild</Text>
              <Slider
                style={{ flex: 1, height: 30 }}
                minimumValue={1} maximumValue={10} step={1}
                value={form.intensity ?? 5}
                onValueChange={(v: number) => setForm({ ...form, intensity: v })}
                minimumTrackTintColor={colors.red[500]}
                maximumTrackTintColor={colors.gray[200]}
                thumbTintColor={colors.red[500]}
              />
              <Text style={styles.sliderLabel}>Intense</Text>
            </View>

            <Text style={styles.label}>Cool-down timer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
              {COOL_DOWN_OPTIONS.map((o) => (
                <TouchableOpacity key={o.value} style={[styles.chip, formCoolDown === o.value && styles.chipActive]} onPress={() => setFormCoolDown(o.value)}>
                  <Text style={[styles.chipText, formCoolDown === o.value && styles.chipTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
              <Text style={styles.submitBtnText}>Log Tension</Text>
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
  addRow: { backgroundColor: isDark ? 'rgba(239,68,68,0.14)' : '#FEF2F2', borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center', marginBottom: Spacing.md, borderWidth: 1, borderColor: isDark ? '#F87171' : '#FECACA', borderStyle: 'dashed', ...(isDark ? { shadowColor: '#F87171', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  addRowText: { color: isDark ? '#FCA5A5' : colors.red[600], fontWeight: '700', fontSize: FontSize.sm },

  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: Spacing.md, ...neonCard(colors, isDark, 'red') },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  title: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  personBadge: { backgroundColor: isDark ? 'rgba(244,114,182,0.18)' : '#FFE4E6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  personBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#FDA4AF' : '#E11D48' },
  intensityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  intensityText: { fontSize: 10, fontWeight: '700' },
  coolBadge: { backgroundColor: isDark ? 'rgba(59,130,246,0.2)' : '#DBEAFE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  coolBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#93C5FD' : '#2563EB' },
  resolvedBadge: { backgroundColor: isDark ? 'rgba(34,197,94,0.18)' : '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  resolvedBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#86EFAC' : '#16A34A' },
  desc: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 4 },
  resolutionBox: { backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : '#F0FDF4', borderRadius: BorderRadius.md, padding: Spacing.sm, marginTop: 6, ...(isDark ? { borderWidth: 1, borderColor: '#22C55E' } : null) },
  resolutionText: { fontSize: FontSize.xs, color: isDark ? '#86EFAC' : '#16A34A' },
  meta: { fontSize: 10, color: colors.textMuted, marginTop: 4 },

  actions: { alignItems: 'center', gap: 6 },
  coolBtn: { backgroundColor: isDark ? 'rgba(59,130,246,0.2)' : '#DBEAFE', paddingHorizontal: 8, paddingVertical: 6, borderRadius: BorderRadius.md },
  coolBtnText: { fontSize: 11, fontWeight: '700', color: isDark ? '#93C5FD' : '#2563EB' },
  resolveBtn: { backgroundColor: isDark ? 'rgba(34,197,94,0.18)' : '#DCFCE7', paddingHorizontal: 8, paddingVertical: 6, borderRadius: BorderRadius.md },
  resolveBtnText: { fontSize: 11, fontWeight: '700', color: isDark ? '#86EFAC' : '#16A34A' },
  resolveInput: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.sm, padding: 4, fontSize: 11, width: 80, color: colors.text, ...neonSoft(colors, isDark) },
  resolveSaveBtn: { backgroundColor: colors.green[500], paddingHorizontal: 8, paddingVertical: 4, borderRadius: BorderRadius.sm },
  resolveXBtn: { backgroundColor: colors.gray[200], paddingHorizontal: 6, paddingVertical: 4, borderRadius: BorderRadius.sm },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '85%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.xl, paddingBottom: 20, ...neonCard(colors, isDark, 'red') },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: colors.primary[500] },

  label: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: Spacing.md },
  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, textAlignVertical: 'top', ...neonSoft(colors, isDark) },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm },
  chipActive: { backgroundColor: isDark ? 'rgba(239,68,68,0.22)' : '#FEE2E2', ...(isDark ? { borderWidth: 1, borderColor: '#F87171' } : null) },
  chipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: isDark ? '#FCA5A5' : colors.red[600] },

  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sliderLabel: { fontSize: 10, color: colors.textMuted },

  submitBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.lg },
  submitBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
})
