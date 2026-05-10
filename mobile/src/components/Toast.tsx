import React, { useEffect, useRef, useState } from 'react'
import { Animated, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'

type ToastType = 'success' | 'error' | 'info'

interface ToastMessage {
  id: number
  message: string
  type: ToastType
}

let toastId = 0
let addToastFn: ((msg: string, type: ToastType) => void) | null = null

export function showToast(message: string, type: ToastType = 'info') {
  addToastFn?.(message, type)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme()
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    addToastFn = (message: string, type: ToastType) => {
      const id = ++toastId
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3000)
    }
    return () => { addToastFn = null }
  }, [])

  return (
    <>
      {children}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} colors={colors} onDismiss={() => {
          setToasts((prev) => prev.filter((t) => t.id !== toast.id))
        }} />
      ))}
    </>
  )
}

function ToastItem({ toast, colors, onDismiss }: { toast: ToastMessage; colors: typeof Colors; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2400),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start()
  }, [])

  const bgColor = toast.type === 'success' ? colors.green[600]
    : toast.type === 'error' ? colors.red[600]
    : colors.primary[600]

  return (
    <Animated.View style={[toastStyles.toast, { opacity, backgroundColor: bgColor }]}>
      <TouchableOpacity onPress={onDismiss}>
        <Text style={toastStyles.toastText}>{toast.message}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

const toastStyles = StyleSheet.create({
  toast: {
    position: 'absolute', top: 60, left: Spacing.lg, right: Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md, zIndex: 9999,
  },
  toastText: { color: '#ffffff', fontSize: FontSize.sm, fontWeight: '600', textAlign: 'center' },
})
