import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { userContextApi, type UserContext } from '../api/userContext'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonSoft } from '../constants/neonStyles'
import { showToast } from '../components/Toast'

const fields: { key: keyof UserContext; label: string; multiline?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age' },
  { key: 'location', label: 'Location' },
  { key: 'role', label: 'Role / Occupation' },
  { key: 'background', label: 'Background', multiline: true },
  { key: 'currentProjects', label: 'Current Projects', multiline: true },
  { key: 'goals', label: 'Goals', multiline: true },
  { key: 'situation', label: 'Current Situation', multiline: true },
  { key: 'values', label: 'Values', multiline: true },
  { key: 'pendingDecisions', label: 'Pending Decisions', multiline: true },
  { key: 'freeformContext', label: 'Additional Context', multiline: true },
]

export default function MyContextScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const [context, setContext] = useState<UserContext>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    userContextApi.get().then(setContext).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try { await userContextApi.update(context); showToast('Context saved!', 'success') }
    catch { showToast('Failed to save', 'error') }
    setSaving(false)
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>My Context</Text>
        <Text style={styles.subtitle}>This information helps your AI personas give more personalized advice.</Text>

        {fields.map((f) => (
          <View key={f.key} style={styles.field}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput
              style={[styles.input, f.multiline && styles.multiline]}
              value={(context[f.key] as string) || ''}
              onChangeText={(text) => setContext((prev) => ({ ...prev, [f.key]: text }))}
              placeholder={`Enter ${f.label.toLowerCase()}...`}
              placeholderTextColor={colors.textMuted}
              multiline={f.multiline}
              textAlignVertical={f.multiline ? 'top' : 'center'}
            />
          </View>
        ))}

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Context'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: Spacing.xl, paddingBottom: 120 },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  field: { marginBottom: Spacing.md },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text, marginBottom: Spacing.xs },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.base, color: colors.text, ...neonSoft(colors, isDark) },
  multiline: { minHeight: 80 },
  saveBtn: { backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.lg, ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null) },
  saveBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
})
