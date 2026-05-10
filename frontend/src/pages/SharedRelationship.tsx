import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, MessageCircle, StickyNote,
  Plus, Trash2, Calendar, Star, Heart, BookOpen,
} from 'lucide-react'
import { connectionsApi, type SharedRelationship } from '../api/messaging'
import { toast } from '../components/Toast'

const NOTE_TYPES = [
  { value: 'general', label: 'General', icon: StickyNote },
  { value: 'ritual_log', label: 'Ritual Log', icon: Calendar },
  { value: 'milestone', label: 'Milestone', icon: Star },
  { value: 'memory', label: 'Memory', icon: Heart },
]

export default function SharedRelationshipView() {
  const { connectionId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<SharedRelationship | null>(null)
  const [loading, setLoading] = useState(true)
  const [noteInput, setNoteInput] = useState('')
  const [noteType, setNoteType] = useState('general')
  const [addingNote, setAddingNote] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [filterType, setFilterType] = useState<string | null>(null)

  useEffect(() => {
    if (connectionId) loadData()
  }, [connectionId])

  const loadData = async () => {
    if (!connectionId) return
    setLoading(true)
    try {
      const result = await connectionsApi.getSharedRelationship(connectionId)
      setData(result)
    } catch {
      toast.error('Failed to load shared relationship')
    } finally {
      setLoading(false)
    }
  }

  const handleAddNote = async () => {
    if (!connectionId || !noteInput.trim()) return
    setAddingNote(true)
    try {
      const note = await connectionsApi.addNote(connectionId, noteInput.trim(), noteType)
      setData((prev) => prev ? {
        ...prev,
        sharedNotes: [note, ...prev.sharedNotes],
        totalNotes: prev.totalNotes + 1,
      } : prev)
      setNoteInput('')
      setShowAddNote(false)
      toast.success('Note added!')
    } catch {
      toast.error('Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    try {
      await connectionsApi.deleteNote(noteId)
      setData((prev) => prev ? {
        ...prev,
        sharedNotes: prev.sharedNotes.filter((n) => n.id !== noteId),
        totalNotes: prev.totalNotes - 1,
      } : prev)
      toast.success('Note deleted')
    } catch {
      toast.error('Failed to delete note')
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  const filteredNotes = data?.sharedNotes.filter((n) => !filterType || n.noteType === filterType) || []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Connection not found</p>
        <button onClick={() => navigate('/connections')} className="text-primary-600 mt-2 text-sm hover:underline">
          Back to Connections
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/connections')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-lg font-bold text-primary-700">{data.partner.name?.[0]?.toUpperCase()}</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Shared with {data.partner.name}</h1>
            <p className="text-sm text-gray-500">Connected since {formatDate(data.connectedSince)}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <MessageCircle className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold text-gray-900">{data.totalMessages}</p>
          <p className="text-xs text-gray-500">Messages</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <StickyNote className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-2xl font-bold text-gray-900">{data.totalNotes}</p>
          <p className="text-xs text-gray-500">Shared Notes</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <Star className="w-5 h-5 mx-auto mb-1 text-yellow-500" />
          <p className="text-2xl font-bold text-gray-900">{data.notesByType.milestone || 0}</p>
          <p className="text-xs text-gray-500">Milestones</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <Heart className="w-5 h-5 mx-auto mb-1 text-red-400" />
          <p className="text-2xl font-bold text-gray-900">{data.notesByType.memory || 0}</p>
          <p className="text-xs text-gray-500">Memories</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => navigate(`/messages?user=${data.partner.id}&name=${encodeURIComponent(data.partner.name)}`)}
          className="btn-primary flex items-center gap-2"
        >
          <MessageCircle className="w-4 h-4" /> Send Message
        </button>
        <button
          onClick={() => setShowAddNote(true)}
          className="px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 flex items-center gap-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Add Shared Note
        </button>
      </div>

      {/* Add Note Form */}
      {showAddNote && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900">New Shared Note</h3>
            <button onClick={() => setShowAddNote(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {NOTE_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setNoteType(t.value)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${
                  noteType === t.value ? 'bg-primary-100 text-primary-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Write a shared note both of you can see..."
            className="textarea w-full"
            rows={3}
          />
          <button
            onClick={handleAddNote}
            disabled={!noteInput.trim() || addingNote}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Save Note
          </button>
        </div>
      )}

      {/* Notes Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Filter:</span>
        <button
          onClick={() => setFilterType(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium ${!filterType ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          All
        </button>
        {NOTE_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilterType(filterType === t.value ? null : t.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filterType === t.value ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Notes List */}
      <div className="space-y-3">
        {filteredNotes.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <BookOpen className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>No shared notes yet. Add one above!</p>
          </div>
        ) : (
          filteredNotes.map((note) => {
            const typeInfo = NOTE_TYPES.find((t) => t.value === note.noteType) || NOTE_TYPES[0]
            const TypeIcon = typeInfo.icon
            return (
              <div key={note.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 mb-2">
                    <TypeIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500 uppercase">{typeInfo.label}</span>
                    <span className="text-xs text-gray-400">by {note.author.name}</span>
                    <span className="text-xs text-gray-400">{formatDate(note.createdAt)}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
