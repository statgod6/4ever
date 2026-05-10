import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import * as Contacts from 'expo-contacts'
import { useNavigation } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { relationshipsApi } from '../api/relationships'
import { connectionsApi } from '../api/messaging'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'

type DeviceContact = {
  id: string
  name: string
  phone: string           // normalized: digits + leading '+' if present
  displayPhone: string    // original format for display
  on4Ever: boolean
  connectionStatus: string | null
}

const RELATIONSHIP_TYPES = [
  'Parent', 'Sibling', 'Partner', 'Spouse', 'Child',
  'Friend', 'Close Friend', 'Colleague', 'Boss', 'Mentor', 'Mentee', 'Other',
]

const normalizePhone = (raw: string): { normalized: string; display: string } => {
  const display = raw.trim()
  const cleaned = display.replace(/[\s\-()]/g, '')
  return { normalized: cleaned, display }
}

export default function ContactsPickerScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<any>()

  const [loading, setLoading] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [contacts, setContacts] = useState<DeviceContact[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | '4ever'>('all')

  // Picker modal for picking relationship type before saving
  const [picked, setPicked] = useState<DeviceContact | null>(null)
  const [relationship, setRelationship] = useState('Friend')
  const [saving, setSaving] = useState(false)

  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      const { status } = await Contacts.requestPermissionsAsync()
      if (status !== 'granted') {
        setPermissionDenied(true)
        setLoading(false)
        return
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        pageSize: 1000,
      })

      // Flatten: one row per phone number, dedupe by normalized number
      const map = new Map<string, DeviceContact>()
      for (const c of data) {
        const name = (c.name || '').trim()
        if (!name || !c.phoneNumbers?.length) continue
        for (const p of c.phoneNumbers) {
          if (!p.number) continue
          const { normalized, display } = normalizePhone(p.number)
          if (!normalized || normalized.replace(/\D/g, '').length < 7) continue
          if (map.has(normalized)) continue
          map.set(normalized, {
            id: `${c.id}-${normalized}`,
            name,
            phone: normalized,
            displayPhone: display,
            on4Ever: false,
            connectionStatus: null,
          })
        }
      }
      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))

      // Discover which ones are on 4Ever (batched — one HTTP call)
      try {
        const phones = list.map((c) => c.phone)
        // Cap to 500 per call to avoid over-large payloads
        const chunks: string[][] = []
        for (let i = 0; i < phones.length; i += 500) chunks.push(phones.slice(i, i + 500))
        for (const chunk of chunks) {
          const found = await (await import('../api/client')).default.post('/connections/discover', { phoneNumbers: chunk })
            .then((r) => r.data as Array<{ id: string; name: string; phoneNumber: string; connectionStatus: string | null }>)
            .catch(() => [])
          for (const user of found) {
            // Match by last 10 digits against our list
            const last10 = user.phoneNumber.replace(/\D/g, '').slice(-10)
            for (const item of list) {
              if (item.phone.replace(/\D/g, '').slice(-10) === last10) {
                item.on4Ever = true
                item.connectionStatus = user.connectionStatus
              }
            }
          }
        }
      } catch {}

      setContacts(list)
    } catch {
      showToast('Could not load contacts', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadContacts() }, [loadContacts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = contacts
    if (filter === '4ever') list = list.filter((c) => c.on4Ever)
    if (q) {
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
      )
    }
    return list
  }, [contacts, search, filter])

  const on4EverCount = useMemo(() => contacts.filter((c) => c.on4Ever).length, [contacts])

  const handleSave = async () => {
    if (!picked) return
    setSaving(true)
    try {
      const person = await relationshipsApi.create({
        name: picked.name,
        relationship,
        phoneNumber: picked.phone,
      })
      showToast(`${person.name} added to your Circle`, 'success')
      setPicked(null)
      setRelationship('Friend')
      // Remove from list so user can see progress
      setContacts((prev) => prev.filter((c) => c.id !== picked.id))
    } catch {
      showToast('Failed to add', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleQuickAdd = async (c: DeviceContact) => {
    try {
      // 1. Save to Circle with default relationship (user can change later by tapping the person).
      const person = await relationshipsApi.create({
        name: c.name,
        relationship: 'Friend',
        phoneNumber: c.phone,
      })
      // 2. If they're on 4Ever, auto-send a connection request (unless already connected/pending).
      if (c.on4Ever) {
        try {
          const res = await connectionsApi.resolvePhone(c.phone)
          if (res.user && !res.connectionStatus) {
            await connectionsApi.sendRequest(res.user.id)
            showToast(`${person.name} added · request sent`, 'success')
          } else if (res.connectionStatus === 'accepted') {
            showToast(`${person.name} added · already connected`, 'success')
          } else if (res.connectionStatus === 'pending') {
            showToast(`${person.name} added · request pending`, 'success')
          } else {
            showToast(`${person.name} added to your Circle`, 'success')
          }
        } catch {
          showToast(`${person.name} added to your Circle`, 'success')
        }
      } else {
        showToast(`${person.name} added · invite them from their card`, 'success')
      }
      // Remove from list (visual progress feedback)
      setContacts((prev) => prev.filter((x) => x.id !== c.id))
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Failed to add', 'error')
    }
  }

  const handleConnect = async (c: DeviceContact) => {
    try {
      const res = await connectionsApi.resolvePhone(c.phone)
      if (!res.user) {
        showToast('Not on 4Ever yet', 'info')
        return
      }
      if (res.connectionStatus === 'accepted') {
        showToast(`Already connected with ${res.user.name}`, 'info')
        return
      }
      if (res.connectionStatus === 'pending') {
        showToast('Request already pending', 'info')
        return
      }
      await connectionsApi.sendRequest(res.user.id)
      showToast(`Request sent to ${res.user.name}`, 'success')
      setContacts((prev) => prev.map((p) => p.id === c.id ? { ...p, connectionStatus: 'pending' } : p))
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Could not send request', 'error')
    }
  }

  const renderItem = ({ item }: { item: DeviceContact }) => (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: item.on4Ever ? colors.primary[100] : colors.gray[100] }]}>
        <Text style={[styles.avatarText, { color: item.on4Ever ? colors.primary[600] : colors.gray[600] }]}>
          {item.name[0]?.toUpperCase() || '?'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          {item.on4Ever && (
            <View style={styles.badge4Ever}>
              <Text style={styles.badge4EverText}>4Ever</Text>
            </View>
          )}
        </View>
        <Text style={styles.rowPhone} numberOfLines={1}>{item.displayPhone}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {item.on4Ever && item.connectionStatus !== 'accepted' && (
          <TouchableOpacity style={styles.connectBtn} onPress={() => handleConnect(item)} activeOpacity={0.8}>
            <Text style={styles.connectBtnText}>
              {item.connectionStatus === 'pending' ? 'Pending' : 'Connect'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.addBtn} onPress={() => handleQuickAdd(item)} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>＋ Add</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  if (permissionDenied) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: Spacing.xl }]}>
        <Text style={{ fontSize: 48, marginBottom: Spacing.md }}>📵</Text>
        <Text style={[styles.headerTitle, { textAlign: 'center', marginBottom: Spacing.sm }]}>Contacts permission needed</Text>
        <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg }}>
          Allow 4Ever to read your contacts from Settings to import them into your Circle.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={loadContacts} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={isDark ? ['#1e3a8a', '#831843'] : ['#0ea5e9', '#ec4899']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + Spacing.md }]}
      >
        <Text style={styles.heroEyebrow}>📇  Contacts</Text>
        <Text style={styles.heroTitle}>Import from Contacts</Text>
        <Text style={styles.heroSubtitle}>
          {loading ? 'Loading…' : `${contacts.length} contacts · ${on4EverCount} on 4Ever`}
        </Text>

        <TextInput
          style={styles.searchInput}
          placeholder="Search name or number"
          placeholderTextColor="rgba(255,255,255,0.7)"
          value={search}
          onChangeText={setSearch}
        />

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterChipText, filter === 'all' && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, filter === '4ever' && styles.filterChipActive]}
            onPress={() => setFilter('4ever')}
          >
            <Text style={[styles.filterChipText, filter === '4ever' && styles.filterChipTextActive]}>
              On 4Ever ({on4EverCount})
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
          <Text style={{ color: colors.textSecondary, marginTop: Spacing.md }}>Reading your contacts…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />}
          ListEmptyComponent={
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
              {search ? 'No matches' : 'No contacts found'}
            </Text>
          }
        />
      )}

      {/* Relationship picker modal */}
      <Modal visible={!!picked} animationType="slide" transparent onRequestClose={() => setPicked(null)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setPicked(null)} />
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <Text style={styles.sheetTitle}>Add {picked?.name} to Circle</Text>
          <Text style={styles.sheetSubtitle}>{picked?.displayPhone}</Text>

          <Text style={styles.formLabel}>Relationship</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
            {RELATIONSHIP_TYPES.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.typeChip, relationship === r && styles.typeChipActive]}
                onPress={() => setRelationship(r)}
              >
                <Text style={[styles.typeChipText, relationship === r && styles.typeChipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : `Add to Circle`}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: Spacing.md, alignItems: 'center' }} onPress={() => setPicked(null)} disabled={saving}>
            <Text style={{ color: colors.textSecondary }}>Cancel</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  hero: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl + 8,
    borderBottomRightRadius: BorderRadius.xl + 8,
  },
  heroEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroTitle: { fontSize: FontSize['2xl'], color: '#fff', fontWeight: '800', letterSpacing: -0.5 },
  heroSubtitle: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.92)', marginTop: 2, marginBottom: Spacing.md },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: Spacing.md },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  filterChipActive: { backgroundColor: '#fff' },
  filterChipText: { color: '#fff', fontWeight: '600', fontSize: FontSize.xs },
  filterChipTextActive: { color: '#0284c7' },

  headerTitle: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FontSize.lg, fontWeight: '700' },
  rowName: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, flexShrink: 1 },
  rowPhone: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2 },
  badge4Ever: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  badge4EverText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  connectBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.primary[500],
    borderRadius: BorderRadius.full,
  },
  connectBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.xs },
  addBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: colors.primary[500],
  },
  addBtnText: { color: colors.primary[500], fontWeight: '700', fontSize: FontSize.xs },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xl + 20,
  },
  handleBar: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sheetSubtitle: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center', marginTop: 2, marginBottom: Spacing.lg },

  formLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },

  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: colors.gray[100],
    marginRight: 8,
  },
  typeChipActive: { backgroundColor: colors.primary[500] },
  typeChipText: { color: colors.text, fontWeight: '600', fontSize: FontSize.sm },
  typeChipTextActive: { color: '#fff' },

  primaryBtn: {
    backgroundColor: colors.primary[500],
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },
})
