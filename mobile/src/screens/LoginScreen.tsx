import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonSoft } from '../constants/neonStyles'
import { showToast } from '../components/Toast'

type Step = 'phone' | 'otp' | 'name'

export default function LoginScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [step, setStep] = useState<Step>('phone')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startCountdown = () => {
    setCountdown(60)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleRequestOtp = async () => {
    if (!phoneNumber.trim()) {
      showToast('Please enter your phone number', 'error')
      return
    }
    setLoading(true)
    try {
      await authApi.requestOtp({ phoneNumber: phoneNumber.trim() })
      setStep('otp')
      startCountdown()
      showToast('Verification code sent!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to send OTP', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      showToast('Please enter the 6-digit code', 'error')
      return
    }
    setLoading(true)
    try {
      const response = await authApi.verifyOtp({
        phoneNumber: phoneNumber.trim(),
        code: otpCode,
      })

      if (response.isNewUser) {
        // Temporarily store credentials, ask for name
        await setAuth(response.access_token, response.user)
        setStep('name')
      } else {
        await setAuth(response.access_token, response.user)
        showToast('Welcome back!', 'success')
      }
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Invalid OTP', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSetName = async () => {
    if (!name.trim()) {
      showToast('Please enter your name', 'error')
      return
    }
    setLoading(true)
    try {
      const updatedUser = await authApi.setName({ name: name.trim() })
      const token = useAuthStore.getState().token!
      await setAuth(token, updatedUser)
      showToast('Welcome to 4Ever!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to set name', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (countdown > 0) return
    setLoading(true)
    try {
      await authApi.requestOtp({ phoneNumber: phoneNumber.trim() })
      startCountdown()
      showToast('Code resent!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Failed to resend', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>4Ever</Text>
          <Text style={styles.subtitle}>Your AI-Powered Life OS</Text>
        </View>

        {/* Step indicators */}
        <View style={styles.stepRow}>
          <View style={[styles.stepDot, step === 'phone' && styles.stepDotActive]} />
          <View style={[styles.stepDot, step === 'otp' && styles.stepDotActive]} />
          <View style={[styles.stepDot, step === 'name' && styles.stepDotActive]} />
        </View>

        <View style={styles.form}>
          {/* Phone Step */}
          {step === 'phone' && (
            <>
              <Text style={styles.stepTitle}>Enter your phone number</Text>
              <Text style={styles.stepDesc}>We'll send you a verification code</Text>

              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="+919876543210"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                autoFocus
              />
              <Text style={styles.hint}>Include country code (e.g., +91 for India)</Text>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleRequestOtp}
                disabled={loading || !phoneNumber.trim()}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Sending...' : 'Send Verification Code'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* OTP Step */}
          {step === 'otp' && (
            <>
              <Text style={styles.stepTitle}>Verify your number</Text>
              <Text style={styles.stepDesc}>Code sent to {phoneNumber}</Text>

              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                value={otpCode}
                onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="------"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />

              <TouchableOpacity
                style={[styles.button, (loading || otpCode.length !== 6) && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading || otpCode.length !== 6}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Verifying...' : 'Verify'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleResendOtp}
                disabled={countdown > 0 || loading}
                style={styles.linkContainer}
              >
                <Text style={[styles.linkText, countdown > 0 && { color: colors.textMuted }]}>
                  {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { setStep('phone'); setOtpCode('') }}
                style={styles.linkContainer}
              >
                <Text style={styles.changeText}>Change phone number</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Name Step */}
          {step === 'name' && (
            <>
              <Text style={styles.stepTitle}>What should we call you?</Text>
              <Text style={styles.stepDesc}>This is how you'll appear to your connections</Text>

              <Text style={styles.label}>Your Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoFocus
              />

              <TouchableOpacity
                style={[styles.button, (loading || !name.trim()) && styles.buttonDisabled]}
                onPress={handleSetName}
                disabled={loading || !name.trim()}
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Setting up...' : 'Continue'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing['2xl'] },
  header: { alignItems: 'center', marginBottom: Spacing.xl },
  logo: { fontSize: 42, fontWeight: '800', color: colors.primary[600] },
  subtitle: { fontSize: FontSize.base, color: colors.textSecondary, marginTop: Spacing.xs },
  stepRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: Spacing.xl },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  stepDotActive: { width: 24, backgroundColor: colors.primary[500] },
  form: { width: '100%' },
  stepTitle: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 4 },
  stepDesc: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text, marginBottom: Spacing.xs, marginTop: Spacing.lg },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.base,
    color: colors.text,
    ...neonSoft(colors, isDark),
  },
  otpInput: {
    textAlign: 'center', fontSize: 28, letterSpacing: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 4 },
  button: {
    backgroundColor: colors.primary[500], borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing['2xl'],
    ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
  linkContainer: { marginTop: Spacing.lg, alignItems: 'center' },
  linkText: { fontSize: FontSize.sm, color: colors.primary[500], fontWeight: '600' },
  changeText: { fontSize: FontSize.sm, color: colors.textSecondary },
})
