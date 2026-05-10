import { useEffect, useState, useRef, useMemo } from 'react'
import { Plus, Edit2, Trash2, Loader2, X, Check, FileText, Upload, ChevronDown, ChevronUp, BookMarked } from 'lucide-react'
import { personasApi } from '../api/personas'
import { knowledgeBaseApi, type PersonaDocumentInfo } from '../api/knowledgeBase'
import { usePersonaStore } from '../store/personaStore'
import { confirm } from '../components/ConfirmModal'
import { toast } from '../components/Toast'
import type { Persona } from '../store/personaStore'

const modelOptions = [
  { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 (Default)' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
]

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

export default function Personas() {
  const { personas, setPersonas, addPersona, updatePersona, removePersona } =
    usePersonaStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedKB, setExpandedKB] = useState<string | null>(null)
  const [kbDocs, setKbDocs] = useState<Record<string, PersonaDocumentInfo[]>>({})
  const [kbLoading, setKbLoading] = useState<Record<string, boolean>>({})
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    modelName: 'deepseek/deepseek-v3.2',
  })
  const [selectedCategory, setSelectedCategory] = useState<string>('All')

  const filteredPersonas = useMemo(() => {
    if (selectedCategory === 'All') return personas
    if (selectedCategory === 'Mine') return personas.filter((p) => !p.isTemplate)
    return personas.filter((p) => p.category === selectedCategory)
  }, [personas, selectedCategory])

  useEffect(() => {
    loadPersonas()
  }, [])

  const loadPersonas = async () => {
    try {
      const data = await personasApi.getAll()
      setPersonas(data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load personas')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const persona = await personasApi.create(formData)
      addPersona(persona)
      setIsCreating(false)
      setFormData({
        name: '',
        description: '',
        systemPrompt: '',
        modelName: 'deepseek/deepseek-v3.2',
      })
      toast.success('Persona created', `${formData.name} is ready to analyze your thoughts.`)
    } catch (err: any) {
      toast.error('Create failed', err.response?.data?.message || 'Failed to create persona')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return

    try {
      const persona = await personasApi.update(editingId, formData)
      updatePersona(persona)
      setEditingId(null)
      setFormData({
        name: '',
        description: '',
        systemPrompt: '',
        modelName: 'deepseek/deepseek-v3.2',
      })
      toast.success('Persona updated', `${formData.name} has been updated.`)
    } catch (err: any) {
      toast.error('Update failed', err.response?.data?.message || 'Failed to update persona')
    }
  }

  const handleDelete = async (id: string) => {
    const persona = personas.find((p) => p.id === id)
    const confirmed = await confirm({
      title: 'Delete Persona',
      message: `Are you sure you want to delete "${persona?.name || 'this persona'}"? This will remove it from future analyses.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!confirmed) return

    try {
      await personasApi.delete(id)
      removePersona(id)
      toast.success('Persona deleted', `${persona?.name || 'Persona'} has been removed.`)
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.message || 'Failed to delete persona')
    }
  }

  const startEdit = (persona: Persona) => {
    setEditingId(persona.id)
    setFormData({
      name: persona.name,
      description: persona.description || '',
      systemPrompt: persona.systemPrompt,
      modelName: persona.modelName,
    })
  }

  const cancelEdit = () => {
    setIsCreating(false)
    setEditingId(null)
    setFormData({
      name: '',
      description: '',
      systemPrompt: '',
      modelName: 'deepseek/deepseek-v3.2',
    })
  }

  // --- Knowledge Base handlers ---
  const toggleKB = async (personaId: string) => {
    if (expandedKB === personaId) {
      setExpandedKB(null)
      return
    }
    setExpandedKB(personaId)
    if (!kbDocs[personaId]) {
      await loadKBDocs(personaId)
    }
  }

  const loadKBDocs = async (personaId: string) => {
    setKbLoading((prev) => ({ ...prev, [personaId]: true }))
    try {
      const docs = await knowledgeBaseApi.getDocuments(personaId)
      setKbDocs((prev) => ({ ...prev, [personaId]: docs }))
    } catch {
      toast.error('Load failed', 'Failed to load knowledge base documents')
    } finally {
      setKbLoading((prev) => ({ ...prev, [personaId]: false }))
    }
  }

  const handleFileUpload = async (personaId: string, file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Invalid file', 'Only PDF files are supported')
      return
    }
    setUploadProgress((prev) => ({ ...prev, [personaId]: 0 }))
    try {
      await knowledgeBaseApi.uploadDocument(personaId, file, (percent) => {
        setUploadProgress((prev) => ({ ...prev, [personaId]: percent }))
      })
      toast.success('Document uploaded', `${file.name} has been processed and indexed.`)
      await loadKBDocs(personaId)
    } catch (err: any) {
      toast.error('Upload failed', err.response?.data?.message || 'Failed to upload document')
    } finally {
      setUploadProgress((prev) => {
        const next = { ...prev }
        delete next[personaId]
        return next
      })
    }
  }

  const handleDeleteDoc = async (personaId: string, docId: string, filename: string) => {
    const confirmed = await confirm({
      title: 'Delete Document',
      message: `Are you sure you want to delete "${filename}"? This will remove all its indexed content.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await knowledgeBaseApi.deleteDocument(docId)
      toast.success('Document deleted', `${filename} has been removed.`)
      await loadKBDocs(personaId)
    } catch {
      toast.error('Delete failed', 'Failed to delete document')
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Personas</h1>
          <p className="text-gray-600 mt-1">
            Manage AI personas that analyze your thoughts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreating(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            New Persona
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                active
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(isCreating || editingId) && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? 'Edit Persona' : 'Create Persona'}
          </h2>
          <form
            onSubmit={editingId ? handleUpdate : handleCreate}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="input"
                placeholder="e.g., Strategic Advisor"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="input"
                placeholder="Brief description of this persona's style"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <select
                value={formData.modelName}
                onChange={(e) =>
                  setFormData({ ...formData, modelName: e.target.value })
                }
                className="input"
              >
                {modelOptions.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                System Prompt
              </label>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) =>
                  setFormData({ ...formData, systemPrompt: e.target.value })
                }
                className="textarea"
                rows={6}
                placeholder="Define how this persona should think and respond..."
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary flex items-center gap-2">
                <Check className="w-5 h-5" />
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="btn-secondary flex items-center gap-2"
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Personas List */}
      <div className="grid gap-4">
        {filteredPersonas.map((persona) => (
          <div key={persona.id} className="card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {persona.name}
                  </h3>
                  {persona.isTemplate && (
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium flex items-center gap-1">
                      <BookMarked className="w-3 h-3" />
                      Library
                    </span>
                  )}
                  {persona.category && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                      {persona.category}
                    </span>
                  )}
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      persona.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {persona.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                    {persona.modelName}
                  </span>
                </div>
                {persona.description && (
                  <p className="text-gray-600 text-sm mb-2">
                    {persona.description}
                  </p>
                )}
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
                  <span className="font-medium">Prompt:</span>{' '}
                  {persona.systemPrompt.substring(0, 100)}
                  {persona.systemPrompt.length > 100 && '...'}
                </div>
              </div>
              {!persona.isTemplate && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(persona)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(persona.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Knowledge Base Toggle (only for user-owned personas) */}
            {!persona.isTemplate && (
              <button
                onClick={() => toggleKB(persona.id)}
                className="mt-3 flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Knowledge Base
                {kbDocs[persona.id]?.length ? (
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs">
                    {kbDocs[persona.id].length} doc{kbDocs[persona.id].length !== 1 ? 's' : ''}
                  </span>
                ) : null}
                {expandedKB === persona.id ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Knowledge Base Panel */}
            {expandedKB === persona.id && (
              <div className="mt-3 border-t pt-3">
                {kbLoading[persona.id] ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading documents...
                  </div>
                ) : (
                  <>
                    {/* Upload Section */}
                    <div className="mb-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(persona.id, file)
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadProgress[persona.id] !== undefined}
                        className="flex items-center gap-2 px-3 py-2 text-sm border-2 border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-all text-gray-600 hover:text-indigo-700 disabled:opacity-50"
                      >
                        <Upload className="w-4 h-4" />
                        {uploadProgress[persona.id] !== undefined
                          ? `Uploading... ${uploadProgress[persona.id]}%`
                          : 'Upload PDF'}
                      </button>
                      {uploadProgress[persona.id] !== undefined && (
                        <div className="mt-2 w-48 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-indigo-600 h-1.5 rounded-full transition-all"
                            style={{ width: `${uploadProgress[persona.id]}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Documents List */}
                    {kbDocs[persona.id]?.length ? (
                      <div className="space-y-2">
                        {kbDocs[persona.id].map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">
                                  {doc.filename}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {formatFileSize(doc.fileSize)} &middot; {doc.chunkCount} chunks &middot;{' '}
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteDoc(persona.id, doc.id, doc.filename)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                              title="Delete document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 py-2">
                        No documents uploaded yet. Upload PDFs to give this persona domain knowledge.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredPersonas.length === 0 && !isCreating && (
        <div className="text-center py-16">
          <p className="text-gray-600">
            {selectedCategory === 'All'
              ? 'No personas yet. Create your first one or ask Core Chat!'
              : 'No personas in this category. Try another or create a new one.'}
          </p>
        </div>
      )}
    </div>
  )
}
