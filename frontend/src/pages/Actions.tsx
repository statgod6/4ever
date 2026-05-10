import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckSquare,
  Loader2,
  Check,
  X,
  CalendarPlus,
  Sparkles,
  ExternalLink,
  Brain,
} from 'lucide-react'
import { actionsApi, type ActionItem } from '../api/actions'
import { toast } from '../components/Toast'

const DIMENSION_COLORS: Record<string, string> = {
  Health: 'bg-green-100 text-green-700',
  Career: 'bg-blue-100 text-blue-700',
  Relationships: 'bg-pink-100 text-pink-700',
  Finance: 'bg-yellow-100 text-yellow-800',
  Learning: 'bg-indigo-100 text-indigo-700',
  Creativity: 'bg-purple-100 text-purple-700',
  Spirituality: 'bg-teal-100 text-teal-700',
}

export default function Actions() {
  const [items, setItems] = useState<ActionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [plannerModal, setPlannerModal] = useState<{ itemId: string; content: string } | null>(null)
  const [plannerDate, setPlannerDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [plannerTimeSlot, setPlannerTimeSlot] = useState('')

  useEffect(() => {
    loadItems()
  }, [filter])

  const loadItems = async () => {
    setIsLoading(true)
    try {
      const data = await actionsApi.getActionItems(filter === 'pending' ? 'pending' : undefined)
      setItems(data)
    } catch {
      toast.error('Load failed', 'Could not load action items.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleMarkDone = async (id: string) => {
    try {
      await actionsApi.updateActionStatus(id, 'done')
      setItems((prev) => prev.filter((i) => i.id !== id))
      toast.success('Done', 'Action item completed.')
    } catch {
      toast.error('Failed', 'Could not update action item.')
    }
  }

  const handleDismiss = async (id: string) => {
    try {
      await actionsApi.updateActionStatus(id, 'dismissed')
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch {
      toast.error('Failed', 'Could not dismiss action item.')
    }
  }

  const handleAddToPlanner = async () => {
    if (!plannerModal || !plannerTimeSlot.trim()) return
    try {
      await actionsApi.linkToPlanner(plannerModal.itemId, plannerDate, plannerTimeSlot)
      setItems((prev) => prev.filter((i) => i.id !== plannerModal.itemId))
      setPlannerModal(null)
      setPlannerTimeSlot('')
      toast.success('Added to planner', 'Task has been added to your day plan.')
    } catch {
      toast.error('Failed', 'Could not add to planner.')
    }
  }

  // Group by thought
  const grouped = items.reduce<Record<string, ActionItem[]>>((acc, item) => {
    const key = item.thoughtTitle || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <CheckSquare className="w-7 h-7 text-primary-600" />
            Action Items
          </h1>
          <p className="text-gray-600 mt-1">Actionable tasks extracted from persona responses</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === 'pending' ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === 'all' ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-16">
          <CheckSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No action items</h3>
          <p className="text-gray-500">
            {filter === 'pending'
              ? 'All caught up! Submit thoughts to generate new action items.'
              : 'No action items found. They are auto-extracted from persona responses.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([thoughtTitle, groupItems]) => (
            <div key={thoughtTitle}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-700">
                  From: {thoughtTitle}
                </h3>
                {groupItems[0]?.thoughtId && (
                  <Link
                    to={`/thought/${groupItems[0].thoughtId}`}
                    className="text-xs text-primary-600 hover:underline flex items-center gap-1"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    className={`card !py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
                      item.status === 'done' ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm text-gray-900 ${item.status === 'done' ? 'line-through' : ''}`}>
                        {item.content}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {item.dimension && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            DIMENSION_COLORS[item.dimension] || 'bg-gray-100 text-gray-600'
                          }`}>
                            {item.dimension}
                          </span>
                        )}
                        {item.personaName ? (
                          <span className="text-xs text-gray-500">via {item.personaName}</span>
                        ) : (
                          <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                            <Brain className="w-3 h-3" />
                            4Ever Core
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    {item.status === 'pending' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleMarkDone(item.id)}
                          className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                          title="Mark done"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPlannerModal({ itemId: item.id, content: item.content })}
                          className="p-1.5 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors"
                          title="Add to planner"
                        >
                          <CalendarPlus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Dismiss"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add to Planner Modal */}
      {plannerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Add to Day Planner</h3>
            <p className="text-sm text-gray-600 mb-4 line-clamp-2">{plannerModal.content}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={plannerDate}
                  onChange={(e) => setPlannerDate(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time Slot</label>
                <input
                  type="text"
                  value={plannerTimeSlot}
                  onChange={(e) => setPlannerTimeSlot(e.target.value)}
                  placeholder="e.g. 9:00 - 10:00 AM"
                  className="input w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setPlannerModal(null); setPlannerTimeSlot('') }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddToPlanner}
                disabled={!plannerTimeSlot.trim()}
                className="btn-primary disabled:opacity-50"
              >
                Add to Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
