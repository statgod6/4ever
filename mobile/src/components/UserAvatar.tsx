import React, { useState, useEffect } from 'react'
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, TextStyle, ImageStyle } from 'react-native'
import { resolveAvatarUrl } from '../api/client'

const AVATAR_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E', '#F97316',
  '#EAB308', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6',
]

function getAvatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

interface Props {
  name?: string | null
  phoneNumber?: string | null
  avatarUrl?: string | null
  size: number
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  /** Fallback text fontSize; defaults to size * 0.4 */
  fontSize?: number
}

/**
 * Unified user avatar. Renders the uploaded profile picture when `avatarUrl`
 * is present (and reachable), otherwise falls back to a coloured circle with
 * the user's initials. Automatically falls back on image load error.
 */
export default function UserAvatar({ name, phoneNumber, avatarUrl, size, style, textStyle, fontSize }: Props) {
  const resolved = resolveAvatarUrl(avatarUrl)
  const [failed, setFailed] = useState(false)

  // Reset failure state when the URL changes so a freshly-uploaded image
  // gets a chance to load.
  useEffect(() => { setFailed(false) }, [resolved])

  const bgColor = getAvatarColor(phoneNumber || name || 'U')
  const initials = getInitials(name || '')
  const radius = size / 2

  if (resolved && !failed) {
    return (
      <Image
        source={{ uri: resolved }}
        style={[{ width: size, height: size, borderRadius: radius, backgroundColor: bgColor }, style as StyleProp<ImageStyle>]}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: bgColor },
        style,
      ]}
    >
      <Text style={[styles.fallbackText, { fontSize: fontSize ?? Math.round(size * 0.4) }, textStyle]}>
        {initials}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: { justifyContent: 'center', alignItems: 'center' },
  fallbackText: { color: '#ffffff', fontWeight: '700' },
})
