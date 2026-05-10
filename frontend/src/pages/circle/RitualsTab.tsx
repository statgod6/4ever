import { Plus, Check, X, Loader2, Repeat, Trash2, Flame, Clock } from 'lucide-react'
import { Ritual, CreateRitualData } from '../../api/rituals'
import { RelationshipPerson } from '../../api/relationships'
import { toast } from '../../components/Toast'
import { ritualsApi } from '../../api/rituals'

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly']

interface Props {
  rituals: Ritual[]
  setRituals: React.Dispatch<React.SetStateAction<Ritual[]>>
  ritualsLoading: boolean
  showRitualForm: boolean
  setShowRitualForm: React.Dispatch<React.SetStateAction<boolean>>
  ritualForm: CreateRitualData
  setRitualForm: React.Dispatch<React.SetStateAction<CreateRitualData>>
  people: RelationshipPerson[]
}

export default function RitualsTab({
  rituals, setRituals, ritualsLoading,
  showRitualForm, setShowRitualForm, ritualForm, setRitualForm, people,
}: Props) {
  const handleCreateRitual = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const created = await ritualsApi.create(ritualForm)
      setRituals((prev) => [{ ...created, isOverdue: true, nextDue: 'now' }, ...prev])
      setShowRitualForm(false)
      setRitualForm({ title: '', frequency: 'weekly' })
      toast.success('Ritual created', `"${created.title}" has been set up.`)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not create ritual')
    }
  }

  const handleCompleteRitual = async (id: string) => {
    try {
      const updated = await ritualsApi.complete(id)
      setRituals((prev) => prev.map((r) => r.id === id ? { ...r, ...updated, isOverdue: false } : r))
      toast.success('Done!', `Streak: ${updated.streak}`)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not complete ritual')
    }
  }

  const handleRemoveRitual = async (id: string) => {
    try {
      await ritualsApi.remove(id)
      setRituals((prev) => prev.filter((r) => r.id !== id))
      toast.success('Removed', 'Ritual has been removed.')
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not remove ritual')
    }
  }

  return (
    <div>
      {/* Create Ritual Form */}
      {showRitualForm && (
        <div className="card mb-6 border-2 border-indigo-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create a Ritual</h2>
          <form onSubmit={handleCreateRitual} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ritual Name *</label>
                <input
                  type="text"
                  value={ritualForm.title}
                  onChange={(e) => setRitualForm({ ...ritualForm, title: e.target.value })}
                  className="input"
                  placeholder="e.g., Call Dad, Coffee with Sarah"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
                <select
                  value={ritualForm.frequency}
                  onChange={(e) => setRitualForm({ ...ritualForm, frequency: e.target.value })}
                  className="input"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Person (optional)</label>
              <select
                value={ritualForm.personId || ''}
                onChange={(e) => setRitualForm({ ...ritualForm, personId: e.target.value || undefined })}
                className="input"
              >
                <option value="">— No specific person —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.relationship})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex items-center gap-2">
                <Check className="w-5 h-5" /> Create Ritual
              </button>
              <button type="button" onClick={() => setShowRitualForm(false)} className="btn-secondary flex items-center gap-2">
                <X className="w-5 h-5" /> Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rituals List */}
      {ritualsLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      ) : rituals.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center mx-auto mb-5">
            <Repeat className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No rituals yet</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">Create recurring rituals to stay connected with your people.</p>
          <button onClick={() => setShowRitualForm(true)} className="btn-primary inline-flex items-center gap-2 shadow-sm">
            <Plus className="w-5 h-5" /> Create Your First Ritual
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {rituals.map((ritual) => (
            <div key={ritual.id} className={`card flex items-center gap-4 ${
              ritual.isOverdue ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-emerald-400'
            }`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{ritual.title}</h3>
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
                    {ritual.frequency}
                  </span>
                  {ritual.person && (
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
                      {ritual.person.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Flame className={`w-3.5 h-3.5 ${ritual.streak > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
                    Streak: {ritual.streak}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {ritual.isOverdue ? (
                      <span className="text-amber-600 font-medium">Overdue!</span>
                    ) : (
                      <span>Next: {ritual.nextDue === 'now' ? 'Now' : ritual.nextDue}</span>
                    )}
                  </span>
                  {ritual.lastDoneAt && (
                    <span>
                      Last: {new Date(ritual.lastDoneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCompleteRitual(ritual.id)}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1"
                >
                  <Check className="w-4 h-4" /> Done
                </button>
                <button
                  onClick={() => handleRemoveRitual(ritual.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
