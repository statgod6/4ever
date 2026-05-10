import React, { useState } from 'react'
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
  Pressable, Dimensions,
} from 'react-native'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import type { Persona } from '../api/personas'

const SCREEN_HEIGHT = Dimensions.get('window').height

// Generate a consistent color from persona name
const AVATAR_COLORS = [
  '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#06B6D4',
  '#A855F7', '#84CC16', '#E11D48', '#0891B2', '#D946EF',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

interface Props {
  personas: Persona[]
  selectedIds: string[]
  onToggle: (id: string) => void
  label?: string
}

export default function PersonaPickerSheet({ personas, selectedIds, onToggle, label = 'Analyze with Personas' }: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const [visible, setVisible] = useState(false)

  const selectedPersonas = personas.filter((p) => selectedIds.includes(p.id))

  if (personas.length === 0) return null

  return (
    <>
      {/* Label */}
      <Text style={styles.label}>{label}</Text>

      {/* Avatar stack row */}
      <TouchableOpacity style={styles.pickerRow} onPress={() => setVisible(true)} activeOpacity={0.7}>
        {selectedPersonas.length === 0 ? (
          <View style={styles.emptyRow}>
            <View style={styles.addBtnLarge}>
              <Text style={styles.addBtnText}>+</Text>
            </View>
            <Text style={styles.emptyText}>Tap to select personas</Text>
          </View>
        ) : (
          <View style={styles.stackRow}>
            {/* Overlapping avatars */}
            <View style={styles.avatarStack}>
              {selectedPersonas.slice(0, 5).map((p, i) => {
                const bg = getAvatarColor(p.name)
                return (
                  <View
                    key={p.id}
                    style={[
                      styles.avatar,
                      { backgroundColor: bg, marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i },
                    ]}
                  >
                    <Text style={styles.avatarText}>{getInitials(p.name)}</Text>
                  </View>
                )
              })}
              {selectedPersonas.length > 5 && (
                <View style={[styles.avatar, styles.avatarMore, { marginLeft: -10, zIndex: 4 }]}>
                  <Text style={styles.avatarMoreText}>+{selectedPersonas.length - 5}</Text>
                </View>
              )}
            </View>

            {/* Count + edit hint */}
            <View style={styles.stackInfo}>
              <Text style={styles.stackCount}>
                {selectedPersonas.length} selected
              </Text>
              <Text style={styles.stackHint}>Tap to change</Text>
            </View>

            {/* Add/edit button */}
            <View style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* Bottom Sheet Modal */}
      <Modal visible={visible} animationType="slide" transparent onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setVisible(false)} />
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select Personas</Text>
            <TouchableOpacity onPress={() => setVisible(false)}>
              <Text style={styles.doneBtn}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Selected count */}
          <Text style={styles.sheetSubtitle}>
            {selectedIds.length} of {personas.length} selected
          </Text>

          {/* Persona list */}
          <ScrollView
            style={styles.sheetList}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {personas.map((p) => {
              const isSelected = selectedIds.includes(p.id)
              const bg = getAvatarColor(p.name)
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.sheetItem, isSelected && styles.sheetItemActive]}
                  onPress={() => onToggle(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sheetAvatar, { backgroundColor: bg }]}>
                    <Text style={styles.sheetAvatarText}>{getInitials(p.name)}</Text>
                  </View>
                  <View style={styles.sheetItemInfo}>
                    <Text style={[styles.sheetItemName, isSelected && styles.sheetItemNameActive]}>
                      {p.name}
                    </Text>
                    {p.description ? (
                      <Text style={styles.sheetItemDesc} numberOfLines={1}>{p.description}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

const createStyles = (colors: typeof Colors) => StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text, marginBottom: Spacing.xs, marginTop: Spacing.lg },

  // Picker row (the trigger)
  pickerRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  addBtnLarge: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary[50],
    borderWidth: 2, borderColor: colors.primary[300],
    borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { fontSize: 20, color: colors.primary[500], fontWeight: '600' },
  emptyText: { fontSize: FontSize.sm, color: colors.textMuted },

  stackRow: { flexDirection: 'row', alignItems: 'center' },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: colors.card,
  },
  avatarText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  avatarMore: { backgroundColor: colors.gray[400] },
  avatarMoreText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  stackInfo: { flex: 1, marginLeft: Spacing.md },
  stackCount: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text },
  stackHint: { fontSize: FontSize.xs, color: colors.textMuted },
  editBtn: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: colors.primary[200],
  },
  editBtnText: { fontSize: FontSize.xs, fontWeight: '700', color: colors.primary[600] },

  // Modal overlay
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },

  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    maxHeight: SCREEN_HEIGHT * 0.65,
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.xl,
    paddingBottom: 20,
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.gray[300],
    alignSelf: 'center',
    marginTop: Spacing.sm, marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  doneBtn: { fontSize: FontSize.base, fontWeight: '700', color: colors.primary[500] },
  sheetSubtitle: { fontSize: FontSize.xs, color: colors.textMuted, marginBottom: Spacing.md },

  sheetList: { },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: 2,
  },
  sheetItemActive: { backgroundColor: colors.primary[50] },
  sheetAvatar: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetAvatarText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  sheetItemInfo: { flex: 1, marginLeft: Spacing.md },
  sheetItemName: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
  sheetItemNameActive: { color: colors.primary[700] },
  sheetItemDesc: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 1 },

  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: colors.gray[300],
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  checkmark: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
})
