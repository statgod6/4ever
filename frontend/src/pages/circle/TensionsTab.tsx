import { useState } from 'react'
import { Plus, Check, X, Loader2, Trash2, AlertTriangle, Timer, CheckCircle2 } from 'lucide-react'
import { TensionEntry, CreateTensionData, tensionsApi } from '../../api/tensions'
import { RelationshipPerson } from '../../api/relationships'
import { toast } from '../../components/Toast'

interface Props {
  tensions: TensionEntry[]
  setTensions: React.Dispatch<React.SetStateAction<TensionEntry[]>>
  tensionsLoading: boolean
  showTensionForm: boolean
  setShowTensionForm: React.Dispatch<React.SetStateAction<boolean>>
  tensionForm: CreateTensionData
  setTensionForm: React.Dispatch<React.SetStateAction<CreateTensionData>>
  people: RelationshipPerson[]
}

export default function TensionsTab({
  tensions, setTensions, tensionsLoading,
  showTensionForm, setShowTensionForm, tensionForm, setTensionForm, people,
}: Props) {
  const [resolveInput, setResolveInput] = useState('')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const handleCreateTension = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const created = await tensionsApi.create(tensionForm)
      setTensions((prev) => [created, ...prev])
      setShowTensionForm(false)
      setTensionForm({ title: '', description: '' })
      toast.success('Logged', `Tension "${created.title}" recorded.`)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not create tension entry')
    }
  }

  const handleCoolDown = async (id: string, minutes: number) => {
    try {
      const updated = await tensionsApi.startCoolDown(id, minutes)
      setTensions((prev) => prev.map((t) => t.id === id ? updated : t))
      toast.success('Cool-down started', `Take ${minutes} minutes before responding.`)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not start cool-down')
    }
  }

  const handleResolveTension = async (id: string) => {
    try {
      const updated = await tensionsApi.resolve(id, resolveInput || undefined)
      setTensions((prev) => prev.map((t) => t.id === id ? updated : t))
      setResolvingId(null)
      setResolveInput('')
      toast.success('Resolved', 'Tension marked as resolved.')
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not resolve tension')
    }
  }

  const handleRemoveTension = async (id: string) => {
    try {
      await tensionsApi.remove(id)
      setTensions((prev) => prev.filter((t) => t.id !== id))
      toast.success('Removed', 'Tension entry removed.')
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not remove tension')
    }
  }

  const getCoolDownRemaining = (entry: TensionEntry): string | null => {
    if (entry.status !== 'cooling_down' || !entry.coolDownUntil) return null
    const remaining = new Date(entry.coolDownUntil).getTime() - Date.now()
    if (remaining <= 0) return null
    const mins = Math.ceil(remaining / 60000)
    return mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  }

  return (
    <div>
      {/* Create Tension Form */}
      {showTensionForm && (
        <div className="card mb-6 border-2 border-red-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Log a Tension</h2>
          <form onSubmit={handleCreateTension} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">What's the tension? *</label>
              <input
                type="text"
                value={tensionForm.title}
                onChange={(e) => setTensionForm({ ...tensionForm, title: e.target.value })}
                className="input"
                placeholder="e.g., Disagreement about finances, Feeling unappreciated"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Describe what happened *</label>
              <textarea
                value={tensionForm.description}
                onChange={(e) => setTensionForm({ ...tensionForm, description: e.target.value })}
                className="textarea"
                rows={3}
                placeholder="Write freely. This helps process the emotion..."
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Person involved</label>
                <select
                  value={tensionForm.personId || ''}
                  onChange={(e) => setTensionForm({ ...tensionForm, personId: e.target.value || undefined })}
                  className="input"
                >
                  <option value="">— No specific person —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.relationship})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Intensity (1-10)</label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={tensionForm.intensity ?? 5}
                  onChange={(e) => setTensionForm({ ...tensionForm, intensity: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Mild</span>
                  <span className="font-bold text-gray-700">{tensionForm.intensity ?? 5}</span>
                  <span>Intense</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cool-down timer</label>
                <select
                  value={tensionForm.coolDownMinutes ?? 0}
                  onChange={(e) => setTensionForm({ ...tensionForm, coolDownMinutes: parseInt(e.target.value) || undefined })}
                  className="input"
                >
                  <option value={0}>No cool-down</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex items-center gap-2">
                <Check className="w-5 h-5" /> Log Tension
              </button>
              <button type="button" onClick={() => setShowTensionForm(false)} className="btn-secondary flex items-center gap-2">
                <X className="w-5 h-5" /> Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tensions List */}
      {tensionsLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-red-500" />
        </div>
      ) : tensions.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-red-100 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No tensions logged</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">When conflicts arise, log them here to process and cool down before reacting.</p>
          <button onClick={() => setShowTensionForm(true)} className="btn-primary inline-flex items-center gap-2 shadow-sm">
            <Plus className="w-5 h-5" /> Log Your First Tension
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {tensions.map((tension) => {
            const coolDown = getCoolDownRemaining(tension)
            const intensityColor = tension.intensity >= 7 ? 'bg-red-500' : tension.intensity >= 4 ? 'bg-amber-500' : 'bg-yellow-400'
            return (
              <div key={tension.id} className={`card ${
                tension.status === 'resolved' ? 'opacity-60' :
                tension.status === 'cooling_down' ? 'border-l-4 border-l-blue-400' :
                'border-l-4 border-l-red-400'
              }`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{tension.title}</h3>
                      {tension.person && (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
                          {tension.person.name}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${intensityColor}`}>
                        {tension.intensity}/10
                      </span>
                      {tension.status === 'cooling_down' && coolDown && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center gap-1">
                          <Timer className="w-3 h-3" /> {coolDown} left
                        </span>
                      )}
                      {tension.status === 'resolved' && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Resolved
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{tension.description}</p>
                    {tension.resolution && (
                      <p className="text-sm text-green-700 bg-green-50 rounded-lg p-2">Resolution: {tension.resolution}</p>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(tension.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {tension.status !== 'resolved' && (
                    <div className="flex flex-col gap-1.5">
                      {tension.status !== 'cooling_down' && (
                        <button
                          onClick={() => handleCoolDown(tension.id, 30)}
                          className="px-2.5 py-1.5 bg-blue-100 text-blue-700 text-xs rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-1"
                          title="Start 30min cool-down"
                        >
                          <Timer className="w-3.5 h-3.5" /> Cool Down
                        </button>
                      )}
                      {resolvingId === tension.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={resolveInput}
                            onChange={(e) => setResolveInput(e.target.value)}
                            placeholder="How resolved?"
                            className="input py-1 text-xs w-32"
                            autoFocus
                          />
                          <div className="flex gap-1">
                            <button onClick={() => handleResolveTension(tension.id)} className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">
                              Save
                            </button>
                            <button onClick={() => { setResolvingId(null); setResolveInput('') }} className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded">
                              X
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setResolvingId(tension.id)}
                          className="px-2.5 py-1.5 bg-green-100 text-green-700 text-xs rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveTension(tension.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
