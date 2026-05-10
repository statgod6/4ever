import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { showToast } from '../components/Toast'
import UserAvatar from '../components/UserAvatar'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'EditProfile'>

export default function EditProfileScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const { user, updateUser } = useAuthStore()
  const [name, setName] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const hasAvatar = !!user?.avatarUrl

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      showToast('Name cannot be empty', 'error')
      return
    }
    if (trimmed === user?.name) {
      navigation.goBack()
      return
    }
    setSaving(true)
    try {
      await authApi.updateProfile({ name: trimmed })
      await updateUser({ name: trimmed })
      showToast('Profile updated!', 'success')
      navigation.goBack()
    } catch {
      showToast('Failed to update profile', 'error')
    }
    setSaving(false)
  }

  const processAndUpload = async (uri: string) => {
    try {
      setUploadingAvatar(true)
      // Downscale to 512x512 max, JPEG 80% quality
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )
      const updated = await authApi.uploadAvatar(manipulated.uri)
      await updateUser({ avatarUrl: updated.avatarUrl })
      showToast('Profile picture updated!', 'success')
    } catch (err: any) {
      console.error('Avatar upload failed:', err?.message || err)
      showToast('Failed to upload picture', 'error')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      showToast('Photo library permission denied', 'error')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    })
    if (!result.canceled && result.assets[0]) {
      await processAndUpload(result.assets[0].uri)
    }
  }

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      showToast('Camera permission denied', 'error')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    })
    if (!result.canceled && result.assets[0]) {
      await processAndUpload(result.assets[0].uri)
    }
  }

  const removePhoto = async () => {
    try {
      setUploadingAvatar(true)
      await authApi.deleteAvatar()
      await updateUser({ avatarUrl: null })
      showToast('Profile picture removed', 'success')
    } catch {
      showToast('Failed to remove picture', 'error')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const openAvatarSheet = () => {
    if (uploadingAvatar) return
    const options: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }[] = [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
    ]
    if (hasAvatar) {
      options.push({ text: 'Remove Photo', onPress: removePhoto, style: 'destructive' })
    }
    options.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert('Profile Picture', 'Choose a source', options)
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Avatar Preview */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={openAvatarSheet} activeOpacity={0.8} disabled={uploadingAvatar}>
            <View style={styles.avatarWrap}>
              <UserAvatar
                name={name || user?.name}
                phoneNumber={user?.phoneNumber}
                avatarUrl={user?.avatarUrl}
                size={100}
                fontSize={36}
              />
              <View style={styles.cameraBadge}>
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.cameraBadgeIcon}>📷</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>
            {hasAvatar ? 'Tap to change your profile picture' : 'Tap to add a profile picture'}
          </Text>
        </View>

        {/* Name Field */}
        <View style={styles.fieldSection}>
          <Text style={styles.fieldLabel}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            maxLength={50}
          />
          <Text style={styles.fieldHint}>This is how others will see you in the app</Text>
        </View>

        {/* Phone (read-only) */}
        <View style={styles.fieldSection}>
          <Text style={styles.fieldLabel}>Phone Number</Text>
          <View style={styles.readOnlyField}>
            <Text style={styles.readOnlyText}>{user?.phoneNumber || ''}</Text>
            <Text style={styles.readOnlyBadge}>Verified</Text>
          </View>
          <Text style={styles.fieldHint}>Phone number cannot be changed</Text>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.xl, paddingBottom: 120 },

    avatarSection: { alignItems: 'center', marginBottom: Spacing['2xl'], marginTop: Spacing.lg },
    avatarWrap: { position: 'relative', marginBottom: Spacing.md },
    cameraBadge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary[500],
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 3,
      borderColor: colors.background,
    },
    cameraBadgeIcon: { fontSize: 14 },
    avatarHint: { fontSize: FontSize.sm, color: colors.textMuted, textAlign: 'center' },

    fieldSection: { marginBottom: Spacing.xl },
    fieldLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
    },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      fontSize: FontSize.lg,
      color: colors.text,
      fontWeight: '500',
      ...neonSoft(colors, isDark),
    },
    fieldHint: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      marginTop: Spacing.xs,
    },

    readOnlyField: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      ...neonCard(colors, isDark),
    },
    readOnlyText: {
      fontSize: FontSize.lg,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    readOnlyBadge: {
      fontSize: FontSize.xs,
      color: colors.green[600],
      fontWeight: '700',
      backgroundColor: isDark ? 'rgba(34,197,94,0.16)' : colors.green[50],
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.sm,
      overflow: 'hidden',
    },

    saveBtn: {
      backgroundColor: colors.primary[500],
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.lg,
      alignItems: 'center',
      marginTop: Spacing.md,
      ...(isDark ? { shadowColor: '#38BDF8', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null),
    },
    saveBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
  })
