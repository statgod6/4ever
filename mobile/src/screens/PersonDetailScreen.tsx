import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Alert, Modal, Pressable, Platform, KeyboardAvoidingView, Linking,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { relationshipsApi, type RelationshipPerson, type RelationshipNote } from '../api/relationships'
import { connectionsApi, type SearchResult } from '../api/messaging'
import { useMessagingStore } from '../store/messagingStore'
import { ontologyApi, type RelationalSnapshot } from '../api/ontology'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'

type Props = NativeStackScreenProps<any, 'PersonDetail'>

const RELATIONSHIP_TYPES = [
  'Parent', 'Sibling', 'Partner', 'Spouse', 'Child',
  'Friend', 'Close Friend', 'Colleague', 'Boss', 'Mentor', 'Mentee', 'Other',
]

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

export default function PersonDetailScreen({ route, navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const personId: string = route.params?.personId

  // Visual helpers (avatar initials + stable color from name hash)
  const getInitials = (n: string) => {
    const parts = (n || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  const AVATAR_PALETTE = [
    ['#0EA5E9', '#0369A1'], // sky
    ['#A855F7', '#7E22CE'], // purple
    ['#EC4899', '#BE185D'], // pink
    ['#F59E0B', '#B45309'], // amber
    ['#10B981', '#047857'], // emerald
    ['#EF4444', '#B91C1C'], // red
    ['#6366F1', '#4338CA'], // indigo
    ['#14B8A6', '#0F766E'], // teal
  ]
  const getAvatarGradient = (n: string) => {
    let h = 0
    for (let i = 0; i < (n || '').length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
  }

  const [person, setPerson] = useState<RelationshipPerson | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Note
  const [noteText, setNoteText] = useState('')
  const [noteSending, setNoteSending] = useState(false)

  // Edit modal
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', relationship: 'Friend', description: '',
    dynamic: '', keyContext: '', communicationStyle: '', loveLanguage: '',
    phoneNumber: '',
  })
  const [saving, setSaving] = useState(false)

  // Persona
  const [personaLoading, setPersonaLoading] = useState(false)

  // Relational ontology
  const [relational, setRelational] = useState<RelationalSnapshot | null>(null)
  const [relationalRefreshing, setRelationalRefreshing] = useState(false)

  // Chat match (app user lookup by name)
  const [chatMatch, setChatMatch] = useState<SearchResult | null | undefined>(undefined) // undefined=loading, null=no match
  const [chatActionLoading, setChatActionLoading] = useState(false)
  const openChat = useMessagingStore((s) => s.openChat)

  // Extract phone number from keyContext (e.g. "Phone: +91 98xxxx")
  const extractPhone = (kc: string | null | undefined): string | null => {
    if (!kc) return null
    const m = kc.match(/Phone[:\s]+([+\d][\d\s\-()]{6,})/i)
    if (m) return m[1].replace(/[\s\-()]/g, '')
    const anyPhone = kc.match(/([+]?\d[\d\s\-()]{8,})/i)
    return anyPhone ? anyPhone[1].replace(/[\s\-()]/g, '') : null
  }

  // Unified accessor: prefer the dedicated phoneNumber column, fall back to keyContext.
  const getPersonPhone = (p: RelationshipPerson | null | undefined): string | null => {
    if (!p) return null
    const col = p.phoneNumber?.trim()
    if (col) return col
    return extractPhone(p.keyContext)
  }

  // Look up whether this Circle person is a registered app user
  const lookupChatMatch = useCallback(async (p: RelationshipPerson) => {
    setChatMatch(undefined)
    const phone = getPersonPhone(p)
    // 1. Deterministic phone resolution (handles +91 / plain / spaces).
    if (phone) {
      try {
        const res = await connectionsApi.resolvePhone(phone)
        if (res.user) {
          setChatMatch({
            id: res.user.id,
            name: res.user.name,
            email: null,
            connectionStatus: res.connectionStatus,
            connectionId: res.connectionId,
          } as any)
          return
        }
      } catch {}
    }
    // 2. Legacy fallback: name search (kept for entries with no phone).
    if (p.name?.trim()) {
      try {
        const results = await connectionsApi.search(p.name.trim())
        if (results.length > 0) {
          const exact = results.find((r) => r.name.toLowerCase() === p.name.toLowerCase())
          setChatMatch(exact || results[0])
          return
        }
      } catch {}
    }
    setChatMatch(null)
  }, [])

  const loadPerson = useCallback(async () => {
    try {
      const [data, rel] = await Promise.all([
        relationshipsApi.getOne(personId),
        ontologyApi.getRelational(personId).catch(() => null),
      ])
      setPerson(data)
      setRelational(rel)
      lookupChatMatch(data)
    } catch (err: any) {
      showToast('Failed to load person', 'error')
    } finally { setLoading(false) }
  }, [personId, lookupChatMatch])

  useEffect(() => { loadPerson() }, [loadPerson])

  const onRefresh = async () => { setRefreshing(true); await loadPerson(); setRefreshing(false) }

  const refreshRelational = async () => {
    setRelationalRefreshing(true)
    try {
      await ontologyApi.refresh().catch(() => null)
      const rel = await ontologyApi.getRelational(personId).catch(() => null)
      setRelational(rel)
    } finally {
      setRelationalRefreshing(false)
    }
  }

  const trendLabel = (t: string) => t === 'strengthening' ? 'Strengthening ↗' : t === 'drifting' ? 'Drifting ↘' : 'Stable →'
  const trendColor = (t: string) => t === 'strengthening' ? colors.green[500] : t === 'drifting' ? colors.red[500] : colors.gray[500]

  // --- Health color ---
  const getHealthColor = () => {
    if (!person?.lastInteractionAt) return colors.gray[400]
    const days = Math.floor((Date.now() - new Date(person.lastInteractionAt).getTime()) / 86400000)
    if (days <= 7) return colors.green[500]
    if (days <= 30) return colors.amber[500]
    return colors.red[500]
  }

  // --- Add note ---
  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setNoteSending(true)
    try {
      const note = await relationshipsApi.addNote(personId, noteText.trim())
      setPerson((prev) => prev ? { ...prev, notes: [note, ...(prev.notes || [])], _count: { notes: (prev._count?.notes || 0) + 1 } } : prev)
      setNoteText('')
      showToast('Note added', 'success')
    } catch { showToast('Failed to add note', 'error') }
    setNoteSending(false)
  }

  // --- Delete ---
  const handleDelete = () => {
    Alert.alert('Remove Person', `Remove ${person?.name} from your circle? This will delete all their notes.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await relationshipsApi.remove(personId)
          showToast('Removed', 'success')
          navigation.goBack()
        } catch { showToast('Failed to remove', 'error') }
      }},
    ])
  }

  // --- Create persona ---
  const handleCreatePersona = async () => {
    setPersonaLoading(true)
    try {
      const result = await relationshipsApi.createPersona(personId)
      if (result.alreadyExists) {
        showToast('Persona already exists', 'info')
      } else {
        showToast(`Persona "${person?.name}" created!`, 'success')
      }
      await loadPerson()
    } catch { showToast('Failed to create persona', 'error') }
    setPersonaLoading(false)
  }

  // --- Chat with persona ---
  const handleChatWithPersona = () => {
    if (!person?.linkedPersonaId) {
      showToast('No linked persona. Create one first.', 'error')
      return
    }
    // PersonaChat is registered in the current stack (CircleStack/DashboardStack),
    // so pushing directly keeps the tab bar and back-arrow returning here.
    navigation.navigate('PersonaChat', {
      personaId: person.linkedPersonaId,
      personaName: person.name,
    })
  }

  // --- Direct message (WhatsApp-style) ---
  const handleDirectMessage = async () => {
    if (!person || !chatMatch) return
    if (chatMatch.connectionStatus === 'accepted') {
      try {
        await openChat(chatMatch.id, chatMatch.name, chatMatch.connectionId || undefined)
        navigation.navigate('Messages')
      } catch { showToast('Failed to open chat', 'error') }
      return
    }
    if (chatMatch.connectionStatus === 'pending') {
      showToast('Connection request already pending', 'info')
      return
    }
    // No connection yet — send request
    setChatActionLoading(true)
    try {
      await connectionsApi.sendRequest(chatMatch.id)
      setChatMatch({ ...chatMatch, connectionStatus: 'pending' })
      showToast('Connection request sent!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to send request', 'error')
    } finally { setChatActionLoading(false) }
  }

  // --- Invite via WhatsApp / SMS (opens native messaging app with pre-filled text) ---
  const buildInviteMessage = (firstName: string) =>
    `Hi ${firstName}! I'm using 4Ever to stay close with the people who matter most. Join me: https://4ever.app`

  const openWhatsApp = async (phone: string, message: string) => {
    const clean = phone.replace(/[^+\d]/g, '')
    const primary = `whatsapp://send?phone=${clean}&text=${encodeURIComponent(message)}`
    const fallback = `https://wa.me/${clean.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`
    try {
      const supported = await Linking.canOpenURL(primary)
      await Linking.openURL(supported ? primary : fallback)
    } catch {
      try { await Linking.openURL(fallback) } catch { showToast('Could not open WhatsApp', 'error') }
    }
  }

  const openSMS = async (phone: string, message: string) => {
    const clean = phone.replace(/[^+\d]/g, '')
    // iOS uses '&body=', Android uses '?body='
    const url = Platform.OS === 'ios'
      ? `sms:${clean}&body=${encodeURIComponent(message)}`
      : `sms:${clean}?body=${encodeURIComponent(message)}`
    try {
      await Linking.openURL(url)
    } catch { showToast('Could not open SMS', 'error') }
  }

  const handleInvite = async () => {
    if (!person) return
    const phone = getPersonPhone(person)
    if (!phone) {
      Alert.alert(
        `No phone number for ${person.name}`,
        `Tap Edit on this card and add a phone number, then try Invite again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Edit now', onPress: () => startEdit() },
        ],
      )
      return
    }
    const firstName = (person.name || '').split(' ')[0] || 'there'
    const message = buildInviteMessage(firstName)
    Alert.alert(
      `Invite ${firstName} to 4Ever`,
      'Choose how to send the invite. WhatsApp or SMS will open with a pre-filled message.',
      [
        { text: 'WhatsApp', onPress: () => openWhatsApp(phone, message) },
        { text: 'SMS', onPress: () => openSMS(phone, message) },
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  // --- Edit ---
  const startEdit = () => {
    if (!person) return
    setEditForm({
      name: person.name, relationship: person.relationship,
      description: person.description || '', dynamic: person.dynamic || '',
      keyContext: person.keyContext || '', communicationStyle: person.communicationStyle || '',
      loveLanguage: person.loveLanguage || '',
      phoneNumber: person.phoneNumber || '',
    })
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast('Name is required', 'error'); return }
    setSaving(true)
    try {
      await relationshipsApi.update(personId, {
        name: editForm.name.trim(), relationship: editForm.relationship,
        description: editForm.description.trim() || undefined,
        dynamic: editForm.dynamic.trim() || undefined,
        keyContext: editForm.keyContext.trim() || undefined,
        communicationStyle: editForm.communicationStyle.trim() || undefined,
        loveLanguage: editForm.loveLanguage || undefined,
        phoneNumber: editForm.phoneNumber.trim() || undefined,
      })
      setEditing(false)
      await loadPerson()
      showToast('Updated', 'success')
    } catch { showToast('Failed to update', 'error') }
    setSaving(false)
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary[500]} /></View>
  }

  if (!person) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Person not found</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadPerson}><Text style={styles.retryBtnText}>Retry</Text></TouchableOpacity>
      </View>
    )
  }

  const lls = getLLLabels(person.loveLanguage)
  const notes: RelationshipNote[] = person.notes || []

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />}
      >
        {/* Header card */}
        <View style={styles.heroCard}>
          {/* Colorful gradient top — per-person signature color */}
          <LinearGradient
            colors={getAvatarGradient(person.name) as unknown as readonly [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroTop}
          >
            {/* Decorative bubbles for depth */}
            <View style={styles.heroBubbleLg} />
            <View style={styles.heroBubbleSm} />

            <View style={styles.nameRow}>
              <View style={styles.avatarGradient}>
                <Text style={styles.avatarGradientText}>{getInitials(person.name)}</Text>
                <View style={[styles.avatarHealth, { backgroundColor: getHealthColor() }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroName} numberOfLines={1}>{person.name}</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.heroRelBadge}><Text style={styles.heroRelBadgeText}>{person.relationship}</Text></View>
                  {lls.map((ll) => <View key={ll.value} style={styles.heroLlBadge}><Text style={styles.heroLlBadgeText}>{ll.emoji} {ll.label}</Text></View>)}
                </View>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.heroBody}>
            {/* Stats */}
            <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>💬</Text>
              <Text style={styles.statNum}>{Math.max(person.interactionCount || 0, notes.length)}</Text>
              <Text style={styles.statLabel}>Interactions</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>📅</Text>
              <Text style={styles.statNum}>
                {person.lastInteractionAt ? new Date(person.lastInteractionAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
              </Text>
              <Text style={styles.statLabel}>Last Contact</Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={startEdit} activeOpacity={0.75}>
              <Text style={styles.actionBtnEmoji}>✏️</Text>
              <Text style={styles.actionBtnText}>Edit</Text>
            </TouchableOpacity>
            {person.linkedPersonaId ? (
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnChat]} onPress={handleChatWithPersona} activeOpacity={0.75}>
                <Text style={styles.actionBtnEmoji}>🤖</Text>
                <Text style={[styles.actionBtnText, { color: colors.primary[700] }]} numberOfLines={2}>Persona Chat</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPersona]} onPress={handleCreatePersona} disabled={personaLoading} activeOpacity={0.75}>
                <Text style={styles.actionBtnEmoji}>{personaLoading ? '…' : '✨'}</Text>
                <Text style={[styles.actionBtnText, { color: '#7C3AED' }]} numberOfLines={2}>
                  {personaLoading ? 'Creating' : 'Persona'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleDelete} activeOpacity={0.75}>
              <Text style={styles.actionBtnEmoji}>🗑</Text>
              <Text style={[styles.actionBtnText, { color: colors.red[600] }]}>Remove</Text>
            </TouchableOpacity>
          </View>

          {/* Direct-message CTA (smart routing) */}
          {chatMatch === undefined ? null : chatMatch === null ? (
            <TouchableOpacity style={[styles.dmCta, styles.dmCtaInvite]} onPress={handleInvite} disabled={chatActionLoading} activeOpacity={0.85}>
              <Text style={styles.dmCtaEmoji}>📨</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dmCtaTitle}>Invite to 4Ever</Text>
                <Text style={styles.dmCtaSubtitle}>
                  {getPersonPhone(person) ? 'Send an SMS invite so you can chat here' : 'Tap Edit and add a phone number to invite'}
                </Text>
              </View>
              <Text style={styles.dmCtaArrow}>{chatActionLoading ? '…' : '›'}</Text>
            </TouchableOpacity>
          ) : chatMatch.connectionStatus === 'accepted' ? (
            <TouchableOpacity style={[styles.dmCta, styles.dmCtaChat]} onPress={handleDirectMessage} disabled={chatActionLoading} activeOpacity={0.85}>
              <Text style={styles.dmCtaEmoji}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dmCtaTitle, { color: '#fff' }]} numberOfLines={1}>Message {person.name}</Text>
                <Text style={[styles.dmCtaSubtitle, { color: 'rgba(255,255,255,0.85)' }]}>Open chat</Text>
              </View>
              <Text style={[styles.dmCtaArrow, { color: '#fff' }]}>›</Text>
            </TouchableOpacity>
          ) : chatMatch.connectionStatus === 'pending' ? (
            <View style={[styles.dmCta, styles.dmCtaPending]}>
              <Text style={styles.dmCtaEmoji}>⏳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dmCtaTitle}>Request Pending</Text>
                <Text style={styles.dmCtaSubtitle}>Waiting for them to accept</Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={[styles.dmCta, styles.dmCtaConnect]} onPress={handleDirectMessage} disabled={chatActionLoading} activeOpacity={0.85}>
              <Text style={styles.dmCtaEmoji}>➕</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dmCtaTitle}>Connect to chat</Text>
                <Text style={styles.dmCtaSubtitle}>{person.name} is on 4Ever — send a connection request</Text>
              </View>
              <Text style={styles.dmCtaArrow}>{chatActionLoading ? '…' : '›'}</Text>
            </TouchableOpacity>
          )}
          </View>
        </View>

        {/* Relational intelligence card */}
        {relational && (
          <View style={styles.card}>
            <View style={styles.relHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.relEyebrow}>Relational intelligence</Text>
                <Text style={[styles.relTrend, { color: trendColor(relational.bondTrend) }]}>
                  {trendLabel(relational.bondTrend)}
                </Text>
              </View>
              <TouchableOpacity onPress={refreshRelational} disabled={relationalRefreshing} style={styles.relRefreshBtn}>
                <Text style={styles.relRefreshText}>{relationalRefreshing ? '…' : '↻'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.bondRow}>
              <Text style={styles.bondLabel}>Bond strength</Text>
              <Text style={styles.bondValue}>{Math.round((relational.bondStrength || 0) * 100)}%</Text>
            </View>
            <View style={styles.bondBarBg}>
              <View style={[styles.bondBarFill, { width: `${Math.max(5, Math.round((relational.bondStrength || 0) * 100))}%`, backgroundColor: trendColor(relational.bondTrend) }]} />
            </View>

            {relational.driftRiskDays > 0 && (
              <View style={styles.driftWarn}>
                <Text style={styles.driftWarnText}>⚠ Drift risk in ~{relational.driftRiskDays} day{relational.driftRiskDays === 1 ? '' : 's'}</Text>
              </View>
            )}

            {relational.recurringTopics && relational.recurringTopics.length > 0 && (
              <View style={styles.relSection}>
                <Text style={styles.relSectionLabel}>Recurring topics</Text>
                <View style={styles.chipRow}>
                  {relational.recurringTopics.slice(0, 6).map((t, i) => (
                    <View key={i} style={styles.topicChip}><Text style={styles.topicChipText}>{t}</Text></View>
                  ))}
                </View>
              </View>
            )}

            {relational.unresolvedFriction && relational.unresolvedFriction.length > 0 && (
              <View style={styles.relSection}>
                <Text style={styles.relSectionLabel}>Unresolved friction</Text>
                {relational.unresolvedFriction.slice(0, 3).map((f, i) => (
                  <Text key={i} style={styles.frictionItem}>• {f}</Text>
                ))}
              </View>
            )}

            {relational.predictedNextInteraction && (
              <View style={styles.relSection}>
                <Text style={styles.relSectionLabel}>Predicted next interaction</Text>
                <Text style={styles.relBody}>{relational.predictedNextInteraction}</Text>
              </View>
            )}

            {relational.suggestedRitual && (
              <View style={styles.ritualCallout}>
                <Text style={styles.ritualLabel}>Suggested ritual</Text>
                <Text style={styles.ritualText}>{relational.suggestedRitual}</Text>
              </View>
            )}
          </View>
        )}

        {/* Detail cards */}
        {person.description ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Description</Text>
            <Text style={styles.fieldValue}>{person.description}</Text>
          </View>
        ) : null}

        {person.dynamic ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Your Dynamic</Text>
            <Text style={styles.fieldValue}>{person.dynamic}</Text>
          </View>
        ) : null}

        {person.keyContext ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Key Context</Text>
            <Text style={styles.fieldValue}>{person.keyContext}</Text>
          </View>
        ) : null}

        {person.communicationStyle ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Communication Style</Text>
            <Text style={styles.fieldValue}>{person.communicationStyle}</Text>
          </View>
        ) : null}

        {/* Notes section */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Interaction Notes</Text>
          <View style={styles.noteInputRow}>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Log an interaction..."
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity
              style={[styles.noteSendBtn, (!noteText.trim() || noteSending) && styles.noteSendBtnDisabled]}
              onPress={handleAddNote}
              disabled={!noteText.trim() || noteSending}
            >
              <Text style={styles.noteSendBtnText}>{noteSending ? '...' : '+'}</Text>
            </TouchableOpacity>
          </View>

          {notes.length === 0 ? (
            <Text style={styles.emptyNotes}>No interactions logged yet. Log them here or Core Chat will auto-detect them.</Text>
          ) : (
            notes.map((note) => {
              const sc = note.sentiment === 'positive' ? colors.green[500] : note.sentiment === 'negative' ? colors.red[500] : colors.amber[500]
              return (
                <View key={note.id} style={styles.noteItem}>
                  <View style={[styles.noteDot, { backgroundColor: sc }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.noteMeta}>
                      <Text style={styles.noteDate}>{fmt(note.createdAt)}</Text>
                      {note.topic ? <View style={styles.topicBadge}><Text style={styles.topicBadgeText}>{note.topic}</Text></View> : null}
                      {note.source === 'core_chat' ? <Text style={styles.noteSource}>via Core</Text> : null}
                    </View>
                    <Text style={styles.noteContent}>{note.content}</Text>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <Pressable style={styles.overlay} onPress={() => setEditing(false)} />
        <KeyboardAvoidingView style={styles.editSheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.handleBar} />
          <View style={styles.editHeader}>
            <Text style={styles.editTitle}>Edit Person</Text>
            <TouchableOpacity onPress={() => setEditing(false)}><Text style={styles.editCancel}>Cancel</Text></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.editLabel}>Name *</Text>
            <TextInput style={styles.editInput} value={editForm.name} onChangeText={(v) => setEditForm({ ...editForm, name: v })} placeholder="Name" placeholderTextColor={colors.textMuted} />

            <Text style={styles.editLabel}>Phone Number</Text>
            <TextInput style={styles.editInput} value={editForm.phoneNumber} onChangeText={(v) => setEditForm({ ...editForm, phoneNumber: v })} placeholder="+91 98765 43210 or 9876543210" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.editLabel}>Relationship</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
              {RELATIONSHIP_TYPES.map((r) => (
                <TouchableOpacity key={r} style={[styles.typeChip, editForm.relationship === r && styles.typeChipActive]} onPress={() => setEditForm({ ...editForm, relationship: r })}>
                  <Text style={[styles.typeChipText, editForm.relationship === r && styles.typeChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.editLabel}>Description</Text>
            <TextInput style={[styles.editInput, { minHeight: 60 }]} value={editForm.description} onChangeText={(v) => setEditForm({ ...editForm, description: v })} placeholder="Who are they?" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.editLabel}>Your Dynamic</Text>
            <TextInput style={[styles.editInput, { minHeight: 60 }]} value={editForm.dynamic} onChangeText={(v) => setEditForm({ ...editForm, dynamic: v })} placeholder="How is your relationship?" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.editLabel}>Key Context</Text>
            <TextInput style={[styles.editInput, { minHeight: 60 }]} value={editForm.keyContext} onChangeText={(v) => setEditForm({ ...editForm, keyContext: v })} placeholder="Job, interests, relevant info" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.editLabel}>Communication Style</Text>
            <TextInput style={[styles.editInput, { minHeight: 60 }]} value={editForm.communicationStyle} onChangeText={(v) => setEditForm({ ...editForm, communicationStyle: v })} placeholder="How they talk, respond" placeholderTextColor={colors.textMuted} multiline />

            <Text style={styles.editLabel}>Love Language</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg }}>
              {LOVE_LANGUAGES.map((l) => (
                <TouchableOpacity key={l.value} style={[styles.llChip, editForm.loveLanguage.split(',').includes(l.value) && styles.llChipActive]} onPress={() => {
                  const current = editForm.loveLanguage ? editForm.loveLanguage.split(',').filter(Boolean) : []
                  const next = current.includes(l.value) ? current.filter((v) => v !== l.value) : [...current, l.value]
                  setEditForm({ ...editForm, loveLanguage: next.join(',') })
                }}>
                  <Text style={[styles.llChipText, editForm.loveLanguage.split(',').includes(l.value) && styles.llChipTextActive]}>{l.emoji} {l.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSaveEdit} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  errorText: { fontSize: FontSize.base, color: colors.red[600], marginBottom: Spacing.md },
  retryBtn: { backgroundColor: colors.primary[500], paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  retryBtnText: { color: '#ffffff', fontWeight: '700' },

  card: { backgroundColor: colors.card, marginHorizontal: Spacing.lg, marginTop: Spacing.md, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },

  // Hero card (elevated, rounded)
  heroCard: {
    backgroundColor: colors.card,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 4,
    ...neonCard(colors, isDark, 'violet'),
  },
  heroTop: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBody: {
    padding: Spacing.lg,
  },
  heroBubbleLg: {
    position: 'absolute',
    top: -40, right: -30,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroBubbleSm: {
    position: 'absolute',
    bottom: -25, left: -15,
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroTopAccent: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 4,
    backgroundColor: colors.primary[500],
  },

  // Avatar
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
    elevation: 2,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  avatarGradient: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22, shadowRadius: 6,
    elevation: 3,
  },
  avatarGradientText: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  avatarHealth: {
    position: 'absolute',
    bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 2.5, borderColor: colors.card,
  },

  // Header
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  healthDot: { width: 14, height: 14, borderRadius: 7 },
  name: { fontSize: FontSize['2xl'], fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  heroName: {
    fontSize: FontSize['2xl'], fontWeight: '800', color: '#fff', letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  relBadge: { backgroundColor: isDark ? 'rgba(244,114,182,0.18)' : '#FFE4E6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full },
  relBadgeText: { fontSize: 11, fontWeight: '700', color: isDark ? '#FDA4AF' : '#E11D48' },
  llBadge: { backgroundColor: isDark ? 'rgba(236,72,153,0.18)' : '#FCE7F3', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full },
  llBadgeText: { fontSize: 11, fontWeight: '700', color: isDark ? '#F9A8D4' : '#DB2777' },
  heroRelBadge: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full,
  },
  heroRelBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  heroLlBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full,
  },
  heroLlBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // Stats
  statsRow: { flexDirection: 'row', marginTop: 0, gap: Spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.gray[50],
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
    ...neonSoft(colors, isDark),
  },
  statEmoji: { fontSize: 18, marginBottom: 4 },
  statNum: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Actions
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  actionBtn: {
    flex: 1,
    backgroundColor: colors.gray[50],
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
    minHeight: 64,
    justifyContent: 'center',
    ...neonSoft(colors, isDark),
  },
  actionBtnEmoji: { fontSize: 20, marginBottom: 4 },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: '700', color: colors.text, textAlign: 'center' },
  actionBtnChat: { backgroundColor: colors.primary[50], borderColor: colors.primary[200] },
  actionBtnPersona: { backgroundColor: isDark ? 'rgba(167,139,250,0.18)' : '#F3E8FF', borderColor: isDark ? '#A78BFA' : '#C4B5FD' },
  actionBtnDanger: { backgroundColor: colors.red[50], borderColor: isDark ? '#F87171' : '#FCA5A5' },

  // Detail fields
  fieldLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  fieldValue: { fontSize: FontSize.sm, color: colors.text, lineHeight: 22 },

  // Notes section
  sectionTitle: { fontSize: FontSize.base, fontWeight: '700', color: colors.text, marginBottom: Spacing.md },
  noteInputRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  noteInput: { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.sm, color: colors.text, ...neonSoft(colors, isDark) },
  noteSendBtn: { width: 40, height: 40, borderRadius: BorderRadius.md, backgroundColor: colors.primary[500], justifyContent: 'center', alignItems: 'center' },
  noteSendBtnDisabled: { opacity: 0.4 },
  noteSendBtnText: { color: '#ffffff', fontSize: FontSize.lg, fontWeight: '700' },
  emptyNotes: { fontSize: FontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
  noteItem: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md, alignItems: 'flex-start' },
  noteDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
  noteDate: { fontSize: 10, color: colors.textMuted },
  topicBadge: { backgroundColor: isDark ? 'rgba(99,102,241,0.22)' : '#E0E7FF', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  topicBadgeText: { fontSize: 9, fontWeight: '700', color: isDark ? '#A5B4FC' : '#4338CA' },
  noteSource: { fontSize: 9, color: isDark ? '#C4B5FD' : '#A855F7', fontWeight: '600' },
  noteContent: { fontSize: FontSize.sm, color: colors.text, lineHeight: 20 },

  // Edit modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  editSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '85%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.xl, paddingBottom: 20, ...neonCard(colors, isDark, 'violet') },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  editTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  editCancel: { fontSize: FontSize.base, fontWeight: '600', color: colors.primary[500] },
  editLabel: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: Spacing.md },
  editInput: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: colors.text, textAlignVertical: 'top', ...neonSoft(colors, isDark) },

  typeChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm },
  typeChipActive: { backgroundColor: isDark ? 'rgba(244,114,182,0.22)' : '#FFE4E6', ...(isDark ? { borderWidth: 1, borderColor: '#FDA4AF' } : null) },
  typeChipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  typeChipTextActive: { color: isDark ? '#FDA4AF' : '#E11D48' },

  llChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], marginRight: Spacing.sm },
  llChipActive: { backgroundColor: isDark ? 'rgba(236,72,153,0.22)' : '#FCE7F3', ...(isDark ? { borderWidth: 1, borderColor: '#F9A8D4' } : null) },
  llChipText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  llChipTextActive: { color: isDark ? '#F9A8D4' : '#DB2777' },

  saveBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.md },
  saveBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },

  // Relational intelligence
  relHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  relEyebrow: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[600], textTransform: 'uppercase', letterSpacing: 0.5 },
  relTrend: { fontSize: FontSize.base, fontWeight: '700', marginTop: Spacing.xs },
  relRefreshBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  relRefreshText: { fontSize: 18, color: colors.primary[600], fontWeight: '700' },
  bondRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bondLabel: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  bondValue: { fontSize: FontSize.sm, color: colors.text, fontWeight: '700' },
  bondBarBg: { height: 6, backgroundColor: colors.gray[100], borderRadius: 3, marginTop: Spacing.xs, overflow: 'hidden' },
  bondBarFill: { height: 6, borderRadius: 3 },
  driftWarn: { marginTop: Spacing.md, padding: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: isDark ? 'rgba(245,158,11,0.14)' : colors.amber[50], borderWidth: 1, borderColor: isDark ? '#F59E0B' : colors.amber[100], ...(isDark ? { shadowColor: '#F59E0B', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  driftWarnText: { fontSize: FontSize.xs, color: colors.amber[600], fontWeight: '700' },
  relSection: { marginTop: Spacing.md },
  relSectionLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  topicChip: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100] },
  topicChipText: { fontSize: FontSize.xs, color: colors.text, fontWeight: '600' },
  frictionItem: { fontSize: FontSize.sm, color: colors.text, lineHeight: 20, marginBottom: 2 },
  relBody: { fontSize: FontSize.sm, color: colors.text, lineHeight: 20 },
  ritualCallout: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: isDark ? 'rgba(56,189,248,0.14)' : colors.primary[50], ...(isDark ? { borderWidth: 1, borderColor: '#38BDF8', shadowColor: '#38BDF8', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  ritualLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[700], marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 0.3 },
  ritualText: { fontSize: FontSize.sm, color: colors.primary[900], fontWeight: '500', lineHeight: 20 },
  // Smart direct-message CTA (WhatsApp-like)
  dmCta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xl,
    marginTop: Spacing.lg,
    gap: Spacing.md,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  dmCtaInvite: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.border, ...neonSoft(colors, isDark) },
  dmCtaChat: { backgroundColor: colors.primary[500], borderWidth: 0, ...neonCard(colors, isDark) },
  dmCtaPending: { backgroundColor: isDark ? 'rgba(245,158,11,0.16)' : '#fef3c7', borderWidth: 1, borderColor: isDark ? '#F59E0B' : '#fcd34d', ...(isDark ? { shadowColor: '#F59E0B', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  dmCtaConnect: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200], ...neonSoft(colors, isDark) },
  dmCtaEmoji: { fontSize: 26 },
  dmCtaTitle: { fontSize: FontSize.base, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  dmCtaSubtitle: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2, fontWeight: '500' },
  dmCtaArrow: { fontSize: 28, color: colors.textSecondary, fontWeight: '300' },
})
