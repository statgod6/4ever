import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, ActivityIndicator, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { personasApi, type Persona } from '../api/personas'
import { knowledgeBaseApi, type PersonaDocumentInfo } from '../api/knowledgeBase'
import { usePersonaStore } from '../store/personaStore'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import { EmptyState } from '../components/LoadingState'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'Personas'>

const CATEGORIES = [
  'All',
  'Mine',
  'Business & Strategy',
  'Creative & Writing',
  'Technical & Science',
  'Personal Growth',
  'Philosophy & Ethics',
  'Finance & Investment',
  'Health & Wellness',
  'Education & Research',
  'Leadership & Management',
  'Communication & Social',
]

const MODEL_OPTIONS = [
  { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
]

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function KnowledgeBaseSection({ personaId }: { personaId: string }) {
  const { colors } = useTheme()
  const kbStyles = createKbStyles(colors)
  const [expanded, setExpanded] = useState(false)
  const [docs, setDocs] = useState<PersonaDocumentInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await knowledgeBaseApi.getDocuments(personaId)
      setDocs(data)
    } catch {} finally { setLoading(false) }
  }, [personaId])

  useEffect(() => {
    if (expanded) loadDocs()
  }, [expanded])

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.length) return
      const file = result.assets[0]
      setUploading(true)
      setUploadProgress(0)
      await knowledgeBaseApi.uploadDocument(
        personaId,
        file.uri,
        file.name,
        file.mimeType || 'application/pdf',
        (p) => setUploadProgress(p),
      )
      showToast('Document uploaded & indexed', 'success')
      await loadDocs()
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Upload failed', 'error')
    } finally { setUploading(false) }
  }

  const handleDeleteDoc = (doc: PersonaDocumentInfo) => {
    Alert.alert('Delete Document', `Remove "${doc.filename}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await knowledgeBaseApi.deleteDocument(doc.id)
          setDocs((prev) => prev.filter((d) => d.id !== doc.id))
          showToast('Document removed', 'success')
        } catch { showToast('Failed to delete', 'error') }
      }},
    ])
  }

  return (
    <View style={kbStyles.container}>
      <TouchableOpacity style={kbStyles.header} onPress={() => setExpanded(!expanded)}>
        <Text style={kbStyles.headerText}>📄 Knowledge Base ({docs.length})</Text>
        <Text style={kbStyles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={kbStyles.body}>
          {docs.length < 1 && (
            <TouchableOpacity style={kbStyles.uploadBtn} onPress={handleUpload} disabled={uploading}>
              {uploading ? (
                <View style={kbStyles.uploadingRow}>
                  <ActivityIndicator size="small" color={colors.primary[600]} />
                  <Text style={kbStyles.uploadingText}>Uploading {uploadProgress}%</Text>
                </View>
              ) : (
                <Text style={kbStyles.uploadBtnText}>+ Upload PDF</Text>
              )}
            </TouchableOpacity>
          )}
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary[500]} style={{ marginTop: 8 }} />
          ) : docs.length === 0 ? (
            <Text style={kbStyles.emptyText}>No documents yet. Upload a PDF to give this persona knowledge.</Text>
          ) : (
            docs.map((doc) => (
              <View key={doc.id} style={kbStyles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={kbStyles.docName} numberOfLines={1}>{doc.filename}</Text>
                  <Text style={kbStyles.docMeta}>{formatFileSize(doc.fileSize)} · {doc.chunkCount} chunks</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteDoc(doc)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={kbStyles.deleteBtn}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  )
}

export default function PersonasScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const { personas, setPersonas, removePersona, addPersona, updatePersona } = usePersonaStore()
  const modalStyles = createModalStyles(colors, isDark)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  const [form, setForm] = useState({ name: '', description: '', systemPrompt: '', modelName: 'deepseek/deepseek-v3.2' })

  const filteredPersonas = useMemo(() => {
    if (selectedCategory === 'All') return personas
    if (selectedCategory === 'Mine') return personas.filter((p) => !p.isTemplate)
    return personas.filter((p) => p.category === selectedCategory)
  }, [personas, selectedCategory])

  const load = async () => {
    try { const data = await personasApi.getAll(); setPersonas(data) } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditingPersona(null)
    setForm({ name: '', description: '', systemPrompt: '', modelName: 'deepseek/deepseek-v3.2' })
    setShowModal(true)
  }

  const openEdit = (p: Persona) => {
    setEditingPersona(p)
    setForm({ name: p.name, description: p.description || '', systemPrompt: p.systemPrompt, modelName: p.modelName })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) { showToast('Name and system prompt required', 'error'); return }
    setSaving(true)
    try {
      if (editingPersona) {
        const updated = await personasApi.update(editingPersona.id, form)
        updatePersona(updated)
        showToast('Persona updated', 'success')
      } else {
        const created = await personasApi.create(form)
        addPersona(created)
        showToast('Persona created', 'success')
      }
      setShowModal(false)
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Failed to save', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete', `Delete persona "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await personasApi.delete(id); removePersona(id); showToast('Deleted', 'success') } catch { showToast('Failed', 'error') }
      }},
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.heading}>Personas</Text>
        <TouchableOpacity style={styles.createBtn} onPress={openCreate}>
          <Text style={styles.createBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{cat}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      <FlatList
        data={filteredPersonas}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} tintColor={colors.primary[500]} />}
        ListEmptyComponent={!loading ? <EmptyState icon="🎭" title="No personas in this category" subtitle="Try another category or ask Core Chat to create one" /> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity onPress={() => navigation.navigate('PersonaChat', { personaId: item.id, personaName: item.name })}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                  {item.isTemplate && (
                    <View style={styles.libraryBadge}>
                      <Text style={styles.libraryBadgeText}>Library</Text>
                    </View>
                  )}
                </View>
                <View style={[styles.statusDot, { backgroundColor: item.isActive ? colors.green[500] : colors.gray[400] }]} />
              </View>
              {item.description && <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>}
              <Text style={styles.cardModel}>{item.modelName}</Text>
            </TouchableOpacity>
            {!item.isTemplate && (
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                  <Text style={styles.actionBtnText}>✏️ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtnDanger} onPress={() => handleDelete(item.id, item.name)}>
                  <Text style={styles.actionBtnDangerText}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            )}
            {!item.isTemplate && <KnowledgeBaseSection personaId={item.id} />}
          </View>
        )}
      />

      {/* Create / Edit Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={modalStyles.overlay}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.header}>
              <Text style={modalStyles.title}>{editingPersona ? 'Edit Persona' : 'Create Persona'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={modalStyles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={modalStyles.body} keyboardShouldPersistTaps="handled">
              <Text style={modalStyles.label}>Name *</Text>
              <TextInput style={modalStyles.input} value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="e.g. Strategic Advisor" placeholderTextColor={colors.textMuted} />

              <Text style={modalStyles.label}>Description</Text>
              <TextInput style={modalStyles.input} value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} placeholder="Brief description" placeholderTextColor={colors.textMuted} />

              <Text style={modalStyles.label}>Model</Text>
              <View style={modalStyles.modelRow}>
                {MODEL_OPTIONS.map((m) => (
                  <TouchableOpacity key={m.value} style={[modalStyles.modelChip, form.modelName === m.value && modalStyles.modelChipActive]} onPress={() => setForm({ ...form, modelName: m.value })}>
                    <Text style={[modalStyles.modelChipText, form.modelName === m.value && modalStyles.modelChipTextActive]} numberOfLines={1}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={modalStyles.label}>System Prompt *</Text>
              <TextInput style={[modalStyles.input, { minHeight: 120, textAlignVertical: 'top' }]} value={form.systemPrompt} onChangeText={(t) => setForm({ ...form, systemPrompt: t })} placeholder="Define how this persona should think and respond..." placeholderTextColor={colors.textMuted} multiline />
            </ScrollView>
            <TouchableOpacity style={[modalStyles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={colors.card} /> : <Text style={modalStyles.saveBtnText}>{editingPersona ? 'Update' : 'Create'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const createKbStyles = (colors: typeof Colors) => StyleSheet.create({
  container: { marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },
  chevron: { fontSize: 10, color: colors.textMuted },
  body: { marginTop: Spacing.sm },
  uploadBtn: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200], borderRadius: BorderRadius.md, paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed' },
  uploadBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary[600] },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadingText: { fontSize: FontSize.sm, color: colors.primary[600] },
  emptyText: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  docName: { fontSize: FontSize.sm, fontWeight: '500', color: colors.text },
  docMeta: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },
  deleteBtn: { fontSize: 16 },
})

const createModalStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%', ...neonCard(colors, isDark) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
  closeBtn: { fontSize: 20, color: colors.textMuted, padding: 4 },
  body: { padding: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: 12 },
  input: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: 12, fontSize: FontSize.base, color: colors.text },
  modelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  modelChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.gray[50] },
  modelChipActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  modelChipText: { fontSize: FontSize.xs, color: colors.textSecondary },
  modelChipTextActive: { color: colors.primary[700], fontWeight: '600' },
  saveBtn: { margin: Spacing.lg, backgroundColor: colors.primary[500], borderRadius: BorderRadius.md, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: '700' },
})

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
  createBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: colors.primary[500], borderRadius: BorderRadius.md },
  createBtnText: { fontSize: FontSize.sm, color: '#ffffff', fontWeight: '600' },
  filterRow: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, gap: 8, alignItems: 'center' },
  filterChip: { height: 32, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.full, backgroundColor: colors.gray[100], borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  filterChipActive: { backgroundColor: colors.primary[500], borderColor: colors.primary[500], ...(isDark ? { shadowColor: colors.primary[400], shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null) },
  filterChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, includeFontPadding: false },
  filterChipTextActive: { color: '#ffffff' },
  list: { padding: Spacing.xl, paddingTop: 0, paddingBottom: 120 },
  card: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  cardName: { fontSize: FontSize.base, fontWeight: '600', color: colors.text, flexShrink: 1 },
  libraryBadge: { backgroundColor: colors.primary[50], borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: colors.primary[200] },
  libraryBadgeText: { fontSize: 10, fontWeight: '600', color: colors.primary[700] },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardDesc: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
  cardModel: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  actionBtnText: { fontSize: FontSize.sm, color: colors.primary[600], fontWeight: '500' },
  actionBtnDanger: { paddingHorizontal: 10, paddingVertical: 4 },
  actionBtnDangerText: { fontSize: FontSize.sm, color: '#EF4444', fontWeight: '500' },
})
