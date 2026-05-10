import { Plus, Check, X, Loader2, Calendar, Trash2, Gift, Star } from 'lucide-react'
import { LifeEvent, CreateLifeEventData, lifeEventsApi } from '../../api/lifeEvents'
import { RelationshipPerson } from '../../api/relationships'
import { toast } from '../../components/Toast'

const EVENT_TYPES = ['birthday', 'anniversary', 'graduation', 'surgery', 'interview', 'move', 'milestone', 'other']

interface Props {
  lifeEvents: LifeEvent[]
  setLifeEvents: React.Dispatch<React.SetStateAction<LifeEvent[]>>
  upcomingEvents: LifeEvent[]
  setUpcomingEvents: React.Dispatch<React.SetStateAction<LifeEvent[]>>
  eventsLoading: boolean
  showEventForm: boolean
  setShowEventForm: React.Dispatch<React.SetStateAction<boolean>>
  eventForm: CreateLifeEventData
  setEventForm: React.Dispatch<React.SetStateAction<CreateLifeEventData>>
  people: RelationshipPerson[]
  onRefresh: () => void
}

export default function LifeEventsTab({
  lifeEvents, setLifeEvents, upcomingEvents, setUpcomingEvents,
  eventsLoading, showEventForm, setShowEventForm, eventForm, setEventForm,
  people, onRefresh,
}: Props) {
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const created = await lifeEventsApi.create(eventForm)
      setLifeEvents((prev) => [...prev, created].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()))
      setShowEventForm(false)
      setEventForm({ title: '', eventDate: '', eventType: 'birthday' })
      onRefresh()
      toast.success('Event added', `"${created.title}" saved.`)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not create event')
    }
  }

  const handleRemoveEvent = async (id: string) => {
    try {
      await lifeEventsApi.remove(id)
      setLifeEvents((prev) => prev.filter((e) => e.id !== id))
      setUpcomingEvents((prev) => prev.filter((e) => e.id !== id))
      toast.success('Removed', 'Life event has been removed.')
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not remove event')
    }
  }

  return (
    <div>
      {/* Create Event Form */}
      {showEventForm && (
        <div className="card mb-6 border-2 border-purple-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add a Life Event</h2>
          <form onSubmit={handleCreateEvent} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Title *</label>
                <input
                  type="text"
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  className="input"
                  placeholder="e.g., Dad's Birthday, Wedding Anniversary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={eventForm.eventDate}
                  onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
                  className="input"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Type *</label>
                <select
                  value={eventForm.eventType}
                  onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}
                  className="input"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to Person</label>
                <select
                  value={eventForm.personId || ''}
                  onChange={(e) => setEventForm({ ...eventForm, personId: e.target.value || undefined })}
                  className="input"
                >
                  <option value="">— No specific person —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.relationship})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={eventForm.isRecurring || false}
                  onChange={(e) => setEventForm({ ...eventForm, isRecurring: e.target.checked })}
                  className="rounded border-gray-300"
                />
                Recurring (yearly)
              </label>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700">Remind</label>
                <input
                  type="number"
                  value={eventForm.remindDaysBefore ?? 1}
                  onChange={(e) => setEventForm({ ...eventForm, remindDaysBefore: parseInt(e.target.value) || 1 })}
                  className="input w-16 py-1 text-center"
                  min={0}
                  max={30}
                />
                <span className="text-sm text-gray-700">days before</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
              <textarea
                value={eventForm.note || ''}
                onChange={(e) => setEventForm({ ...eventForm, note: e.target.value })}
                className="textarea"
                rows={2}
                placeholder="Gift ideas, plans, etc."
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex items-center gap-2">
                <Check className="w-5 h-5" /> Save Event
              </button>
              <button type="button" onClick={() => setShowEventForm(false)} className="btn-secondary flex items-center gap-2">
                <X className="w-5 h-5" /> Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" /> Upcoming (Next 60 Days)
          </h2>
          <div className="grid gap-2">
            {upcomingEvents.map((event) => {
              const displayDate = event.nextOccurrence || event.eventDate
              const daysUntil = Math.ceil((new Date(displayDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              return (
                <div key={event.id + '-upcoming'} className="card flex items-center gap-4 border-l-4 border-l-purple-400">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-pink-500 flex flex-col items-center justify-center text-white">
                    <span className="text-xs font-medium leading-none">
                      {new Date(displayDate).toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                    <span className="text-lg font-bold leading-none">
                      {new Date(displayDate).getUTCDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{event.title}</h3>
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                        {event.eventType}
                      </span>
                      {event.isRecurring && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">Yearly</span>
                      )}
                      {event.person && (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
                          {event.person.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {daysUntil <= 0 ? 'Today!' : daysUntil === 1 ? 'Tomorrow!' : `In ${daysUntil} days`}
                      {event.note && ` — ${event.note}`}
                    </p>
                  </div>
                  <Gift className={`w-5 h-5 flex-shrink-0 ${daysUntil <= 3 ? 'text-red-500 animate-pulse' : 'text-purple-400'}`} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Events */}
      {eventsLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
        </div>
      ) : lifeEvents.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center mx-auto mb-5">
            <Calendar className="w-8 h-8 text-purple-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No life events yet</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">Track birthdays, anniversaries, and milestones for your people.</p>
          <button onClick={() => setShowEventForm(true)} className="btn-primary inline-flex items-center gap-2 shadow-sm">
            <Plus className="w-5 h-5" /> Add Your First Event
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">All Events</h2>
          <div className="grid gap-2">
            {lifeEvents.map((event) => (
              <div key={event.id} className="card flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{event.title}</h3>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                      {event.eventType}
                    </span>
                    {event.isRecurring && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">Yearly</span>
                    )}
                    {event.person && (
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs">
                        {event.person.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(event.eventDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    {event.note && ` — ${event.note}`}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveEvent(event.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
