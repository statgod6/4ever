import React from 'react'
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native'
import { Colors, FontSize, Spacing } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'

export function LoadingScreen({ message }: { message?: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary[500]} />
      {message && <Text style={styles.text}>{message}</Text>}
    </View>
  )
}

export function EmptyState({ icon, title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.emptyContainer}>
      {icon && <Text style={styles.emptyIcon}>{icon}</Text>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
    </View>
  )
}

const createStyles = (colors: typeof Colors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  text: { marginTop: Spacing.md, fontSize: FontSize.base, color: colors.textSecondary },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing['3xl'] },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.lg },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptySubtitle: { fontSize: FontSize.base, color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
})
