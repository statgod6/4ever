import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'
import { consentApi, ConsentKind } from '../api/consent'
import { supportApi, SupportCategory } from '../api/support'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'PrivacyData'>

/**
 * Privacy & Data screen — surfaces the three App-Store / GDPR-mandatory user
 * controls in one place so reviewers (and users) can find them quickly:
 *
 *   1. Export my data         → GET /users/me/export, writes to cache + shares
 *   2. Delete my account      → OTP re-verification, then DELETE /users/me
 *   3. Legal / consent review → displays accepted versions + links to policies
 *
 * Every destructive action funnels through a confirmation dialog so a
 * misbehaving tap cannot cause irreversible data loss.
 */
export default function PrivacyDataScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const [exporting, setExporting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [otpStep, setOtpStep] = React.useState<'idle' | 'awaiting-otp'>('idle')
  const [otpCode, setOtpCode] = React.useState('')
  const [sendingOtp, setSendingOtp] = React.useState(false)

  const [consentStatus, setConsentStatus] = React.useState<Awaited<
    ReturnType<typeof consentApi.getStatus>
  > | null>(null)
  const [consentLoading, setConsentLoading] = React.useState(true)

  // Support / abuse report inline form state.
  const [supportCategory, setSupportCategory] = React.useState<SupportCategory>('bug')
  const [supportMessage, setSupportMessage] = React.useState('')
  const [submittingReport, setSubmittingReport] = React.useState(false)

  const handleSubmitReport = async () => {
    const msg = supportMessage.trim()
    if (msg.length < 10) {
      Alert.alert('Too short', 'Please describe the problem in at least 10 characters.')
      return
    }
    setSubmittingReport(true)
    try {
      const res = await supportApi.report({ category: supportCategory, message: msg })
      setSupportMessage('')
      Alert.alert('Thanks', res.message)
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 429) {
        Alert.alert('Please wait', 'You can submit up to 3 reports per hour.')
      } else {
        Alert.alert('Could not send', err?.response?.data?.message || err?.message || 'Try again in a moment.')
      }
    } finally {
      setSubmittingReport(false)
    }
  }

  const handleEmailSupport = () => {
    Linking.openURL('mailto:support@4ever.app?subject=4Ever%20support%20request').catch(() => {
      Alert.alert('No email app', 'Please email support@4ever.app directly.')
    })
  }

  // ─── Consent status ───────────────────────────────────────────────────────
  const loadConsent = React.useCallback(async () => {
    try {
      const s = await consentApi.getStatus()
      setConsentStatus(s)
    } catch {
      // Non-fatal — consent enforcement is soft-gated; just show unknown state.
    } finally {
      setConsentLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadConsent()
  }, [loadConsent])

  // ─── Export ───────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (exporting) return
    try {
      setExporting(true)
      const data = await authApi.exportMyData()
      // Write JSON to cache (ephemeral, OS-managed) and hand off to share sheet.
      // We deliberately use cacheDirectory (not documentDirectory) so this dump
      // is not permanently stored on-device after the share completes.
      const filename = `4ever-data-export-${Date.now()}.json`
      const cacheDir = FileSystem.cacheDirectory
      if (!cacheDir) throw new Error('cache directory unavailable')
      const uri = `${cacheDir}${filename}`
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your 4Ever data export',
          UTI: 'public.json',
        })
      } else {
        Alert.alert('Export ready', `Saved to ${uri}`)
      }
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 429) {
        Alert.alert('Too many requests', 'You can export your data at most 5 times per hour.')
      } else {
        Alert.alert('Export failed', err?.response?.data?.message || err?.message || 'Please try again.')
      }
    } finally {
      setExporting(false)
    }
  }

  // ─── Delete account (OTP re-verify flow) ──────────────────────────────────
  const startDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently erases your thoughts, memories, Circle connections, uploads, and every piece of data in your account. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => requestDeleteOtp(),
        },
      ],
    )
  }

  const requestDeleteOtp = async () => {
    if (!user?.phoneNumber) {
      Alert.alert('Error', 'No phone number on file — please sign in again.')
      return
    }
    try {
      setSendingOtp(true)
      await authApi.requestOtp({ phoneNumber: user.phoneNumber })
      setOtpStep('awaiting-otp')
      setOtpCode('')
    } catch (err: any) {
      Alert.alert('Could not send code', err?.response?.data?.message || err?.message || 'Please try again.')
    } finally {
      setSendingOtp(false)
    }
  }

  const confirmDelete = async () => {
    if (deleting) return
    if (!otpCode || otpCode.length < 4) {
      Alert.alert('Enter the code', 'Type the 6-digit verification code we just sent you.')
      return
    }
    try {
      setDeleting(true)
      await authApi.deleteMyAccount({ otpCode })
      // Backend returned success — clear local session and bounce to login.
      Alert.alert(
        'Account deleted',
        'Your account and all associated data have been permanently removed.',
        [{ text: 'OK', onPress: () => logout() }],
      )
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Please try again.'
      Alert.alert('Delete failed', msg)
      setDeleting(false)
    }
  }

  const cancelDelete = () => {
    setOtpStep('idle')
    setOtpCode('')
  }

  // ─── Legal links ──────────────────────────────────────────────────────────
  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Cannot open link', url)
    })
  }

  const prettyKind = (k: ConsentKind) =>
    ({
      privacy_policy: 'Privacy Policy',
      terms_of_service: 'Terms of Service',
      ai_disclosure: 'AI Usage Disclosure',
      age_confirmation: 'Age Confirmation (13+)',
    }[k])

  const acceptAllMissing = async () => {
    if (!consentStatus || consentStatus.missing.length === 0) return
    try {
      await consentApi.accept(consentStatus.missing)
      await loadConsent()
    } catch (err: any) {
      Alert.alert('Could not record consent', err?.response?.data?.message || err?.message || 'Please try again.')
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Your data is yours. Export a full copy at any time, or permanently delete your account and
        everything we store about you.
      </Text>

      {/* ─── Export ───────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Export my data</Text>
        <Text style={styles.cardDesc}>
          Download a JSON file containing every thought, memory, relationship, ritual, and
          reflection you have ever created. Limited to 5 exports per hour.
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, exporting && styles.btnDisabled]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Export my data</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ─── Legal / consent ─────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Legal &amp; AI disclosure</Text>
        {consentLoading ? (
          <ActivityIndicator color={colors.primary[500]} />
        ) : consentStatus ? (
          <>
            {(Object.keys(consentStatus.currentVersions) as ConsentKind[]).map((k) => {
              const required = consentStatus.currentVersions[k]
              const accepted = consentStatus.accepted[k]
              const ok = accepted?.version === required
              return (
                <View key={k} style={styles.consentRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.consentLabel}>{prettyKind(k)}</Text>
                    <Text style={styles.consentSub}>
                      {ok
                        ? `Accepted v${accepted!.version}`
                        : accepted
                        ? `Needs re-acceptance (you accepted v${accepted.version}, current is v${required})`
                        : `Not yet accepted (v${required})`}
                    </Text>
                  </View>
                  <Text style={[styles.consentDot, { color: ok ? colors.green[500] : '#F59E0B' }]}>
                    {ok ? '●' : '○'}
                  </Text>
                </View>
              )
            })}
            {!consentStatus.isComplete && (
              <TouchableOpacity style={styles.primaryBtn} onPress={acceptAllMissing}>
                <Text style={styles.primaryBtnText}>Accept outstanding terms</Text>
              </TouchableOpacity>
            )}
            <View style={{ marginTop: Spacing.md, gap: Spacing.xs }}>
              <TouchableOpacity onPress={() => openUrl('https://4ever.app/privacy')}>
                <Text style={styles.link}>Read Privacy Policy →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openUrl('https://4ever.app/terms')}>
                <Text style={styles.link}>Read Terms of Service →</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.cardDesc}>Consent information is temporarily unavailable.</Text>
        )}
      </View>

      {/* ─── Delete ──────────────────────────────────────────────────── */}
      {/* Contact & report */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Contact &amp; report</Text>
        <Text style={styles.cardDesc}>
          Email us directly, or file a report below for bugs, abusive content, or privacy concerns.
          Limited to 3 reports per hour.
        </Text>

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleEmailSupport}>
          <Text style={styles.secondaryBtnText}>Email support@4ever.app</Text>
        </TouchableOpacity>

        <Text style={styles.reportLabel}>Category</Text>
        <View style={styles.categoryRow}>
          {(['bug', 'abuse', 'privacy', 'feature', 'other'] as SupportCategory[]).map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setSupportCategory(c)}
              style={[styles.categoryChip, supportCategory === c && styles.categoryChipActive]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  supportCategory === c && styles.categoryChipTextActive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.reportInput}
          value={supportMessage}
          onChangeText={setSupportMessage}
          placeholder="Describe the issue..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={4}
          maxLength={4000}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (submittingReport || supportMessage.trim().length < 10) && styles.btnDisabled,
          ]}
          onPress={handleSubmitReport}
          disabled={submittingReport || supportMessage.trim().length < 10}
        >
          {submittingReport ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Submit report</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, styles.dangerCard]}>
        <Text style={styles.cardTitle}>Delete my account</Text>
        <Text style={styles.cardDesc}>
          Permanently remove your account and every piece of data associated with it. This action
          cannot be undone and cannot be recovered.
        </Text>

        {otpStep === 'idle' ? (
          <TouchableOpacity
            style={[styles.dangerBtn, sendingOtp && styles.btnDisabled]}
            onPress={startDelete}
            disabled={sendingOtp}
          >
            {sendingOtp ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.dangerBtnText}>Delete my account</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View>
            <Text style={styles.otpHint}>
              We sent a verification code to {user?.phoneNumber}. Enter it below to confirm.
            </Text>
            <TextInput
              style={styles.otpInput}
              keyboardType="number-pad"
              autoFocus
              maxLength={8}
              value={otpCode}
              onChangeText={setOtpCode}
              placeholder="------"
              placeholderTextColor={colors.textMuted}
              editable={!deleting}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={cancelDelete}
                disabled={deleting}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dangerBtn, { flex: 1 }, deleting && styles.btnDisabled]}
                onPress={confirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.dangerBtnText}>Confirm delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.xl, paddingBottom: 120 },
    intro: { fontSize: FontSize.base, color: colors.textSecondary, marginBottom: Spacing.lg, lineHeight: 22 },
    card: {
      backgroundColor: colors.card,
      borderRadius: BorderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    dangerCard: {
      borderColor: isDark ? '#F87171' : colors.red[200],
      backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : colors.red[50],
    },
    cardTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.xs },
    cardDesc: { fontSize: FontSize.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: Spacing.md },
    primaryBtn: {
      backgroundColor: colors.primary[500],
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    primaryBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },
    secondaryBtn: {
      backgroundColor: 'transparent',
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryBtnText: { color: colors.text, fontSize: FontSize.base, fontWeight: '600' },
    dangerBtn: {
      backgroundColor: isDark ? '#DC2626' : colors.red[600],
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
    },
    dangerBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },
    btnDisabled: { opacity: 0.6 },
    otpHint: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.sm },
    otpInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      letterSpacing: 8,
      backgroundColor: colors.background,
      marginBottom: Spacing.md,
    },
    consentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    consentLabel: { fontSize: FontSize.base, fontWeight: '600', color: colors.text },
    consentSub: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },
    consentDot: { fontSize: 18, marginLeft: Spacing.md },
    link: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary[500] },
    reportLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm as any, marginBottom: Spacing.md },
    categoryChip: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: 'transparent',
      marginRight: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    categoryChipActive: {
      borderColor: colors.primary[500],
      backgroundColor: isDark ? colors.primary[500] + '22' : colors.primary[500] + '15',
    },
    categoryChipText: { fontSize: FontSize.sm, color: colors.textSecondary, textTransform: 'capitalize' },
    categoryChipTextActive: { color: colors.primary[500], fontWeight: '600' },
    reportInput: {
      minHeight: 96,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      color: colors.text,
      fontSize: FontSize.base,
      marginBottom: Spacing.md,
      backgroundColor: isDark ? colors.card : '#fff',
    },
  })
