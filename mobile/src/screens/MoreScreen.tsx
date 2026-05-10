import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native'
import { useAuthStore } from '../store/authStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { useVoiceStore, CORE_VOICE_OPTIONS } from '../store/voiceStore'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard } from '../constants/neonStyles'
import UserAvatar from '../components/UserAvatar'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'MoreMenu'>

const menuItems = [
  { key: 'KnowledgeWorker', icon: '💼', label: 'Knowledge Worker', screen: 'KnowledgeWorker' },
  { key: 'Personas', icon: '🎭', label: 'Personas', screen: 'Personas' },
  { key: 'Planner', icon: '📅', label: 'Day Planner', screen: 'Planner' },
  { key: 'Actions', icon: '✅', label: 'Action Items', screen: 'Actions' },
  { key: 'Insights', icon: '📊', label: 'Insights', screen: 'Insights' },
  { key: 'Reflections', icon: '✨', label: 'Reflections', screen: 'Reflections' },
  { key: 'MyContext', icon: '👤', label: 'My Context', screen: 'MyContext' },
  { key: 'Memory', icon: '🧠', label: 'Memory System', screen: 'Memory' },
  { key: 'PrivacyData', icon: '🔒', label: 'Privacy & Data', screen: 'PrivacyData' },
]

const AVATAR_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#F97316',
  '#EAB308', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  if (!name.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export default function MoreScreen({ navigation }: Props) {
  const { colors, isDark, themeMode, setThemeMode } = useTheme()
  const styles = createStyles(colors, isDark)
  const { user, logout } = useAuthStore()
  const subTier = useSubscriptionStore((s) => s.tier)
  const subActive = useSubscriptionStore((s) => s.active)
  const subLoaded = useSubscriptionStore((s) => s.loaded)
  const loadSub = useSubscriptionStore((s) => s.load)

  const coreVoice = useVoiceStore((s) => s.voice)
  const setCoreVoice = useVoiceStore((s) => s.setVoice)
  const voiceLoaded = useVoiceStore((s) => s.loaded)
  const loadVoice = useVoiceStore((s) => s.load)
  const [voiceExpanded, setVoiceExpanded] = React.useState(false)

  React.useEffect(() => {
    if (!subLoaded) loadSub()
  }, [subLoaded, loadSub])

  React.useEffect(() => {
    if (!voiceLoaded) loadVoice()
  }, [voiceLoaded, loadVoice])

  // Knowledge Worker is available to all users (pricing handled separately for non-premium).
  const visibleMenuItems = menuItems

  const themeOptions: { mode: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { mode: 'system', label: 'System', icon: '📱' },
    { mode: 'light', label: 'Light', icon: '☀️' },
    { mode: 'dark', label: 'Dark', icon: '🌙' },
  ]

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout() },
    ])
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.profileCard} activeOpacity={0.7} onPress={() => navigation.navigate('EditProfile')}>
        <UserAvatar
          name={user?.name}
          phoneNumber={user?.phoneNumber}
          avatarUrl={user?.avatarUrl}
          size={56}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{user?.name || 'Set your name'}</Text>
          <Text style={styles.userPhone}>{user?.phoneNumber || ''}</Text>
        </View>
        <Text style={styles.editHint}>Edit ›</Text>
      </TouchableOpacity>

      {/* Theme Toggle */}
      <View style={styles.themeSection}>
        <Text style={styles.themeSectionTitle}>Appearance</Text>
        <View style={styles.themeRow}>
          {themeOptions.map((opt) => (
            <TouchableOpacity
              key={opt.mode}
              style={[styles.themeBtn, themeMode === opt.mode && styles.themeBtnActive]}
              onPress={() => setThemeMode(opt.mode)}
            >
              <Text style={styles.themeIcon}>{opt.icon}</Text>
              <Text style={[styles.themeBtnLabel, themeMode === opt.mode && styles.themeBtnLabelActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Core Voice Picker (collapsible) */}
      <View style={styles.themeSection}>
        <TouchableOpacity
          style={styles.voiceSummary}
          onPress={() => setVoiceExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.voiceSummaryLabel}>Core Voice</Text>
          <View style={styles.voiceSummaryRight}>
            <Text style={styles.voiceSummaryValue}>
              {(() => {
                const cur = CORE_VOICE_OPTIONS.find((o) => o.id === coreVoice)
                if (!cur) return coreVoice
                const g = cur.gender === 'feminine' ? '♀' : cur.gender === 'masculine' ? '♂' : '◆'
                return `${g}  ${cur.label}`
              })()}
            </Text>
            <Text style={styles.voiceSummaryChevron}>{voiceExpanded ? '˅' : '˄'}</Text>
          </View>
        </TouchableOpacity>
        {voiceExpanded && (
          <View style={styles.voiceGrid}>
            {CORE_VOICE_OPTIONS.map((opt) => {
              const active = coreVoice === opt.id
              const genderIcon =
                opt.gender === 'feminine' ? '♀' : opt.gender === 'masculine' ? '♂' : '◆'
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.voiceBtn, active && styles.voiceBtnActive]}
                  onPress={() => {
                    setCoreVoice(opt.id)
                    setVoiceExpanded(false)
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.voiceGender, active && styles.voiceGenderActive]}>{genderIcon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.voiceLabel, active && styles.voiceLabelActive]}>{opt.label}</Text>
                    <Text style={[styles.voiceDesc, active && styles.voiceDescActive]}>{opt.description}</Text>
                  </View>
                  {active && <Text style={styles.voiceCheck}>✓</Text>}
                </TouchableOpacity>
              )
            })}
          </View>
        )}
      </View>

      {visibleMenuItems.map((item) => (
        <TouchableOpacity key={item.key} style={styles.menuItem} onPress={() => navigation.navigate(item.screen)}>
          <Text style={styles.menuIcon}>{item.icon}</Text>
          <Text style={styles.menuLabel}>{item.label}</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: Spacing.xl, paddingBottom: 120 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, backgroundColor: colors.card, borderRadius: BorderRadius.xl, padding: Spacing.xl, marginBottom: Spacing.xl, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark, 'violet') },
  avatar: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#ffffff', fontSize: FontSize['2xl'], fontWeight: '700' },
  userName: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  userPhone: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
  editHint: { fontSize: FontSize.sm, color: colors.primary[500], fontWeight: '600' },
  menuItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  menuIcon: { fontSize: 20, marginRight: Spacing.md },
  menuLabel: { flex: 1, fontSize: FontSize.base, fontWeight: '500', color: colors.text },
  menuArrow: { fontSize: FontSize.xl, color: colors.textMuted },
  logoutBtn: { marginTop: Spacing.xl, backgroundColor: isDark ? 'rgba(239,68,68,0.14)' : colors.red[50], borderRadius: BorderRadius.lg, paddingVertical: Spacing.lg, alignItems: 'center', borderWidth: 1, borderColor: isDark ? '#F87171' : colors.red[100], ...(isDark ? { shadowColor: '#F87171', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  logoutText: { fontSize: FontSize.base, fontWeight: '600', color: isDark ? '#FCA5A5' : colors.red[600] },
  themeSection: { marginBottom: Spacing.lg },
  themeSectionTitle: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 1 },
  themeRow: { flexDirection: 'row', gap: Spacing.sm },
  themeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  themeBtnActive: { borderColor: colors.primary[500], backgroundColor: isDark ? 'rgba(56,189,248,0.18)' : colors.primary[50], ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  themeIcon: { fontSize: 16 },
  themeBtnLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },
  themeBtnLabelActive: { color: colors.primary[600] },
  voiceHint: { fontSize: FontSize.xs, color: colors.textMuted, marginBottom: Spacing.sm },
  voiceSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, backgroundColor: colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: Spacing.sm },
  voiceSummaryLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  voiceSummaryRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  voiceSummaryValue: { fontSize: FontSize.base, fontWeight: '700', color: colors.primary[600] },
  voiceSummaryChevron: { fontSize: FontSize.lg, color: colors.textMuted, fontWeight: '700' },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  voiceBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, width: '48.5%', minHeight: 54 },
  voiceBtnActive: { borderColor: colors.primary[500], backgroundColor: isDark ? 'rgba(56,189,248,0.18)' : colors.primary[50], ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  voiceGender: { fontSize: 18, color: colors.textMuted, width: 18, textAlign: 'center' },
  voiceGenderActive: { color: colors.primary[600] },
  voiceLabel: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text },
  voiceLabelActive: { color: colors.primary[600] },
  voiceDesc: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  voiceDescActive: { color: colors.primary[600] },
  voiceCheck: { fontSize: FontSize.base, color: colors.primary[600], fontWeight: '700' },
})
