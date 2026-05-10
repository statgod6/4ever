import { useEffect, useState, useCallback } from 'react'
import {
  Brain, Search, X, Loader2, Trash2, Edit3, Plus, RefreshCw,
  Database, TrendingUp, Clock, Tag, Archive,
  Sparkles, History, Activity,
} from 'lucide-react'
import { memoriesApi, type Memory, type MemoryStats, type ProfileChangeEntry, type SessionSummary } from '../api/memories'
import { toast } from '../components/Toast'
import { confirm } from '../components/ConfirmModal'

type Tab = 'memories' | 'sessions' | 'changelog'

export default function MemoryDashboard() {
  const [tab, setTab] = useState<Tab>('memories')
  const [memories, setMemories] = useState<Memory[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [changelog, setChangelog] = useState<ProfileChangeEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<(Memory & { similarity: number })[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('active')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [newMemoryCategory, setNewMemoryCategory] = useState('')
  const [isConsolidating, setIsConsolidating] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [mems, statsData] = await Promise.all([
        memoriesApi.list({ status: statusFilter, limit: 100 }),
        memoriesApi.getStats(),
      ])
      setMemories(mems)
      setStats(statsData)
    } catch (err: any) {
      toast.error('Failed to load', err.response?.data?.message || 'Could not load memories')
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (tab === 'sessions' && sessions.length === 0) {
      memoriesApi.getSessionSummaries(30).then(setSessions).catch(() => {})
    }
    if (tab === 'changelog' && changelog.length === 0) {
      memoriesApi.getProfileChangelog(100).then(setChangelog).catch(() => {})
    }
  }, [tab])

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    try {
      const results = await memoriesApi.search(searchQuery, 20)
      setSearchResults(results)
    } catch { toast.error('Search failed') }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: 'Delete Memory',
      message: 'This will permanently archive this memory. This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await memoriesApi.delete(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
      toast.success('Memory deleted')
      loadData()
    } catch { toast.error('Delete failed') }
  }

  const handleEdit = async (id: string) => {
    if (!editContent.trim()) return
    try {
      const updated = await memoriesApi.update(id, { content: editContent })
      setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)))
      setEditingId(null)
      toast.success('Memory updated')
    } catch { toast.error('Update failed') }
  }

  const handleAdd = async () => {
    if (!newMemoryContent.trim()) return
    try {
      const mem = await memoriesApi.create(newMemoryContent, newMemoryCategory || undefined)
      setNewMemoryContent('')
      setNewMemoryCategory('')
      setShowAddForm(false)
      toast.success('Memory added')
      loadData()
    } catch { toast.error('Failed to add memory') }
  }

  const handleConsolidate = async () => {
    setIsConsolidating(true)
    try {
      const result = await memoriesApi.consolidate()
      toast.success('Consolidation complete', `Merged: ${result.merged}, Contradictions resolved: ${result.contradictions}`)
      loadData()
    } catch { toast.error('Consolidation failed') } finally { setIsConsolidating(false) }
  }

  const displayMemories = searchResults || memories

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center animate-pulse">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-gray-400 font-medium">Loading memory system...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="animate-slide-up relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-500 px-6 py-4 sm:px-8 sm:py-5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-2xl" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Memory System</h1>
            <p className="text-white/60 text-xs mt-0.5 font-medium">
              {stats ? `${stats.active} active memories` : 'Manage Core\'s long-term memory'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Database className="w-4 h-4" />} label="Active" value={stats.active} color="indigo" />
          <StatCard icon={<Archive className="w-4 h-4" />} label="Total" value={stats.total} color="gray" />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Types" value={stats.byType.length} color="emerald" />
          <StatCard icon={<Tag className="w-4 h-4" />} label="Sources" value={stats.bySource.length} color="purple" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        {([['memories', 'Memories', Brain], ['sessions', 'Sessions', History], ['changelog', 'Profile Log', Activity]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as Tab)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              tab === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Memories Tab */}
      {tab === 'memories' && (
        <div className="space-y-4">
          {/* Search + Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null) }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Semantic search memories..."
                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults(null) }} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-gray-200">
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {['active', 'superseded', 'archived'].map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setSearchResults(null) }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    statusFilter === s
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-transparent hover:border-gray-200'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowAddForm(!showAddForm)} className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Memory
            </button>
            <button onClick={handleConsolidate} disabled={isConsolidating} className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-100 text-purple-700 rounded-xl text-xs font-semibold hover:bg-purple-200 transition-colors disabled:opacity-50">
              {isConsolidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Consolidate
            </button>
            <button onClick={() => loadData()} className="flex items-center gap-1.5 px-3.5 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-200 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Add Form */}
          {showAddForm && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-3">
              <textarea
                value={newMemoryContent}
                onChange={(e) => setNewMemoryContent(e.target.value)}
                placeholder="What should Core remember?"
                rows={2}
                className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 resize-none"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value)}
                  placeholder="Category (optional)"
                  className="px-3 py-2 bg-white border border-indigo-200 rounded-lg text-sm w-48"
                />
                <button onClick={handleAdd} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Save</button>
                <button onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-300">Cancel</button>
              </div>
            </div>
          )}

          {/* Search results label */}
          {searchResults && (
            <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium">
              <Search className="w-4 h-4" />
              {searchResults.length} results for "{searchQuery}"
              <button onClick={() => { setSearchQuery(''); setSearchResults(null) }} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>
            </div>
          )}

          {/* Memory List */}
          <div className="space-y-2">
            {displayMemories.length === 0 ? (
              <div className="text-center py-12">
                <Brain className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400 font-medium">No memories found</p>
              </div>
            ) : (
              displayMemories.map((mem) => (
                <div key={mem.id} className="group bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-all">
                  {editingId === mem.id ? (
                    <div className="space-y-2">
                      <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(mem.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold">Save</button>
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                        mem.status === 'active' ? 'bg-emerald-500' : mem.status === 'superseded' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 leading-relaxed">{mem.content}</p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                          {(mem as any).similarity !== undefined && (
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold">{((mem as any).similarity * 100).toFixed(0)}% match</span>
                          )}
                          {mem.category && <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-lg font-semibold">{mem.category}</span>}
                          {mem.source && <span className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded-lg font-semibold">{mem.source}</span>}
                          <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{(mem.importanceScore * 10).toFixed(0)}%</span>
                          <span className="flex items-center gap-1"><Activity className="w-3 h-3" />{mem.accessCount}x</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(mem.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingId(mem.id); setEditContent(mem.content) }} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(mem.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sessions Tab */}
      {tab === 'sessions' && (
        <div className="space-y-3">
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400 font-medium">No session summaries yet</p>
              <p className="text-xs text-gray-300 mt-1">Session summaries are created when you start a new Core Chat session</p>
            </div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <History className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-600">
                        {new Date(s.sessionStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold">{s.messageCount} msgs</span>
                    </div>
                    {s.keyTopics && <p className="text-[11px] text-purple-500 font-medium mt-0.5">{s.keyTopics}</p>}
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{s.summary}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Changelog Tab */}
      {tab === 'changelog' && (
        <div className="space-y-2">
          {changelog.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400 font-medium">No profile changes logged yet</p>
            </div>
          ) : (
            changelog.map((entry) => (
              <div key={entry.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  entry.source === 'core_chat' ? 'bg-purple-50' : entry.source === 'manual' ? 'bg-blue-50' : 'bg-gray-50'
                }`}>
                  {entry.source === 'core_chat' ? <Brain className="w-4 h-4 text-purple-600" /> : <Edit3 className="w-4 h-4 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-800 uppercase">{entry.field}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                      entry.source === 'core_chat' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>{entry.source === 'core_chat' ? 'Core Chat' : 'Manual'}</span>
                    <span className="text-[11px] text-gray-400">{new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  {entry.oldValue && (
                    <p className="text-xs text-red-400 line-through mb-0.5 truncate">{entry.oldValue}</p>
                  )}
                  <p className="text-sm text-gray-700">{entry.newValue}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'from-indigo-500 to-indigo-600 shadow-indigo-500/20',
    gray: 'from-gray-400 to-gray-500 shadow-gray-400/20',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-500/20',
    purple: 'from-purple-500 to-purple-600 shadow-purple-500/20',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${colorMap[color]} flex items-center justify-center shadow-lg text-white`}>{icon}</div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
