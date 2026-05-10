import { useState, useEffect } from 'react'
import {
  Heart, Plus, Edit2, Trash2, UserPlus, X, Check,
  ChevronDown, ChevronUp, Loader2, Sparkles, ExternalLink, TrendingUp,
  Repeat, Calendar,
  AlertTriangle, Network, BarChart3,
  MessageCircle, RefreshCw, Brain, AlertCircle,
} from 'lucide-react'
import { relationshipsApi, RelationshipPerson, RelationshipNote, AnnualReviewData } from '../api/relationships'
import { ritualsApi, Ritual, CreateRitualData } from '../api/rituals'
import { lifeEventsApi, LifeEvent, CreateLifeEventData } from '../api/lifeEvents'
import { tensionsApi, TensionEntry, CreateTensionData } from '../api/tensions'
import { orchestrationApi } from '../api/orchestration'
import { ontologyApi, type RelationalSnapshot } from '../api/ontology'
import { toast } from '../components/Toast'
import { confirm } from '../components/ConfirmModal'
import RitualsTab from './circle/RitualsTab'
import LifeEventsTab from './circle/LifeEventsTab'
import TensionsTab from './circle/TensionsTab'
import GraphTab from './circle/GraphTab'
import AnnualReviewTab from './circle/AnnualReviewTab'
import PersonaChatModal from './circle/PersonaChatModal'

const RELATIONSHIP_TYPES = [
  'Parent', 'Sibling', 'Partner', 'Spouse', 'Child',
  'Friend', 'Close Friend', 'Colleague', 'Boss', 'Mentor', 'Mentee', 'Other',
]

const FILTER_GROUPS: Record<string, string[]> = {
  All: [],
  Family: ['Parent', 'Sibling', 'Partner', 'Spouse', 'Child'],
  Friends: ['Friend', 'Close Friend'],
  Work: ['Colleague', 'Boss'],
  Mentors: ['Mentor', 'Mentee'],
}

const LOVE_LANGUAGES = [
  { value: 'words_of_affirmation', label: 'Words of Affirmation', emoji: '💬' },
  { value: 'acts_of_service', label: 'Acts of Service', emoji: '🧰' },
  { value: 'receiving_gifts', label: 'Receiving Gifts', emoji: '🎁' },
  { value: 'quality_time', label: 'Quality Time', emoji: '⌛' },
  { value: 'physical_touch', label: 'Physical Touch', emoji: '🤗' },
]

export default function MyCircle() {
  const [activeTab, setActiveTab] = useState<'people' | 'rituals' | 'events' | 'tensions' | 'graph' | 'review'>('people')
  const [people, setPeople] = useState<RelationshipPerson[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState('All')

  // Rituals state
  const [rituals, setRituals] = useState<Ritual[]>([])
  const [ritualsLoading, setRitualsLoading] = useState(false)
  const [showRitualForm, setShowRitualForm] = useState(false)
  const [ritualForm, setRitualForm] = useState<CreateRitualData>({ title: '', frequency: 'weekly' })

  // Life Events state
  const [lifeEvents, setLifeEvents] = useState<LifeEvent[]>([])
  const [upcomingEvents, setUpcomingEvents] = useState<LifeEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [eventForm, setEventForm] = useState<CreateLifeEventData>({ title: '', eventDate: '', eventType: 'birthday' })

  // Tensions state
  const [tensions, setTensions] = useState<TensionEntry[]>([])
  const [tensionsLoading, setTensionsLoading] = useState(false)
  const [showTensionForm, setShowTensionForm] = useState(false)
  const [tensionForm, setTensionForm] = useState<CreateTensionData>({ title: '', description: '' })

  // Annual Review state
  const [annualReview, setAnnualReview] = useState<AnnualReviewData | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)

  // People form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailPerson, setDetailPerson] = useState<RelationshipPerson | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [relational, setRelational] = useState<RelationalSnapshot | null>(null)
  const [relationalLoading, setRelationalLoading] = useState(false)
  const [relationalRefreshing, setRelationalRefreshing] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [personaLoading, setPersonaLoading] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    relationship: 'Friend',
    description: '',
    dynamic: '',
    keyContext: '',
    communicationStyle: '',
    loveLanguage: '',
  })

  // Direct persona chat state
  const [chatPersonaId, setChatPersonaId] = useState<string | null>(null)
  const [chatPersonName, setChatPersonName] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: string; content: string; createdAt: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [chatStreamText, setChatStreamText] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    loadPeople()
    loadRituals()
    loadLifeEvents()
    loadTensions()
  }, [])

  const loadPeople = async () => {
    try {
      const data = await relationshipsApi.getAll()
      setPeople(data)
    } catch (err: any) {
      toast.error('Failed to load', err.response?.data?.message || 'Could not load your circle')
    } finally {
      setIsLoading(false)
    }
  }

  const loadRituals = async () => {
    setRitualsLoading(true)
    try {
      const data = await ritualsApi.getAll()
      setRituals(data)
    } catch { /* silent */ } finally {
      setRitualsLoading(false)
    }
  }

  const loadLifeEvents = async () => {
    setEventsLoading(true)
    try {
      const [all, upcoming] = await Promise.all([
        lifeEventsApi.getAll(),
        lifeEventsApi.getUpcoming(60),
      ])
      setLifeEvents(all)
      setUpcomingEvents(upcoming)
    } catch { /* silent */ } finally {
      setEventsLoading(false)
    }
  }

  const loadTensions = async () => {
    setTensionsLoading(true)
    try {
      const data = await tensionsApi.getAll()
      setTensions(data)
    } catch { /* silent */ } finally {
      setTensionsLoading(false)
    }
  }

  // =================== PEOPLE HANDLERS ===================

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const created = await relationshipsApi.create({
        name: formData.name,
        relationship: formData.relationship,
        description: formData.description || undefined,
        dynamic: formData.dynamic || undefined,
        keyContext: formData.keyContext || undefined,
        communicationStyle: formData.communicationStyle || undefined,
        loveLanguage: formData.loveLanguage || undefined,
      })
      setPeople((prev) => [created, ...prev])
      resetForm()
      toast.success('Person added', `${created.name} has been added to your circle.`)
    } catch (err: any) {
      toast.error('Create failed', err.response?.data?.message || 'Failed to add person')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    try {
      const updated = await relationshipsApi.update(editingId, {
        name: formData.name,
        relationship: formData.relationship,
        description: formData.description || undefined,
        dynamic: formData.dynamic || undefined,
        keyContext: formData.keyContext || undefined,
        communicationStyle: formData.communicationStyle || undefined,
        loveLanguage: formData.loveLanguage || undefined,
      })
      setPeople((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...updated } : p)))
      resetForm()
      toast.success('Updated', `${formData.name} has been updated.`)
    } catch (err: any) {
      toast.error('Update failed', err.response?.data?.message || 'Failed to update')
    }
  }

  const handleDelete = async (person: { id: string; name: string }) => {
    const confirmed = await confirm({
      title: 'Remove Person',
      message: `Remove ${person.name} from your circle? This will delete all their interaction notes.`,
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await relationshipsApi.remove(person.id)
      setPeople((prev) => prev.filter((p) => p.id !== person.id))
      if (expandedId === person.id) setExpandedId(null)
      toast.success('Removed', `${person.name} has been removed from your circle.`)
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.message || 'Failed to remove')
    }
  }

  const handleAddNote = async (personId: string) => {
    if (!noteInput.trim()) return
    setNoteLoading(true)
    try {
      const note = await relationshipsApi.addNote(personId, noteInput.trim())
      if (detailPerson && detailPerson.id === personId) {
        setDetailPerson({
          ...detailPerson,
          notes: [note, ...(detailPerson.notes || [])],
        })
      }
      setPeople((prev) =>
        prev.map((p) =>
          p.id === personId
            ? { ...p, _count: { notes: (p._count?.notes || 0) + 1 } }
            : p,
        ),
      )
      setNoteInput('')
      toast.success('Note added', 'Interaction note saved.')
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not save note')
    } finally {
      setNoteLoading(false)
    }
  }

  const handleCreatePersona = async (person: RelationshipPerson) => {
    setPersonaLoading(person.id)
    try {
      const result = await relationshipsApi.createPersona(person.id)
      if (result.alreadyExists) {
        toast.info('Already exists', `Persona for ${person.name} already exists.`)
      } else {
        toast.success('Persona created', `"${person.name}" persona is now available in your Personas page.`)
        setPeople((prev) =>
          prev.map((p) =>
            p.id === person.id ? { ...p, linkedPersonaId: result.persona.id } : p,
          ),
        )
      }
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not create persona')
    } finally {
      setPersonaLoading(null)
    }
  }

  const loadDetail = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setDetailPerson(null)
      setRelational(null)
      return
    }
    setExpandedId(id)
    setDetailLoading(true)
    setRelationalLoading(true)
    try {
      const [data, snap] = await Promise.all([
        relationshipsApi.getOne(id),
        ontologyApi.getRelational(id).catch(() => null),
      ])
      setDetailPerson(data)
      setRelational(snap)
    } catch {
      setDetailPerson(null)
      setRelational(null)
    } finally {
      setDetailLoading(false)
      setRelationalLoading(false)
    }
  }

  const refreshRelational = async (personId: string) => {
    setRelationalRefreshing(true)
    try {
      await ontologyApi.refresh()
      const snap = await ontologyApi.getRelational(personId).catch(() => null)
      setRelational(snap)
      toast.success('Relational snapshot refreshed', 'Synthesis run complete.')
    } catch (err: any) {
      toast.error('Refresh failed', err.response?.data?.message || 'Could not refresh')
    } finally {
      setRelationalRefreshing(false)
    }
  }

  const startEdit = (person: RelationshipPerson) => {
    setEditingId(person.id)
    setFormData({
      name: person.name,
      relationship: person.relationship,
      description: person.description || '',
      dynamic: person.dynamic || '',
      keyContext: person.keyContext || '',
      communicationStyle: person.communicationStyle || '',
      loveLanguage: person.loveLanguage || '',
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData({
      name: '',
      relationship: 'Friend',
      description: '',
      dynamic: '',
      keyContext: '',
      communicationStyle: '',
      loveLanguage: '',
    })
  }

  // =================== PERSONA DIRECT CHAT ===================

  const openChat = async (personaId: string, personName: string) => {
    setChatPersonaId(personaId)
    setChatPersonName(personName)
    setChatMessages([])
    setChatInput('')
    setChatStreamText('')
    setChatStreaming(false)
    setChatLoading(true)
    try {
      const history = await orchestrationApi.getPersonaChatHistory(personaId)
      setChatMessages(history)
    } catch { /* start fresh */ } finally {
      setChatLoading(false)
    }
  }

  const closeChat = () => {
    setChatPersonaId(null)
    setChatPersonName('')
    setChatMessages([])
    setChatInput('')
    setChatStreamText('')
    setChatStreaming(false)
  }

  const filteredPeople = filter === 'All'
    ? people
    : people.filter((p) => FILTER_GROUPS[filter]?.includes(p.relationship))

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-sm">
              <Heart className="w-5 h-5 text-white" />
            </div>
            My Circle
          </h1>
          <p className="text-gray-500 mt-2 ml-[52px]">
            People, rituals & life events
          </p>
        </div>
        {activeTab === 'people' && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="btn-primary flex items-center gap-2 shadow-sm"
          >
            <UserPlus className="w-5 h-5" />
            Add Person
          </button>
        )}
        {activeTab === 'rituals' && (
          <button
            onClick={() => setShowRitualForm(true)}
            className="btn-primary flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-5 h-5" />
            New Ritual
          </button>
        )}
        {activeTab === 'events' && (
          <button
            onClick={() => setShowEventForm(true)}
            className="btn-primary flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Add Event
          </button>
        )}
        {activeTab === 'tensions' && (
          <button
            onClick={() => setShowTensionForm(true)}
            className="btn-primary flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Log Tension
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-8">
        <div className="flex gap-0 -mb-px">
          {[
            { key: 'people' as const, label: 'People', icon: Heart, count: people.length },
            { key: 'rituals' as const, label: 'Rituals', icon: Repeat, count: rituals.length },
            { key: 'events' as const, label: 'Life Events', icon: Calendar, count: lifeEvents.length },
            { key: 'tensions' as const, label: 'Tensions', icon: AlertTriangle, count: tensions.filter(t => t.status !== 'resolved').length },
            { key: 'graph' as const, label: 'Graph', icon: Network, count: 0 },
            { key: 'review' as const, label: 'Review', icon: BarChart3, count: 0 },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-rose-500 text-rose-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  activeTab === tab.key ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* =================== PEOPLE TAB =================== */}
      {activeTab === 'people' && (<>

      {/* Filter Chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.keys(FILTER_GROUPS).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === key
                ? 'bg-rose-100 text-rose-700 border border-rose-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="card mb-6 border-2 border-rose-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? 'Edit Person' : 'Add Person to Your Circle'}
          </h2>
          <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input" placeholder="e.g., Dad, Rahul, Sarah" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Relationship *</label>
                <select value={formData.relationship} onChange={(e) => setFormData({ ...formData, relationship: e.target.value })} className="input">
                  {RELATIONSHIP_TYPES.map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal ml-1">— Who are they? Personality?</span></label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="textarea" rows={2} placeholder="e.g., Very supportive, practical thinker..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Dynamic <span className="text-gray-400 font-normal ml-1">— How is your relationship?</span></label>
              <textarea value={formData.dynamic} onChange={(e) => setFormData({ ...formData, dynamic: e.target.value })} className="textarea" rows={2} placeholder="e.g., Close but sometimes overbearing..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Key Context <span className="text-gray-400 font-normal ml-1">— Their job, interests, relevant info</span></label>
              <textarea value={formData.keyContext} onChange={(e) => setFormData({ ...formData, keyContext: e.target.value })} className="textarea" rows={2} placeholder="e.g., Retired engineer, loves gardening..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Communication Style <span className="text-gray-400 font-normal ml-1">— How they talk, respond</span></label>
              <textarea value={formData.communicationStyle} onChange={(e) => setFormData({ ...formData, communicationStyle: e.target.value })} className="textarea" rows={2} placeholder="e.g., Direct, no-nonsense..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Love Language <span className="text-gray-400 font-normal ml-1">— How they prefer to give/receive love</span></label>
              <div className="flex flex-wrap gap-2">
                {LOVE_LANGUAGES.map((ll) => (
                  <button key={ll.value} type="button" onClick={() => setFormData({ ...formData, loveLanguage: formData.loveLanguage === ll.value ? '' : ll.value })}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${formData.loveLanguage === ll.value ? 'bg-pink-100 text-pink-700 border-pink-300' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200'}`}>
                    {ll.emoji} {ll.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary flex items-center gap-2"><Check className="w-5 h-5" />{editingId ? 'Update' : 'Add to Circle'}</button>
              <button type="button" onClick={resetForm} className="btn-secondary flex items-center gap-2"><X className="w-5 h-5" />Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Empty State */}
      {people.length === 0 && !showForm && (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center mx-auto mb-5">
            <Heart className="w-8 h-8 text-rose-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Your circle is empty</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">Add people in your life so Core can give relationship-aware advice.</p>
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-2 shadow-sm"><UserPlus className="w-5 h-5" />Add Your First Person</button>
        </div>
      )}

      {/* People Grid */}
      <div className="grid gap-4">
        {filteredPeople.map((person) => (
          <div key={person.id} className="card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadDetail(person.id)}>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-semibold text-gray-900">{person.name}</h3>
                  <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">{person.relationship}</span>
                  {person._count && person._count.notes > 0 && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">{person._count.notes} note{person._count.notes !== 1 ? 's' : ''}</span>
                  )}
                  {person.loveLanguage && (
                    <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded-full text-xs font-medium">
                      {LOVE_LANGUAGES.find((l) => l.value === person.loveLanguage)?.emoji}{' '}
                      {LOVE_LANGUAGES.find((l) => l.value === person.loveLanguage)?.label}
                    </span>
                  )}
                </div>
                {person.description && (
                  <p className="text-gray-600 text-sm">{person.description.length > 120 ? person.description.substring(0, 120) + '...' : person.description}</p>
                )}
                {(person.lastInteractionAt || person.interactionCount > 0) && (
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    {person.lastInteractionAt && (
                      <span>Last: {new Date(person.lastInteractionAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    )}
                    {person.interactionCount > 0 && (
                      <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{person.interactionCount} interaction{person.interactionCount !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {person.linkedPersonaId ? (
                  <>
                    <button onClick={() => openChat(person.linkedPersonaId!, person.name)} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-indigo-200 transition-colors" title={`Message ${person.name}`}>
                      <MessageCircle className="w-3 h-3" />Message
                    </button>
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium flex items-center gap-1"><Sparkles className="w-3 h-3" />Persona</span>
                  </>
                ) : (
                  <button onClick={() => handleCreatePersona(person)} disabled={personaLoading === person.id} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50" title="Create Persona from this person">
                    {personaLoading === person.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </button>
                )}
                <button onClick={() => startEdit(person)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => handleDelete({ id: person.id, name: person.name })} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Remove"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => loadDetail(person.id)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                  {expandedId === person.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Expanded Detail */}
            {expandedId === person.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-gray-500 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading details...</div>
                ) : detailPerson ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {detailPerson.dynamic && (<div className="bg-gray-50 rounded-lg p-3"><span className="font-medium text-gray-700">Dynamic:</span><p className="text-gray-600 mt-1">{detailPerson.dynamic}</p></div>)}
                      {detailPerson.keyContext && (<div className="bg-gray-50 rounded-lg p-3"><span className="font-medium text-gray-700">Key Context:</span><p className="text-gray-600 mt-1">{detailPerson.keyContext}</p></div>)}
                      {detailPerson.communicationStyle && (<div className="bg-gray-50 rounded-lg p-3"><span className="font-medium text-gray-700">Communication Style:</span><p className="text-gray-600 mt-1">{detailPerson.communicationStyle}</p></div>)}
                      {detailPerson.linkedPersonaId && (
                        <div className="bg-green-50 rounded-lg p-3">
                          <span className="font-medium text-green-700 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />Linked Persona</span>
                          <a href="/personas" className="text-green-600 hover:underline text-xs mt-1 flex items-center gap-1">View in Personas <ExternalLink className="w-3 h-3" /></a>
                        </div>
                      )}
                    </div>

                    {/* Relational intelligence (ontology) */}
                    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                          <Brain className="w-4 h-4 text-sky-600" />
                          Relational intelligence
                        </h4>
                        <button
                          onClick={() => refreshRelational(person.id)}
                          disabled={relationalRefreshing}
                          className="text-xs text-sky-700 hover:text-sky-800 font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-sky-100 transition-all disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${relationalRefreshing ? 'animate-spin' : ''}`} />
                          Refresh this person
                        </button>
                      </div>
                      {relationalLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 py-2"><Loader2 className="w-4 h-4 animate-spin" />Loading snapshot...</div>
                      ) : !relational ? (
                        <p className="text-sm text-gray-500">
                          Not enough signal yet — add more notes/tensions/rituals.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                                <span className="font-medium">Bond strength</span>
                                <span>{Math.round(relational.bondStrength * 100)}%</span>
                              </div>
                              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all"
                                  style={{ width: `${Math.max(5, relational.bondStrength * 100)}%` }}
                                />
                              </div>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                                relational.bondTrend === 'strengthening'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : relational.bondTrend === 'drifting'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {relational.bondTrend}
                            </span>
                          </div>

                          {relational.driftRiskDays > 0 && (
                            <div className="text-xs text-amber-700 flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Drift risk in ~{relational.driftRiskDays} day(s)
                            </div>
                          )}

                          {relational.recurringTopics && relational.recurringTopics.length > 0 && (
                            <div>
                              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Recurring topics</div>
                              <div className="flex flex-wrap gap-1.5">
                                {relational.recurringTopics.map((t, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-700 text-xs">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {relational.unresolvedFriction && relational.unresolvedFriction.length > 0 && (
                            <div>
                              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Unresolved friction</div>
                              <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-700">
                                {relational.unresolvedFriction.map((f, i) => (
                                  <li key={i}>{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {relational.predictedNextInteraction && (
                            <p className="text-sm text-gray-700">
                              <span className="font-semibold text-gray-900">Next:</span>{' '}
                              {relational.predictedNextInteraction}
                            </p>
                          )}

                          {relational.suggestedRitual && (
                            <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-100">
                              <p className="text-sm text-indigo-900">
                                <span className="font-semibold">Ritual idea:</span> {relational.suggestedRitual}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Relationship Evolution Timeline */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5"><TrendingUp className="w-4 h-4" />Relationship Evolution</h4>
                      <div className="flex gap-2 mb-3">
                        <input type="text" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="Log an interaction..." className="input flex-1 py-1.5 text-sm"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(person.id) } }} />
                        <button onClick={() => handleAddNote(person.id)} disabled={!noteInput.trim() || noteLoading} className="px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-primary-700 transition-colors">
                          {noteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                      {detailPerson.notes && detailPerson.notes.length > 0 ? (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {detailPerson.notes.map((note: RelationshipNote) => {
                            const sentimentColor = note.sentiment === 'positive' ? 'bg-green-400' : note.sentiment === 'negative' ? 'bg-red-400' : 'bg-yellow-400'
                            return (
                              <div key={note.id} className="flex gap-2 text-sm items-start">
                                <div className="flex flex-col items-center pt-1.5"><div className={`w-2.5 h-2.5 rounded-full ${sentimentColor} flex-shrink-0`} /></div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-gray-400 text-xs whitespace-nowrap">
                                      {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                                      {new Date(note.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                    </span>
                                    {note.topic && (<span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs font-medium">{note.topic}</span>)}
                                    {note.source === 'core_chat' && (<span className="text-xs text-purple-500">via Core</span>)}
                                  </div>
                                  <p className="text-gray-700 mt-0.5">{note.content}</p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">No interactions logged yet. Log them here or Core Chat will auto-detect them.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Persona Direct Chat Modal */}
      {chatPersonaId && (
        <PersonaChatModal
          personaId={chatPersonaId}
          personName={chatPersonName}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          chatStreaming={chatStreaming}
          setChatStreaming={setChatStreaming}
          chatStreamText={chatStreamText}
          setChatStreamText={setChatStreamText}
          chatLoading={chatLoading}
          onClose={closeChat}
        />
      )}

      </>)}

      {/* =================== RITUALS TAB =================== */}
      {activeTab === 'rituals' && (
        <RitualsTab
          rituals={rituals} setRituals={setRituals} ritualsLoading={ritualsLoading}
          showRitualForm={showRitualForm} setShowRitualForm={setShowRitualForm}
          ritualForm={ritualForm} setRitualForm={setRitualForm} people={people}
        />
      )}

      {/* =================== LIFE EVENTS TAB =================== */}
      {activeTab === 'events' && (
        <LifeEventsTab
          lifeEvents={lifeEvents} setLifeEvents={setLifeEvents}
          upcomingEvents={upcomingEvents} setUpcomingEvents={setUpcomingEvents}
          eventsLoading={eventsLoading} showEventForm={showEventForm} setShowEventForm={setShowEventForm}
          eventForm={eventForm} setEventForm={setEventForm} people={people}
          onRefresh={loadLifeEvents}
        />
      )}

      {/* =================== GRAPH TAB =================== */}
      {activeTab === 'graph' && (
        <GraphTab people={people} onPersonClick={(id) => { setActiveTab('people'); loadDetail(id) }} />
      )}

      {/* =================== ANNUAL REVIEW TAB =================== */}
      {activeTab === 'review' && (
        <AnnualReviewTab
          annualReview={annualReview} setAnnualReview={setAnnualReview}
          reviewLoading={reviewLoading} setReviewLoading={setReviewLoading}
        />
      )}

      {/* =================== TENSIONS TAB =================== */}
      {activeTab === 'tensions' && (
        <TensionsTab
          tensions={tensions} setTensions={setTensions} tensionsLoading={tensionsLoading}
          showTensionForm={showTensionForm} setShowTensionForm={setShowTensionForm}
          tensionForm={tensionForm} setTensionForm={setTensionForm} people={people}
        />
      )}
    </div>
  )
}
