import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, MessageSquare, Loader2, Trash2, Search, X,
  Brain, CalendarDays, CheckSquare, Flame,
  ArrowRight, Sun, Moon, Sunrise, Zap, Activity, Target, Clock,
  Sparkles, ChevronRight, BarChart3, Heart, Users, AlertTriangle,
  RefreshCw, Cloud, TrendingUp, TrendingDown, Minus, Compass,
} from 'lucide-react'
import { thoughtsApi } from '../api/thoughts'
import { plannerApi, type PlanTask, type CompletionStats } from '../api/planner'
import { checkInApi, type DailyCheckIn } from '../api/checkin'
import { actionsApi, type ActionItem } from '../api/actions'
import { relationshipsApi, type RelationshipHealthData } from '../api/relationships'
import { ontologyApi, type OntologySnapshot } from '../api/ontology'
import { useThoughtStore } from '../store/thoughtStore'
import { useAuthStore } from '../store/authStore'
import { confirm } from '../components/ConfirmModal'
import { toast } from '../components/Toast'

const thoughtTypeLabels: Record<string, string> = {
  'business idea': 'Business Idea',
  'personal decision': 'Personal Decision',
  'career concern': 'Career Concern',
  'emotional situation': 'Emotional Situation',
  'relationship issue': 'Relationship Issue',
  'research thought': 'Research Thought',
  'content idea': 'Content Idea',
  'ethical dilemma': 'Ethical Dilemma',
  'startup plan': 'Startup Plan',
  'life choice': 'Life Choice',
  'general reflection': 'General Reflection',
}

const thoughtTypeColors: Record<string, { bg: string; text: string; dot: string }> = {
  'business idea': { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  'personal decision': { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'career concern': { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  'emotional situation': { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-500' },
  'relationship issue': { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  'research thought': { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  'content idea': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'ethical dilemma': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  'startup plan': { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' },
  'life choice': { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  'general reflection': { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
}

const MOOD_EMOJIS = ['', '\ud83d\ude1e', '\ud83d\ude15', '\ud83d\ude10', '\ud83d\ude42', '\ud83d\ude04']

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

export default function Dashboard() {
  const { thoughts, setThoughts, removeThought } = useThoughtStore()
  const { user } = useAuthStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showAllThoughts, setShowAllThoughts] = useState(false)

  // Dashboard widgets state
  const [todayPlan, setTodayPlan] = useState<PlanTask[]>([])
  const [tomorrowPlan, setTomorrowPlan] = useState<PlanTask[]>([])
  const [stats, setStats] = useState<CompletionStats | null>(null)
  const [todayCheckIn, setTodayCheckIn] = useState<DailyCheckIn | null>(null)
  const [recentCheckIns, setRecentCheckIns] = useState<DailyCheckIn[]>([])
  const [pendingActions, setPendingActions] = useState<ActionItem[]>([])
  const [relationshipHealth, setRelationshipHealth] = useState<RelationshipHealthData | null>(null)
  const [snapshot, setSnapshot] = useState<OntologySnapshot | null>(null)
  const [refreshingOntology, setRefreshingOntology] = useState(false)

  useEffect(() => {
    loadAll()
    const handleFocus = () => loadAll()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  const loadAll = async () => {
    const todayStr = toDateStr(new Date())
    const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1)
    const tomorrowStr = toDateStr(tmrw)
    try {
      const [thoughtsData] = await Promise.all([
        thoughtsApi.getAll(),
      ])
      setThoughts(thoughtsData)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load thoughts')
    } finally {
      setIsLoading(false)
    }

    Promise.all([
      plannerApi.getPlan(todayStr).catch(() => null),
      plannerApi.getPlan(tomorrowStr).catch(() => null),
      plannerApi.getCompletionStats(14).catch(() => null),
      checkInApi.getCheckIn(todayStr).catch(() => null),
      checkInApi.getRecentCheckIns(7).catch(() => []),
      actionsApi.getActionItems('pending').catch(() => []),
      relationshipsApi.getHealth().catch(() => null),
      ontologyApi.getSnapshot().catch(() => null),
    ]).then(([plan, tmrwPlan, completionStats, checkIn, recent, actions, relHealth, ontologySnap]) => {
      if (plan) setTodayPlan(plan.tasks || [])
      else setTodayPlan([])
      if (tmrwPlan) setTomorrowPlan(tmrwPlan.tasks || [])
      else setTomorrowPlan([])
      if (completionStats) setStats(completionStats)
      if (checkIn) setTodayCheckIn(checkIn)
      setRecentCheckIns(recent as DailyCheckIn[])
      setPendingActions((actions as ActionItem[]).slice(0, 5))
      if (relHealth) setRelationshipHealth(relHealth as RelationshipHealthData)
      setSnapshot(ontologySnap as OntologySnapshot | null)
    })
  }

  const refreshOntology = async () => {
    setRefreshingOntology(true)
    try {
      await ontologyApi.refresh()
      const snap = await ontologyApi.getSnapshot().catch(() => null)
      setSnapshot(snap)
      toast.success('Ontology refreshed', 'Snapshot regenerated.')
    } catch (err: any) {
      toast.error('Refresh failed', err.response?.data?.message || 'Could not refresh ontology')
    } finally {
      setRefreshingOntology(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const confirmed = await confirm({
      title: 'Delete Thought',
      message: 'This will permanently delete this thought and all its persona responses. This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await thoughtsApi.delete(id)
      removeThought(id)
      toast.success('Thought deleted', 'The thought and all responses have been removed.')
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.message || 'Failed to delete thought')
    }
  }

  const filteredThoughts = thoughts.filter((t) => {
    const matchesSearch = searchQuery === '' ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.rawText.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = filterType === 'all' || t.thoughtType === filterType
    const matchesStatus = filterStatus === 'all' || t.status === filterStatus
    return matchesSearch && matchesType && matchesStatus
  })

  const clearFilters = () => { setSearchQuery(''); setFilterType('all'); setFilterStatus('all') }

  const hour = new Date().getHours()
  const GreetingIcon = hour < 12 ? Sunrise : hour < 17 ? Sun : Moon
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] || ''

  const todayDone = todayPlan.filter((t) => t.status === 'done').length
  const todayTotal = todayPlan.length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center animate-pulse">
              <Brain className="w-6 h-6 text-white" />
            </div>
          </div>
          <p className="text-sm text-gray-400 font-medium">Loading your thoughts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      {/* ── Hero Section ── */}
      <div className="animate-slide-up relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-6 py-4 sm:px-8 sm:py-5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-2xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4 blur-2xl" />

        <div className="relative z-10 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <GreetingIcon className="w-5 h-5 text-yellow-300" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {greeting}{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-white/60 text-xs mt-0.5 font-medium">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* ── Ontology “Where you are” Card ── */}
      {snapshot && (
        <div className="animate-slide-up group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300">
          <div className="flex items-start justify-between p-5 pb-3 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                <Compass className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  Where you are
                  {(snapshot.staleness?.self || snapshot.staleness?.emotional) && (
                    <span
                      className="w-2 h-2 rounded-full bg-amber-400"
                      title="Snapshot is stale — consider refreshing"
                    />
                  )}
                </h2>
                <p className="text-[11px] text-gray-400 font-medium">
                  {snapshot.identity?.displayName || 'Your ontology'}
                  {snapshot.identity?.situation ? ` — ${snapshot.identity.situation}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={refreshOntology}
              disabled={refreshingOntology}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-indigo-50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingOntology ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="p-5 pt-0 space-y-4">
            {snapshot.trajectory && (
              <p className="text-sm text-gray-700 leading-relaxed">
                <span className="font-semibold text-gray-900">Trajectory:</span>{' '}
                {snapshot.trajectory}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 font-medium">
                <Cloud className="w-3.5 h-3.5" />
                Weather: {snapshot.weather}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 text-gray-700 font-medium">
                {snapshot.moodTrend === 'improving' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                ) : snapshot.moodTrend === 'declining' ? (
                  <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                ) : (
                  <Minus className="w-3.5 h-3.5 text-gray-400" />
                )}
                Mood: {snapshot.moodTrend}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 text-gray-700 font-medium">
                {snapshot.energyTrend === 'improving' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                ) : snapshot.energyTrend === 'declining' ? (
                  <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                ) : (
                  <Minus className="w-3.5 h-3.5 text-gray-400" />
                )}
                Energy: {snapshot.energyTrend}
              </span>
            </div>

            {snapshot.topTensions && snapshot.topTensions.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Top tensions</div>
                <div className="flex flex-wrap gap-1.5">
                  {snapshot.topTensions.slice(0, 2).map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      {t.title} · {t.intensity}/10
                      {t.personName ? ` · ${t.personName}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {snapshot.driftingPeople && snapshot.driftingPeople.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Drifting</div>
                <div className="flex flex-wrap gap-1.5">
                  {snapshot.driftingPeople.slice(0, 2).map((p) => (
                    <span key={p.personId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                      <Users className="w-3 h-3" />
                      {p.name} · {p.relationship}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {snapshot.recommendedFocus && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                <Target className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed">
                  <span className="font-semibold">Focus:</span> {snapshot.recommendedFocus}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Widget Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Plan Overview Card */}
        <div className="animate-slide-up stagger-2 group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300">
          <div className="flex items-center justify-between p-5 pb-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <CalendarDays className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Plan Overview</h2>
                <p className="text-[11px] text-gray-400 font-medium">Your schedule at a glance</p>
              </div>
            </div>
            <Link to="/planner" className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-indigo-50 transition-all">
              Open <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="p-5 space-y-4">
            {/* Today section */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Today</span>
              </div>
              {todayPlan.length === 0 ? (
                <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <CalendarDays className="w-4 h-4 text-gray-300" />
                  <p className="text-xs text-gray-400 font-medium">No tasks planned for today</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-500"
                        style={{ width: `${todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-indigo-600 tabular-nums">{todayDone}/{todayTotal}</span>
                  </div>
                  <div className="space-y-1">
                    {todayPlan.slice(0, 4).map((task) => (
                      <div key={task.id} className={`flex items-center gap-3 text-sm py-2 px-3 rounded-xl transition-colors ${task.status === 'done' ? 'text-gray-400 bg-gray-50/80' : task.status === 'skipped' ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-50'}`}>
                        <div className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${task.status === 'done' ? 'bg-emerald-100' : task.status === 'skipped' ? 'bg-gray-100' : 'bg-indigo-100'}`}>
                          {task.status === 'done' ? (
                            <CheckSquare className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'skipped' ? 'bg-gray-400' : 'bg-indigo-500'}`} />
                          )}
                        </div>
                        <span className="text-[11px] text-gray-400 w-14 shrink-0 font-mono font-medium">{task.timeSlot}</span>
                        <span className={`truncate text-sm ${task.status === 'done' ? 'line-through' : ''}`}>{task.task}</span>
                      </div>
                    ))}
                  </div>
                  {todayPlan.length > 4 && (
                    <p className="text-[11px] text-gray-400 text-center mt-2 font-medium">+{todayPlan.length - 4} more tasks</p>
                  )}
                </>
              )}
            </div>

            {/* Tomorrow section */}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Tomorrow</span>
              </div>
              {tomorrowPlan.length === 0 ? (
                <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <CalendarDays className="w-4 h-4 text-gray-300" />
                  <p className="text-xs text-gray-400 font-medium">Nothing planned yet</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {tomorrowPlan.slice(0, 3).map((task) => (
                    <div key={task.id} className="flex items-center gap-3 text-sm py-2 px-3 rounded-xl hover:bg-gray-50 transition-colors text-gray-700">
                      <div className="w-5 h-5 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                      </div>
                      <span className="text-[11px] text-gray-400 w-14 shrink-0 font-mono font-medium">{task.timeSlot}</span>
                      <span className="truncate">{task.task}</span>
                    </div>
                  ))}
                  {tomorrowPlan.length > 3 && (
                    <p className="text-[11px] text-gray-400 text-center mt-2 font-medium">+{tomorrowPlan.length - 3} more</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-5">

          {/* Mood Streak Card */}
          <div className="animate-slide-up stagger-3 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Heart className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Mood This Week</h2>
                <p className="text-[11px] text-gray-400 font-medium">Your emotional pulse</p>
              </div>
            </div>
            {recentCheckIns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 bg-gradient-to-br from-amber-50/50 to-orange-50/50 rounded-xl border border-dashed border-amber-200/50">
                <Activity className="w-6 h-6 text-amber-300 mb-2" />
                <p className="text-xs text-gray-400 font-medium">No check-ins yet this week</p>
                <Link to="/planner" className="text-[11px] text-amber-600 font-semibold mt-1 hover:underline">Start a check-in</Link>
              </div>
            ) : (
              <div className="flex items-end gap-1.5 justify-between px-1">
                {recentCheckIns.slice(0, 7).reverse().map((c, i) => {
                  const dayLabel = new Date(c.date).toLocaleDateString('en-US', { weekday: 'short' })
                  const energyPct = (c.energy / 5) * 100
                  return (
                    <div key={i} className="flex flex-col items-center gap-1.5 flex-1 group/bar">
                      <span className="text-lg group-hover/bar:scale-125 transition-transform">{MOOD_EMOJIS[c.mood] || '\ud83d\ude10'}</span>
                      <div className="w-full bg-gray-100 rounded-xl overflow-hidden" style={{ height: '48px' }}>
                        <div
                          className="w-full rounded-xl transition-all duration-500 bg-gradient-to-t from-amber-500 to-amber-300 group-hover/bar:from-orange-500 group-hover/bar:to-amber-300"
                          style={{ height: `${energyPct}%`, marginTop: `${100 - energyPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-gray-400">{dayLabel}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {todayCheckIn && (
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-amber-50 px-3 py-1.5 rounded-xl font-medium">
                  <span>Mood</span>
                  <span className="font-bold text-amber-700">{todayCheckIn.mood}/5</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-orange-50 px-3 py-1.5 rounded-xl font-medium">
                  <span>Energy</span>
                  <span className="font-bold text-orange-700">{todayCheckIn.energy}/5</span>
                </div>
                {todayCheckIn.note && (
                  <span className="text-[11px] text-gray-400 italic truncate ml-1">"{todayCheckIn.note}"</span>
                )}
              </div>
            )}
          </div>

          {/* Relationship Health Card */}
          {relationshipHealth && relationshipHealth.totalPeople > 0 && (
            <div className="animate-slide-up stagger-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-400 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">Relationship Health</h2>
                    <p className="text-[11px] text-gray-400 font-medium">{relationshipHealth.totalPeople} people in your circle</p>
                  </div>
                </div>
                <Link to="/circle" className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-rose-50 transition-all">
                  Circle <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Overall score */}
              {relationshipHealth.overallScore > 0 && (
                <div className="flex items-center gap-3 mb-3">
                  <div className={`text-2xl font-bold ${
                    relationshipHealth.overallScore >= 70 ? 'text-emerald-600' :
                    relationshipHealth.overallScore >= 40 ? 'text-amber-600' : 'text-red-600'
                  }`}>{relationshipHealth.overallScore}</div>
                  <div className="text-xs text-gray-400 leading-tight">Overall<br/>Health Score</div>
                </div>
              )}

              {/* Health summary bar */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${relationshipHealth.totalPeople > 0 ? (relationshipHealth.healthyCount / relationshipHealth.totalPeople) * 100 : 0}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-red-400 transition-all duration-500"
                    style={{ width: `${relationshipHealth.totalPeople > 0 ? (relationshipHealth.driftingCount / relationshipHealth.totalPeople) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-emerald-600 tabular-nums">{relationshipHealth.healthyCount}/{relationshipHealth.totalPeople}</span>
              </div>

              {/* Drifting / Needs Attention */}
              {relationshipHealth.driftingPeople.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">Needs Attention</span>
                  </div>
                  <div className="space-y-2">
                    {relationshipHealth.driftingPeople.slice(0, 4).map((p: any) => (
                      <div key={p.id} className={`py-2 px-3 rounded-xl transition-colors ${
                        p.status === 'drifting' ? 'bg-red-50/60' : 'bg-amber-50/50'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            p.status === 'drifting' ? 'bg-red-400' : 'bg-amber-400'
                          }`} />
                          <span className="text-sm text-gray-700 font-medium truncate flex-1">{p.name}</span>
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-lg font-medium shrink-0">{p.relationship}</span>
                          <span className={`text-xs font-bold tabular-nums shrink-0 ${
                            p.healthScore >= 60 ? 'text-emerald-600' : p.healthScore >= 35 ? 'text-amber-600' : 'text-red-600'
                          }`}>{p.healthScore}</span>
                        </div>
                        {p.reason && (
                          <p className="text-[11px] text-gray-500 mt-1 ml-4 leading-relaxed">{p.reason}</p>
                        )}
                      </div>
                    ))}
                    {relationshipHealth.driftingPeople.length > 4 && (
                      <p className="text-[11px] text-gray-400 text-center mt-1 font-medium">+{relationshipHealth.driftingPeople.length - 4} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Healthy people summary */}
              {relationshipHealth.peopleWithScores?.filter((p: any) => p.status === 'healthy').length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Thriving</span>
                  </div>
                  <div className="space-y-2">
                    {relationshipHealth.peopleWithScores.filter((p: any) => p.status === 'healthy').slice(0, 3).map((p: any) => (
                      <div key={p.id} className="py-2 px-3 rounded-xl bg-emerald-50/50 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-sm text-gray-700 font-medium truncate flex-1">{p.name}</span>
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-lg font-medium shrink-0">{p.relationship}</span>
                          <span className="text-xs font-bold text-emerald-600 tabular-nums shrink-0">{p.healthScore}</span>
                        </div>
                        {p.reason && (
                          <p className="text-[11px] text-gray-500 mt-1 ml-4 leading-relaxed">{p.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity */}
              {relationshipHealth.recentActivity.length > 0 && (
                <div className="pt-3 border-t border-gray-100">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Recent Activity</span>
                  <div className="mt-2 space-y-1.5">
                    {relationshipHealth.recentActivity.slice(0, 3).map((a) => {
                      const sentimentColor = a.sentiment === 'positive' ? 'bg-emerald-400' : a.sentiment === 'negative' ? 'bg-red-400' : 'bg-yellow-400'
                      return (
                        <div key={a.id} className="flex items-start gap-2 text-sm">
                          <div className={`w-2 h-2 rounded-full ${sentimentColor} mt-1.5 shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-gray-700 text-xs">
                              <span className="font-semibold">{a.personName}</span>{' — '}
                              {a.content.length > 60 ? a.content.substring(0, 60) + '...' : a.content}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                            {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pending Actions Card */}
          {pendingActions.length > 0 && (
            <div className="animate-slide-up stagger-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                    <CheckSquare className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">Pending Actions</h2>
                    <p className="text-[11px] text-gray-400 font-medium">{pendingActions.length} items need attention</p>
                  </div>
                </div>
                <Link to="/actions" className="text-xs text-violet-600 hover:text-violet-700 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-violet-50 transition-all">
                  All <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="space-y-1.5">
                {pendingActions.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 text-sm p-2.5 rounded-xl hover:bg-violet-50/50 transition-all group/action cursor-default">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center shrink-0 group-hover/action:scale-110 transition-transform">
                      <ChevronRight className="w-3 h-3 text-violet-600" />
                    </div>
                    <span className="text-gray-700 truncate flex-1 text-sm">{item.content}</span>
                    {item.dimension && (
                      <span className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-600 rounded-lg font-semibold shrink-0">{item.dimension}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Thoughts ── */}
      <div className="animate-slide-up stagger-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-blue-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Recent Thoughts</h2>
              <p className="text-[11px] text-gray-400 font-medium">{thoughts.length} thoughts captured</p>
            </div>
          </div>
        </div>

        <div className="p-5">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search thoughts..."
                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 focus:bg-white transition-all placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {['all', 'open', 'resolved', 'archived'].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    filterStatus === s
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-transparent hover:border-gray-200'
                  }`}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
              {filterType !== 'all' && (
                <span className="px-3 py-2 rounded-xl text-xs font-semibold bg-purple-100 text-purple-700 flex items-center gap-1.5">
                  {thoughtTypeLabels[filterType] || filterType}
                  <button onClick={() => setFilterType('all')} className="hover:text-purple-900 transition-colors"><X className="w-3 h-3" /></button>
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
              <div className="w-5 h-5 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <X className="w-3 h-3 text-red-600" />
              </div>
              {error}
            </div>
          )}

          {thoughts.length === 0 ? (
            <div className="text-center py-14">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center mx-auto mb-4 shadow-inner">
                <MessageSquare className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-sm text-gray-500 mb-1 font-medium">Your mind is a blank canvas</p>
              <p className="text-xs text-gray-400 mb-4">Start capturing your thoughts to see them here</p>
              <Link to="/new-thought" className="inline-flex items-center gap-2 text-sm text-white bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 rounded-xl font-semibold hover:shadow-lg hover:shadow-indigo-500/20 transition-all hover:-translate-y-0.5">
                <Sparkles className="w-4 h-4" />
                Create your first thought
              </Link>
            </div>
          ) : filteredThoughts.length === 0 ? (
            <div className="text-center py-10">
              <Search className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400 font-medium">No matching thoughts found</p>
              <button onClick={clearFilters} className="text-xs text-indigo-600 hover:text-indigo-700 mt-1.5 font-semibold hover:underline">Clear all filters</button>
            </div>
          ) : (
            <div className="space-y-1">
              {(showAllThoughts ? filteredThoughts : filteredThoughts.slice(0, 5)).map((thought, i) => {
                const typeColor = thoughtTypeColors[thought.thoughtType] || { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' }
                return (
                  <Link
                    key={thought.id}
                    to={`/thought/${thought.id}`}
                    className="flex items-center gap-3 py-3 px-3.5 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent rounded-xl transition-all group"
                  >
                    {/* Color dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${typeColor.dot} ring-4 ring-opacity-20 ${typeColor.bg.replace('bg-', 'ring-')}`} />

                    {/* Title */}
                    <h3 className="text-sm font-medium text-gray-900 truncate flex-1 group-hover:text-indigo-700 transition-colors">{thought.title}</h3>

                    {/* Type badge */}
                    <span className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shrink-0 ${typeColor.bg} ${typeColor.text}`}>
                      {thoughtTypeLabels[thought.thoughtType] || thought.thoughtType}
                    </span>

                    {/* Meta */}
                    <div className="flex items-center gap-2.5 shrink-0 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1 font-medium">
                        <Clock className="w-3 h-3" />
                        {new Date(thought.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="flex items-center gap-1 font-medium">
                        <MessageSquare className="w-3 h-3" />
                        {thought.threads?.[0]?.runs?.length || 0}
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                        thought.status === 'open'
                          ? 'bg-emerald-50 text-emerald-600'
                          : thought.status === 'resolved'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {thought.status.charAt(0).toUpperCase() + thought.status.slice(1)}
                      </span>
                      <button
                        onClick={(e) => handleDelete(e, thought.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {/* View All link */}
          {filteredThoughts.length > 5 && (
            <div className="pt-4 mt-3 border-t border-gray-100 text-center">
              <button
                onClick={() => setShowAllThoughts(!showAllThoughts)}
                className="inline-flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-700 font-bold hover:underline"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {showAllThoughts ? 'Show less' : `View all ${filteredThoughts.length} thoughts`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
