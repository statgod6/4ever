import React, { useEffect, useState, useCallback, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, RefreshControl, Alert, ActivityIndicator, Linking, Platform } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { connectionsApi, type ConnectionItem, type PendingRequest, type SearchResult } from '../api/messaging'
import { useMessagingStore } from '../store/messagingStore'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import UserAvatar from '../components/UserAvatar'

type Tab = 'connections' | 'pending' | 'search'

export default function ConnectionsScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const navigation = useNavigation<any>()
  const openChat = useMessagingStore((s) => s.openChat)
  const [tab, setTab] = useState<Tab>('connections')
  const [connections, setConnections] = useState<ConnectionItem[]>([])
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [conns, pend] = await Promise.all([
        connectionsApi.getAll().catch(() => []),
        connectionsApi.getPending().catch(() => []),
      ])
      setConnections(conns)
      setPending(pend)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const handleSearch = useCallback(async (q?: string) => {
    const query = (q ?? searchQuery).trim()
    if (!query || query.length < 2) { setSearchResults([]); setHasSearched(false); return }
    setSearching(true)
    try {
      const results = await connectionsApi.search(query)
      setSearchResults(results)
      setHasSearched(true)
    } catch { showToast('Search failed', 'error') }
    setSearching(false)
  }, [searchQuery])

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (tab !== 'search') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults([]); setHasSearched(false); return }
    debounceRef.current = setTimeout(() => { handleSearch(q) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery, tab])

  const handleSendRequest = async (userId: string) => {
    try {
      await connectionsApi.sendRequest(userId)
      showToast('Connection request sent!', 'success')
      setSearchResults((prev) => prev.map((r) => r.id === userId ? { ...r, connectionStatus: 'pending' } : r))
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to send request', 'error')
    }
  }

  const handleAccept = async (id: string) => {
    try {
      await connectionsApi.accept(id)
      showToast('Connection accepted!', 'success')
      loadData()
    } catch { showToast('Failed to accept', 'error') }
  }

  const handleReject = async (id: string) => {
    try {
      await connectionsApi.reject(id)
      setPending((prev) => prev.filter((p) => p.id !== id))
    } catch { showToast('Failed to reject', 'error') }
  }

  const handleRemove = async (id: string) => {
    Alert.alert('Remove Connection', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await connectionsApi.remove(id)
          setConnections((prev) => prev.filter((c) => c.id !== id))
          showToast('Connection removed', 'info')
        } catch { showToast('Failed to remove', 'error') }
      }},
    ])
  }

  const handleOpenChat = async (item: ConnectionItem) => {
    try {
      await openChat(item.user.id, item.user.name, item.id)
      navigation.navigate('Messages')
    } catch { showToast('Failed to open chat', 'error') }
  }

  // --- Invite via WhatsApp / SMS when phone search yields no user ---
  const looksLikePhone = (q: string) => /^[+\d][\d\s\-()]{6,}$/.test(q.trim())
  const cleanPhone = (q: string) => q.replace(/[^+\d]/g, '')
  const inviteMessage = `Hi! I'm using 4Ever to stay close with the people who matter most. Join me: https://4ever.app`

  const inviteViaWhatsApp = async (phone: string) => {
    const clean = cleanPhone(phone)
    const primary = `whatsapp://send?phone=${clean}&text=${encodeURIComponent(inviteMessage)}`
    const fallback = `https://wa.me/${clean.replace(/^\+/, '')}?text=${encodeURIComponent(inviteMessage)}`
    try {
      const supported = await Linking.canOpenURL(primary)
      await Linking.openURL(supported ? primary : fallback)
    } catch {
      try { await Linking.openURL(fallback) } catch { showToast('Could not open WhatsApp', 'error') }
    }
  }

  const inviteViaSMS = async (phone: string) => {
    const clean = cleanPhone(phone)
    const url = Platform.OS === 'ios'
      ? `sms:${clean}&body=${encodeURIComponent(inviteMessage)}`
      : `sms:${clean}?body=${encodeURIComponent(inviteMessage)}`
    try { await Linking.openURL(url) } catch { showToast('Could not open SMS', 'error') }
  }

  const promptInvite = (phone: string) => {
    // eslint-disable-line @typescript-eslint/no-unused-vars
    Alert.alert(
      'Invite to 4Ever',
      'Open WhatsApp or SMS with a ready-to-send invite message?',
      [
        { text: 'WhatsApp', onPress: () => inviteViaWhatsApp(phone) },
        { text: 'SMS', onPress: () => inviteViaSMS(phone) },
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }
  void promptInvite // reserved for future in-row invite

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary[500]} /></View>

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['connections', 'pending', 'search'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'connections' ? `Friends${connections.length ? ` (${connections.length})` : ''}` : t === 'pending' ? `Pending${pending.length ? ` (${pending.length})` : ''}` : 'Search'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search Bar */}
      {tab === 'search' && (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name, email, or phone..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            onSubmitEditing={() => handleSearch()}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={() => handleSearch()} disabled={searching}>
            <Text style={styles.searchBtnText}>{searching ? '...' : '🔍'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Connections List */}
      {tab === 'connections' && (
        <FlatList
          data={connections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
          ListEmptyComponent={<EmptyState icon="🤝" title="No connections yet" subtitle="Search for people to connect with!" />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <UserAvatar size={44} name={item.user.name} phoneNumber={item.user.phoneNumber} avatarUrl={item.user.avatarUrl} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.user.name}</Text>
                  <Text style={styles.email}>{item.user.phoneNumber}</Text>
                </View>
                <TouchableOpacity style={styles.messageBtn} onPress={() => handleOpenChat(item)}>
                  <Text style={styles.messageBtnText}>💬</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemove(item.id)}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Pending Requests */}
      {tab === 'pending' && (
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
          ListEmptyComponent={<EmptyState icon="📬" title="No pending requests" />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <UserAvatar size={44} name={item.requester.name} phoneNumber={item.requester.phoneNumber} avatarUrl={item.requester.avatarUrl} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.requester.name}</Text>
                  <Text style={styles.email}>{item.requester.name}</Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(item.id)}>
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => handleReject(item.id)}>
                  <Text style={styles.rejectBtnText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Search Results */}
      {tab === 'search' && (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            hasSearched && !searching ? (
              looksLikePhone(searchQuery) ? (
                <View style={styles.inviteCard}>
                  <Text style={styles.inviteEmoji}>📨</Text>
                  <Text style={styles.inviteTitle}>Not on 4Ever yet</Text>
                  <Text style={styles.inviteSubtitle}>
                    {cleanPhone(searchQuery)} isn't a 4Ever user. Send them an invite to join.
                  </Text>
                  <View style={styles.inviteBtnRow}>
                    <TouchableOpacity style={[styles.inviteBtn, styles.inviteBtnWhatsapp]} onPress={() => inviteViaWhatsApp(searchQuery)} activeOpacity={0.85}>
                      <Text style={styles.inviteBtnEmoji}>💬</Text>
                      <Text style={styles.inviteBtnText}>WhatsApp</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.inviteBtn, styles.inviteBtnSms]} onPress={() => inviteViaSMS(searchQuery)} activeOpacity={0.85}>
                      <Text style={styles.inviteBtnEmoji}>✉️</Text>
                      <Text style={[styles.inviteBtnText, { color: '#fff' }]}>SMS</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <EmptyState icon="🔍" title="No users found" subtitle="Try searching by phone number to invite someone new" />
              )
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <UserAvatar size={44} name={item.name} phoneNumber={item.phoneNumber} avatarUrl={item.avatarUrl} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.email}>{item.phoneNumber}</Text>
                </View>
                {item.connectionStatus === 'accepted' ? (
                  <Text style={styles.statusText}>Connected</Text>
                ) : item.connectionStatus === 'pending' ? (
                  <Text style={styles.statusText}>Pending</Text>
                ) : (
                  <TouchableOpacity style={styles.connectBtn} onPress={() => handleSendRequest(item.id)}>
                    <Text style={styles.connectBtnText}>Connect</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabRow: { flexDirection: 'row', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: Spacing.sm },
  tab: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: colors.gray[100], alignItems: 'center' },
  tabActive: { backgroundColor: colors.primary[500] },
  tabText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#ffffff' },
  searchRow: { flexDirection: 'row', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.sm },
  searchInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.base, color: colors.text, ...neonSoft(colors, isDark) },
  searchBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: colors.primary[500], justifyContent: 'center', alignItems: 'center' },
  searchBtnText: { fontSize: 18 },
  list: { padding: Spacing.lg, paddingBottom: 120 },
  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary[100], justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: FontSize.lg, fontWeight: '700', color: colors.primary[600] },
  name: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
  email: { fontSize: FontSize.sm, color: colors.textSecondary },
  removeBtn: { fontSize: FontSize.lg, color: colors.textMuted, padding: Spacing.sm },
  messageBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], justifyContent: 'center', alignItems: 'center', marginRight: Spacing.xs },
  messageBtnText: { fontSize: 16 },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  acceptBtn: { flex: 1, backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  acceptBtnText: { color: '#ffffff', fontWeight: '600', fontSize: FontSize.sm },
  rejectBtn: { flex: 1, backgroundColor: colors.gray[100], borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  rejectBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: FontSize.sm },
  connectBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  connectBtnText: { color: '#ffffff', fontWeight: '600', fontSize: FontSize.sm },
  statusText: { fontSize: FontSize.sm, color: colors.textMuted, fontWeight: '500' },

  // Invite card (phone not on app)
  inviteCard: {
    backgroundColor: colors.card,
    margin: Spacing.lg,
    padding: Spacing.xl,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[100],
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    ...neonCard(colors, isDark),
  },
  inviteEmoji: { fontSize: 44, marginBottom: Spacing.sm },
  inviteTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text, marginBottom: Spacing.xs },
  inviteSubtitle: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg, lineHeight: 20 },
  inviteBtnRow: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  inviteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  inviteBtnWhatsapp: { backgroundColor: '#25D366' },
  inviteBtnSms: { backgroundColor: colors.primary[500] },
  inviteBtnEmoji: { fontSize: 18 },
  inviteBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.sm },
})
