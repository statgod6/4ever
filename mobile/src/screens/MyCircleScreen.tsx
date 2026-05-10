import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform,
  Alert, Linking,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { relationshipsApi, type RelationshipPerson } from '../api/relationships'
import { connectionsApi } from '../api/messaging'
import { useMessagingStore } from '../store/messagingStore'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import RitualsTab from './RitualsTab'
import LifeEventsTab from './LifeEventsTab'
import TensionsTab from './TensionsTab'

const RELATIONSHIP_TYPES = [
  'Parent', 'Sibling', 'Partner', 'Spouse', 'Child',
  'Friend', 'Close Friend', 'Colleague', 'Boss', 'Mentor', 'Mentee', 'Other',
]

const FILTER_GROUPS: Record<string, string[]> = {
  All: [],
  Family: ['Parent', 'Sibling', 'Partner', 'Spouse', 'Child'],
  Friends: ['Friend', 'Close Friend'],
  Work: ['Colleague', 'Boss'],
  Mentors: ['Mentor', 'Mentee'],
}

const LOVE_LANGUAGES = [
  { value: 'words_of_affirmation', label: 'Words', emoji: '💬' },
  { value: 'acts_of_service', label: 'Service', emoji: '🧰' },
  { value: 'receiving_gifts', label: 'Gifts', emoji: '🎁' },
  { value: 'quality_time', label: 'Time', emoji: '⌛' },
  { value: 'physical_touch', label: 'Touch', emoji: '🤗' },
]

const getLLLabels = (val: string | null) => {
  if (!val) return []
  return val.split(',').map((v) => LOVE_LANGUAGES.find((l) => l.value === v.trim())).filter(Boolean) as typeof LOVE_LANGUAGES
}

const CIRCLE_TABS: Array<{ key: CircleTab; icon: string }> = [
  { key: 'People', icon: '👥' },
  { key: 'Rituals', icon: '🕯️' },
  { key: 'Events', icon: '🎉' },
  { key: 'Tensions', icon: '⚡' },
]
type CircleTab = 'People' | 'Rituals' | 'Events' | 'Tensions'

export default function MyCircleScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<any>()
  const [people, setPeople] = useState<RelationshipPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('All')
  const [activeTab, setActiveTab] = useState<CircleTab>('People')

  // Connections for smart chat button (match by name → openChat / invite fallback)
  const connections = useMessagingStore((s) => s.connections)
  const loadConnections = useMessagingStore((s) => s.loadConnections)
  const pendingRequests = useMessagingStore((s) => s.pendingRequests)
  const loadPendingRequests = useMessagingStore((s) => s.loadPendingRequests)
  const openChatStore = useMessagingStore((s) => s.openChat)

  // Add form modal
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '', relationship: 'Friend', description: '',
    dynamic: '', keyContext: '', communicationStyle: '', loveLanguage: '',
    phoneNumber: '',
  })

  const loadPeople = useCallback(async () => {
    try {
      const data = await relationshipsApi.getAll()
      setPeople(data)
    } catch {} finally { setLoading(false) }
  }, [])

  useFocusEffect(useCallback(() => {
    loadPeople()
    loadConnections()
    loadPendingRequests()
  }, [loadPeople, loadConnections, loadPendingRequests]))

  // Extract phone number from keyContext as fallback (e.g. "Phone: +91 98xxxx")
  // Used to migrate older entries where phone was stored in keyContext before the phoneNumber column existed.
  const extractPhoneFromKeyContext = (kc: string | null | undefined): string | null => {
    if (!kc) return null
    const m = kc.match(/Phone[:\s]+([+\d][\d\s\-()]{6,})/i)
    if (m) return m[1].replace(/[\s\-()]/g, '')
    const anyPhone = kc.match(/([+]?\d[\d\s\-()]{8,})/)
    return anyPhone ? anyPhone[1].replace(/[\s\-()]/g, '') : null
  }

  const handleOpenChat = async (person: RelationshipPerson) => {
    // 1. Authoritative link — already resolved previously.
    if (person.linkedUserId) {
      const match = connections.find((c) => c.user.id === person.linkedUserId)
      if (match) {
        try {
          await openChatStore(match.user.id, match.user.name, match.id)
          navigation.navigate('Messages')
        } catch { showToast('Failed to open chat', 'error') }
        return
      }
      // linkedUserId exists but no accepted connection yet — fall through to phone flow.
    }

    // 2. Phone-based resolution (works with or without +91).
    // Prefer the dedicated phoneNumber column; fall back to extracting from keyContext (legacy entries).
    let phone = person.phoneNumber?.trim() || ''
    if (!phone) {
      const extracted = extractPhoneFromKeyContext(person.keyContext)
      if (extracted) {
        phone = extracted
        // Backfill the dedicated column so we skip extraction next time.
        relationshipsApi.update(person.id, { phoneNumber: extracted }).then(() => {
          setPeople((prev) => prev.map((p) =>
            p.id === person.id ? { ...p, phoneNumber: extracted } : p
          ))
        }).catch(() => {})
      }
    }
    if (phone) {
      try {
        const res = await connectionsApi.resolvePhone(phone)
        if (!res.user) {
          // Not on 4Ever — offer SMS/WhatsApp invite.
          return offerInvite(person)
        }
        // User exists on 4Ever. Persist the link so we skip this lookup next time.
        const resolvedUserId = res.user.id
        relationshipsApi.linkUser(person.id, resolvedUserId).then(() => {
          setPeople((prev) => prev.map((p) =>
            p.id === person.id ? { ...p, linkedUserId: resolvedUserId } : p
          ))
        }).catch(() => {})

        if (res.connectionStatus === 'accepted' && res.connectionId) {
          await openChatStore(resolvedUserId, res.user.name, res.connectionId)
          navigation.navigate('Messages')
          return
        }
        if (res.connectionStatus === 'pending') {
          if (res.iAmRequester) {
            showToast(`Request already sent to ${res.user.name}. Waiting for them to accept.`, 'info')
          } else {
            showToast(`${res.user.name} sent you a request — accept it in Messages.`, 'info')
            navigation.navigate('Messages')
          }
          return
        }
        // No connection yet — auto-send request.
        try {
          await connectionsApi.sendRequest(resolvedUserId)
          loadPendingRequests()
          showToast(`Connection request sent to ${res.user.name}.`, 'success')
        } catch (err: any) {
          const msg = err?.response?.data?.message || 'Could not send connection request'
          showToast(msg, 'error')
        }
        return
      } catch {
        showToast('Could not check 4Ever account', 'error')
        return
      }
    }

    // 3. No phone number on file — ask user to edit the person or offer invite fallback.
    Alert.alert(
      `No phone number for ${person.name}`,
      'Add their mobile number (with or without +91) to chat on 4Ever, or send an invite.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Edit Person',
          onPress: () => navigation.navigate('PersonDetail', { personId: person.id }),
        },
        {
          text: 'Send Invite',
          onPress: () => offerInvite(person),
        },
      ],
    )
  }

  const offerInvite = (person: RelationshipPerson) => {
    const inviteText = `Hey ${person.name}, I'm using 4Ever to stay better connected. Join me: https://4ever.app`
    Alert.alert(
      `Invite ${person.name} to 4Ever`,
      'They\u2019ll be able to chat with you once they sign up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Invite via SMS',
          onPress: () => {
            const url = Platform.OS === 'ios'
              ? `sms:&body=${encodeURIComponent(inviteText)}`
              : `sms:?body=${encodeURIComponent(inviteText)}`
            Linking.openURL(url).catch(() => showToast('Could not open SMS', 'error'))
          },
        },
        {
          text: 'Invite via WhatsApp',
          onPress: () => {
            const url = `whatsapp://send?text=${encodeURIComponent(inviteText)}`
            Linking.openURL(url).catch(() => showToast('WhatsApp not installed', 'error'))
          },
        },
      ],
    )
  }

  const onRefresh = async () => { setRefreshing(true); await loadPeople(); setRefreshing(false) }

  const filteredPeople = filter === 'All'
    ? people
    : people.filter((p) => FILTER_GROUPS[filter]?.includes(p.relationship))

  const resetForm = () => {
    setFormData({ name: '', relationship: 'Friend', description: '', dynamic: '', keyContext: '', communicationStyle: '', loveLanguage: '', phoneNumber: '' })
    setShowForm(false)
  }

  const handleAdd = async () => {
    if (!formData.name.trim()) { showToast('Name is required', 'error'); return }
    try {
      const person = await relationshipsApi.create({
        name: formData.name.trim(), relationship: formData.relationship,
        description: formData.description.trim() || undefined,
        dynamic: formData.dynamic.trim() || undefined,
        keyContext: formData.keyContext.trim() || undefined,
        communicationStyle: formData.communicationStyle.trim() || undefined,
        loveLanguage: formData.loveLanguage || undefined,
        phoneNumber: formData.phoneNumber.trim() || undefined,
      })
      setPeople((prev) => [person, ...prev])
      resetForm()
      showToast(`${person.name} added!`, 'success')
    } catch { showToast('Failed to add', 'error') }
  }

  const getHealthColor = (lastAt: string | null) => {
    if (!lastAt) return colors.gray[400]
    const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
    if (days <= 7) return colors.green[500]
    if (days <= 30) return colors.amber[500]
    return colors.red[500]
  }

  const healthyCount = people.filter((p) => {
    if (!p.lastInteractionAt) return false
    const days = Math.floor((Date.now() - new Date(p.lastInteractionAt).getTime()) / 86400000)
    return days <= 7
  }).length

  const renderPerson = ({ item }: { item: RelationshipPerson }) => {
    const lls = getLLLabels(item.loveLanguage)
    const healthColor = getHealthColor(item.lastInteractionAt)
    const noteCount = item._count?.notes || item.interactionCount
    return (
      <TouchableOpacity
        style={styles.personCard}
        onPress={() => navigation.navigate('PersonDetail', { personId: item.id })}
        activeOpacity={0.7}
      >
        <View style={[styles.personAccent, { backgroundColor: healthColor }]} />
        <View style={styles.personBody}>
          <View style={styles.personHeader}>
            <View style={[styles.avatar, { backgroundColor: healthColor + '22' }]}>
              <Text style={[styles.avatarText, { color: healthColor }]}>
                {item.name?.trim()?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personName} numberOfLines={1}>{item.name}</Text>
              <View style={styles.personBadges}>
                <View style={styles.relBadge}><Text style={styles.relBadgeText}>{item.relationship}</Text></View>
                {lls.slice(0, 2).map((ll) => (
                  <View key={ll.value} style={styles.llBadge}>
                    <Text style={styles.llBadgeText}>{ll.emoji} {ll.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.cardRightSlot}>
              {noteCount > 0 && (
                <View style={styles.noteCountWrap}>
                  <Text style={styles.noteCount}>{noteCount}</Text>
                  <Text style={styles.noteCountLabel}>notes</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.cardChatBtn}
                onPress={(e) => { e.stopPropagation?.(); handleOpenChat(item) }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.cardChatBtnText}>💬</Text>
              </TouchableOpacity>
            </View>
          </View>
          {item.description ? <Text style={styles.personDesc} numberOfLines={2}>{item.description}</Text> : null}
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      {/* Gradient hero */}
      <LinearGradient
        colors={isDark ? ['#1e3a8a', '#831843'] : ['#0ea5e9', '#ec4899']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + Spacing.lg }]}
      >
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>❤  Relationships</Text>
            <Text style={styles.heroTitle}>My Circle</Text>
            <Text style={styles.heroSubtitle}>
              {people.length} {people.length === 1 ? 'person' : 'people'}
              {healthyCount > 0 ? `  ·  ${healthyCount} active this week` : ''}
            </Text>
          </View>
          {activeTab === 'People' && (
            <View style={styles.heroBtns}>
              <TouchableOpacity style={styles.heroContactsBtn} onPress={() => navigation.navigate('ContactsPicker')} activeOpacity={0.8}>
                <Text style={styles.heroContactsBtnText}>📇</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.heroAddBtn} onPress={() => setShowForm(true)} activeOpacity={0.8}>
                <Text style={styles.heroAddBtnText}>＋</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Pill-shaped sub-tabs inside the hero */}
        <View style={styles.tabBar}>
          {CIRCLE_TABS.map((tab) => {
            const active = activeTab === tab.key
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabPill, active && styles.tabPillActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.tabPillText, active && styles.tabPillTextActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {tab.key}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </LinearGradient>

      {activeTab === 'Rituals' && <RitualsTab people={people} />}
      {activeTab === 'Events' && <LifeEventsTab people={people} />}
      {activeTab === 'Tensions' && <TensionsTab people={people} />}

      {activeTab === 'People' && (
        <>
          {/* Pending connection requests banner — only shown when non-zero */}
          {pendingRequests.length > 0 && (
            <TouchableOpacity
              style={styles.pendingBanner}
              onPress={() => navigation.navigate('Connections')}
              activeOpacity={0.85}
            >
              <Text style={styles.pendingBannerText}>
                {pendingRequests.length} connection request{pendingRequests.length === 1 ? '' : 's'} waiting
              </Text>
              <Text style={styles.pendingBannerChevron}>Review ›</Text>
            </TouchableOpacity>
          )}

          {/* Filter chips removed — list shows all people. Re-add FILTER_GROUPS UI here if filtering is needed again. */}

          {/* People list */}
          <FlatList
            data={filteredPeople}
            renderItem={renderPerson}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
            ListEmptyComponent={!loading ? <EmptyState icon="❤️" title="No people yet" subtitle="Add someone to your relationship circle" /> : null}
          />
        </>
      )}

      {/* Add Person Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={resetForm}>
        <Pressable style={styles.overlay} onPress={resetForm} />
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add Person</Text>
            <TouchableOpacity onPress={resetForm}><Text style={styles.sheetCancel}>Cancel</Text></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.formLabel}>Name *</Text>
            <TextInput style={styles.formInput} value={formData.name} onChangeText={(v) => setFormData({ ...formData, name: v })} placeholder="e.g., Dad, Rahul, Sarah" placeholderTextColor={colors.textMuted} />

            <Text style={styles.formLabel}>Phone Number</Text>
            <TextInput style={styles.formInput} value={formData.phoneNumber} onChangeText={(v) => setFormData({ ...formData, phoneNumber: v })} placeholder="+91 98765 43210 or 9876543210" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.formLabel}>Relationship</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              {RELATIONSHIP_TYPES.map((r) => (
                <TouchableOpacity key={r} style={[styles.typeChip, formData.relationship === r && styles.typeChipActive]} onPress={() => setFormData({ ...formData, relationship: r })}>
                  <Text style={[styles.typeChipText, formData.relationship === r && styles.typeChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.formLabel}>Description</Text>
            <TextInput style={[styles.formInput, { minHeight: 50 }]} value={formData.description} onChangeText={(v) => setFormData({ ...formData, description: v })} placeholder="Who are they? Personality?" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.formLabel}>Your Dynamic</Text>
            <TextInput style={[styles.formInput, { minHeight: 50 }]} value={formData.dynamic} onChangeText={(v) => setFormData({ ...formData, dynamic: v })} placeholder="How is your relationship?" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.formLabel}>Key Context</Text>
            <TextInput style={[styles.formInput, { minHeight: 50 }]} value={formData.keyContext} onChangeText={(v) => setFormData({ ...formData, keyContext: v })} placeholder="Job, interests, relevant info" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.formLabel}>Communication Style</Text>
            <TextInput style={[styles.formInput, { minHeight: 50 }]} value={formData.communicationStyle} onChangeText={(v) => setFormData({ ...formData, communicationStyle: v })} placeholder="How they talk, respond" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.formLabel}>Love Language</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
              {LOVE_LANGUAGES.map((l) => (
                <TouchableOpacity key={l.value} style={[styles.llChip, formData.loveLanguage.split(',').includes(l.value) && styles.llChipActive]} onPress={() => {
                  const current = formData.loveLanguage ? formData.loveLanguage.split(',').filter(Boolean) : []
                  const next = current.includes(l.value) ? current.filter((v) => v !== l.value) : [...current, l.value]
                  setFormData({ ...formData, loveLanguage: next.join(',') })
                }}>
                  <Text style={[styles.llChipText, formData.loveLanguage.split(',').includes(l.value) && styles.llChipTextActive]}>{l.emoji} {l.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity activeOpacity={0.9} style={styles.submitWrap} onPress={handleAdd}>
              <LinearGradient colors={['#0ea5e9', '#ec4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submitBtn}>
                <Text style={styles.submitBtnText}>Add to Circle</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: Spacing.md,
    borderBottomLeftRadius: BorderRadius.xl + 12,
    borderBottomRightRadius: BorderRadius.xl + 12,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.lg },
  heroEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  heroTitle: { fontSize: FontSize['3xl'], color: '#ffffff', fontWeight: '800', letterSpacing: -0.5 },
  heroSubtitle: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.92)', marginTop: 2, fontWeight: '500' },
  heroBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  heroIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroIconBtnText: { fontSize: 16 },
  heroBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#ef4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: '#fff',
  },
  heroBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  heroAddBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    ...shadow(4),
  },
  heroAddBtnText: { color: '#ec4899', fontSize: 22, fontWeight: '700', lineHeight: 24 },
  heroContactsBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroContactsBtnText: { fontSize: 18, lineHeight: 22 },

  // Tab bar — segmented pill
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: BorderRadius.full,
    padding: 4,
    gap: 4,
    alignItems: 'stretch',
  },
  tabPill: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillActive: { backgroundColor: '#ffffff', ...shadow(3) },
  tabPillText: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.95)',
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  tabPillTextActive: { color: '#0284c7', fontWeight: '700' },

  // Filter row
  filterRow: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.md, gap: 8, alignItems: 'center' },
  filterWrap: { borderRadius: BorderRadius.full },
  filterChip: {
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: isDark ? colors.gray[100] : colors.gray[100],
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { borderColor: 'transparent', borderWidth: 0 },
  filterChipText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
    paddingTop: Platform.OS === 'ios' ? 1 : 0,
  },
  filterChipTextActive: { color: '#ffffff', fontWeight: '700' },

  list: { padding: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: 120 },

  // Pending-requests banner (only visible when pendingRequests.length > 0)
  pendingBanner: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : '#FEF3C7',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(251,191,36,0.4)' : '#FDE68A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingBannerText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: isDark ? '#FCD34D' : '#92400E',
    flex: 1,
  },
  pendingBannerChevron: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: isDark ? '#FCD34D' : '#92400E',
  },

  // Person card
  personCard: {
    backgroundColor: colors.card,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    ...shadow(3),
    ...neonCard(colors, isDark),
  },
  personAccent: { width: 4 },
  personBody: { flex: 1, padding: Spacing.lg },
  personHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.base, fontWeight: '800' },
  personName: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  personBadges: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  relBadge: { backgroundColor: isDark ? 'rgba(244,63,94,0.18)' : '#FFE4E6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  relBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#FB7185' : '#E11D48' },
  llBadge: { backgroundColor: isDark ? 'rgba(236,72,153,0.18)' : '#FCE7F3', paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  llBadgeText: { fontSize: 10, fontWeight: '700', color: isDark ? '#F472B6' : '#DB2777' },
  cardRightSlot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  noteCountWrap: {
    alignItems: 'center',
    backgroundColor: isDark ? colors.gray[100] : colors.gray[50],
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    minWidth: 46,
  },
  noteCount: { fontSize: FontSize.base, fontWeight: '800', color: colors.primary[600] },
  noteCountLabel: { fontSize: 9, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  cardChatBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: isDark ? 'rgba(14,165,233,0.18)' : '#E0F2FE',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(14,165,233,0.45)' : '#BAE6FD',
    alignItems: 'center', justifyContent: 'center',
  },
  cardChatBtnText: { fontSize: 16 },
  personDesc: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.sm, lineHeight: 20 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '85%', backgroundColor: colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: Spacing.xl, paddingBottom: 20,
    ...neonCard(colors, isDark),
  },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  sheetCancel: { fontSize: FontSize.base, fontWeight: '600', color: colors.primary[500] },

  formLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, marginTop: Spacing.md, textTransform: 'uppercase', letterSpacing: 0.4 },
  formInput: { backgroundColor: isDark ? colors.gray[100] : colors.gray[50], borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.lg, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, textAlignVertical: 'top', ...neonSoft(colors, isDark) },

  typeChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm, borderWidth: 1, borderColor: colors.border },
  typeChipActive: { backgroundColor: isDark ? 'rgba(244,63,94,0.22)' : '#FFE4E6', borderColor: isDark ? '#FB7185' : '#FECDD3' },
  typeChipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  typeChipTextActive: { color: isDark ? '#FB7185' : '#E11D48' },

  llChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm, borderWidth: 1, borderColor: colors.border },
  llChipActive: { backgroundColor: isDark ? 'rgba(236,72,153,0.22)' : '#FCE7F3', borderColor: isDark ? '#F472B6' : '#FBCFE8' },
  llChipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  llChipTextActive: { color: isDark ? '#F472B6' : '#DB2777' },

  submitWrap: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    marginTop: Spacing.md,
    ...shadow(4),
  },
  submitBtn: { paddingVertical: Spacing.md + 2, alignItems: 'center' },
  submitBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '800', letterSpacing: 0.2 },
})
