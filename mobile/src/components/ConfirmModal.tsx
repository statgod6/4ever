import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'

interface ConfirmModalProps {
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
}

export function ConfirmModal({
  visible, title, message, confirmText = 'Confirm', cancelText = 'Cancel',
  onConfirm, onCancel, destructive = false,
}: ConfirmModalProps) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, destructive && styles.destructiveBtn]}
              onPress={onConfirm}
            >
              <Text style={[styles.confirmText, destructive && styles.destructiveText]}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const createStyles = (colors: typeof Colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  modal: { backgroundColor: colors.card, borderRadius: BorderRadius.xl, padding: Spacing['2xl'], width: '100%', maxWidth: 340 },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
  message: { fontSize: FontSize.base, color: colors.textSecondary, marginBottom: Spacing['2xl'], lineHeight: 22 },
  buttons: { flexDirection: 'row', gap: Spacing.md },
  cancelBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: colors.gray[100], alignItems: 'center' },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: colors.textSecondary },
  confirmBtn: { flex: 1, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: colors.primary[500], alignItems: 'center' },
  confirmText: { fontSize: FontSize.base, fontWeight: '600', color: '#ffffff' },
  destructiveBtn: { backgroundColor: colors.red[500] },
  destructiveText: { color: '#ffffff' },
})
