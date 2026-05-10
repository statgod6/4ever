import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Switch,
  RefreshControl, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { lifeEventsApi, type LifeEvent, type CreateLifeEventData } from '../api/lifeEvents'
import { type RelationshipPerson } from '../api/relationships'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import { useFocusEffect } from '@react-navigation/native'

const EVENT_TYPES = ['birthday', 'anniversary', 'graduation', 'surgery', 'interview', 'move', 'milestone', 'other']

interface Props { people: RelationshipPerson[] }

export default function LifeEventsTab({ people }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [events, setEvents] = useState<LifeEvent[]>([])
  const [upcoming, setUpcoming] = useState<LifeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateLifeEventData>({ title: '', eventDate: '', eventType: 'birthday' })
  const [formPersonId, setFormPersonId] = useState<string | undefined>()

  const load = useCallback(async () => {
    try {
      const [all, up] = await Promise.all([lifeEventsApi.getAll(), lifeEventsApi.getUpcoming(60)])
      setEvents(all.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()))
      setUpcoming(up)
    } catch {} finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const handleCreate = async () => {
    if (!form.title.trim() || !form.eventDate.trim()) { showToast('Title and date required', 'error'); return }
    try {
      const created = await lifeEventsApi.create({ ...form, personId: formPersonId })
      setEvents((prev) => [...prev, created].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()))
      resetForm()
      load() // refresh upcoming
      showToast(`"${created.title}" added`, 'success')
    } catch { showToast('Failed to create event', 'error') }
  }

  const handleRemove = async (id: string) => {
    try {
      await lifeEventsApi.remove(id)
      setEvents((prev) => prev.filter((e) => e.id !== id))
      setUpcoming((prev) => prev.filter((e) => e.id !== id))
      showToast('Removed', 'success')
    } catch { showToast('Failed to remove', 'error') }
  }

  const resetForm = () => { setForm({ title: '', eventDate: '', eventType: 'birthday' }); setFormPersonId(undefined); setShowForm(false) }

  const daysUntil = (dateStr: string) => Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)

  const renderUpcoming = (event: LifeEvent) => {
    const displayDate = event.nextOccurrence || event.eventDate
    const days = daysUntil(displayDate)
    const d = new Date(displayDate)
    return (
      <View key={event.id + '-up'} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: colors.purple[500] }]}>
        <View style={styles.dateBadge}>
          <Text style={styles.dateMonth}>{d.toLocaleDateString('en-US', { month: 'short' })}</Text>
          <Text style={styles.dateDay}>{d.getUTCDate()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={styles.title}>{event.title}</Text>
            <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{event.eventType}</Text></View>
            {event.isRecurring && <View style={styles.yearlyBadge}><Text style={styles.yearlyBadgeText}>Yearly</Text></View>}
            {event.person && <View style={styles.personBadge}><Text style={styles.personBadgeText}>{event.person.name}</Text></View>}
          </View>
          <Text style={styles.meta}>
            {days <= 0 ? 'Today!' : days === 1 ? 'Tomorrow!' : `In ${days} days`}
            {event.note ? ` — ${event.note}` : ''}
          </Text>
        </View>
        <Text style={{ fontSize: 18, opacity: days <= 3 ? 1 : 0.4 }}>{days <= 3 ? '🎁' : '📅'}</Text>
      </View>
    )
  }

  const renderEvent = ({ item }: { item: LifeEvent }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <View style={styles.row}>
          <Text style={styles.title}>{item.title}</Text>
          <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{item.eventType}</Text></View>
          {item.isRecurring && <View style={styles.yearlyBadge}><Text style={styles.yearlyBadgeText}>Yearly</Text></View>}
          {item.person && <View style={styles.personBadge}><Text style={styles.personBadgeText}>{item.person.name}</Text></View>}
        </View>
        <Text style={styles.meta}>
          {new Date(item.eventDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          {item.note ? ` — ${item.note}` : ''}
        </Text>
      </View>
      <TouchableOpacity onPress={() => handleRemove(item.id)} style={{ padding: 4 }}>
        <Text style={{ color: colors.red[500], fontSize: 16 }}>🗑</Text>
      </TouchableOpacity>
    </View>
  )

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.purple[500]} /></View>

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={events}
        renderItem={renderEvent}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple[500]} />}
        ListEmptyComponent={<EmptyState icon="📅" title="No life events yet" subtitle="Track birthdays, anniversaries, and milestones" />}
        ListHeaderComponent={
          <View>
            <TouchableOpacity style={styles.addRow} onPress={() => setShowForm(true)}>
              <Text style={styles.addRowText}>+ Add Life Event</Text>
            </TouchableOpacity>
            {upcoming.length > 0 && (
              <View style={{ marginBottom: Spacing.lg }}>
                <Text style={styles.sectionLabel}>UPCOMING (60 DAYS)</Text>
                {upcoming.map(renderUpcoming)}
              </View>
            )}
            {events.length > 0 && <Text style={styles.sectionLabel}>ALL EVENTS</Text>}
          </View>
        }
      />

      {/* Create Event Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={resetForm}>
        <Pressable style={styles.overlay} onPress={resetForm} />
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add Life Event</Text>
            <TouchableOpacity onPress={resetForm}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Event Title *</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="e.g., Dad's Birthday" placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Date * (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={form.eventDate} onChangeText={(v) => setForm({ ...form, eventDate: v })} placeholder="2026-06-15" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />

            <Text style={styles.label}>Event Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              {EVENT_TYPES.map((t) => (
                <TouchableOpacity key={t} style={[styles.chip, form.eventType === t && styles.chipActive]} onPress={() => setForm({ ...form, eventType: t })}>
                  <Text style={[styles.chipText, form.eventType === t && styles.chipTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Link to Person</Text>
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

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Recurring (yearly)</Text>
              <Switch value={form.isRecurring || false} onValueChange={(v) => setForm({ ...form, isRecurring: v })} trackColor={{ true: colors.primary[400] }} />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Remind days before</Text>
              <TextInput style={[styles.input, { width: 60, textAlign: 'center', padding: 6 }]} value={String(form.remindDaysBefore ?? 1)} onChangeText={(v) => setForm({ ...form, remindDaysBefore: parseInt(v) || 1 })} keyboardType="number-pad" />
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={[styles.input, { minHeight: 50 }]} value={form.note || ''} onChangeText={(v) => setForm({ ...form, note: v })} placeholder="Gift ideas, plans..." placeholderTextColor={colors.textMuted} multiline />

            <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
              <Text style={styles.submitBtnText}>Save Event</Text>
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
  addRow: { backgroundColor: isDark ? 'rgba(167,139,250,0.14)' : colors.purple[50], borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center', marginBottom: Spacing.md, borderWidth: 1, borderColor: isDark ? '#A78BFA' : colors.purple[100], borderStyle: 'dashed', ...(isDark ? { shadowColor: '#A78BFA', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  addRowText: { color: isDark ? '#DDD6FE' : colors.purple[600], fontWeight: '700', fontSize: FontSize.sm },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginBottom: Spacing.sm },

  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...neonCard(colors, isDark, 'violet') },
  dateBadge: { width: 44, height: 44, borderRadius: BorderRadius.lg, backgroundColor: colors.purple[500], alignItems: 'center', justifyContent: 'center', ...(isDark ? { shadowColor: '#A78BFA', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  dateMonth: { fontSize: 9, fontWeight: '700', color: '#ffffff', textTransform: 'uppercase' },
  dateDay: { fontSize: 18, fontWeight: '800', color: '#ffffff', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  title: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  typeBadge: { backgroundColor: isDark ? 'rgba(167,139,250,0.22)' : '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#DDD6FE' : '#7C3AED' },
  yearlyBadge: { backgroundColor: isDark ? 'rgba(59,130,246,0.22)' : '#DBEAFE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  yearlyBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#93C5FD' : '#2563EB' },
  personBadge: { backgroundColor: isDark ? 'rgba(244,114,182,0.18)' : '#FFE4E6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  personBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#FDA4AF' : '#E11D48' },
  meta: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '85%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.xl, paddingBottom: 20, ...neonCard(colors, isDark, 'violet') },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: colors.primary[500] },

  label: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: Spacing.md },
  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, textAlignVertical: 'top', ...neonSoft(colors, isDark) },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm },
  chipActive: { backgroundColor: isDark ? 'rgba(167,139,250,0.22)' : '#F3E8FF', ...(isDark ? { borderWidth: 1, borderColor: '#A78BFA' } : null) },
  chipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: isDark ? '#DDD6FE' : '#7C3AED' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
  toggleLabel: { fontSize: FontSize.sm, color: colors.text, fontWeight: '500' },

  submitBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.lg },
  submitBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
})
