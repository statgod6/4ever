import { useEffect, useState } from 'react'
import {
  Loader2,
  TrendingUp,
  BarChart3,
  Users,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  Target,
  Repeat,
  Zap,
} from 'lucide-react'
import {
  insightsApi,
  type InsightStats,
  type RecurringTopic,
  type InsightReport,
  type LifeDimension,
  type RelationshipHealthResponse,
} from '../api/insights'
import { userContextApi } from '../api/userContext'
import { toast } from '../components/Toast'
import Markdown from '../components/Markdown'

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

const thoughtTypeColors: Record<string, string> = {
  'business idea': 'bg-blue-500',
  'personal decision': 'bg-green-500',
  'career concern': 'bg-purple-500',
  'emotional situation': 'bg-pink-500',
  'relationship issue': 'bg-red-500',
  'research thought': 'bg-indigo-500',
  'content idea': 'bg-yellow-500',
  'ethical dilemma': 'bg-orange-500',
  'startup plan': 'bg-cyan-500',
  'life choice': 'bg-teal-500',
  'general reflection': 'bg-gray-400',
}

const thoughtTypeBgColors: Record<string, string> = {
  'business idea': 'bg-blue-100 text-blue-800',
  'personal decision': 'bg-green-100 text-green-800',
  'career concern': 'bg-purple-100 text-purple-800',
  'emotional situation': 'bg-pink-100 text-pink-800',
  'relationship issue': 'bg-red-100 text-red-800',
  'research thought': 'bg-indigo-100 text-indigo-800',
  'content idea': 'bg-yellow-100 text-yellow-800',
  'ethical dilemma': 'bg-orange-100 text-orange-800',
  'startup plan': 'bg-cyan-100 text-cyan-800',
  'life choice': 'bg-teal-100 text-teal-800',
  'general reflection': 'bg-gray-100 text-gray-800',
}

export default function Insights() {
  const [stats, setStats] = useState<InsightStats | null>(null)
  const [recurringTopics, setRecurringTopics] = useState<RecurringTopic[]>([])
  const [reports, setReports] = useState<InsightReport[]>([])
  const [isLoadingStats, setIsLoadingStats] = useState(true)
  const [isLoadingTopics, setIsLoadingTopics] = useState(false)
  const [isLoadingReports, setIsLoadingReports] = useState(false)
  const [generatingEvolution, setGeneratingEvolution] = useState<string | null>(null)
  const [generatingWeekly, setGeneratingWeekly] = useState(false)
  const [expandedReport, setExpandedReport] = useState<string | null>(null)
  const [evolutionResults, setEvolutionResults] = useState<Record<string, InsightReport>>({})
  const [lifeDimensions, setLifeDimensions] = useState<LifeDimension[]>([])
  const [isLoadingDimensions, setIsLoadingDimensions] = useState(false)
  const [relationshipHealth, setRelationshipHealth] = useState<RelationshipHealthResponse | null>(null)
  const [isLoadingHealth, setIsLoadingHealth] = useState(false)
  const [optInBusy, setOptInBusy] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setIsLoadingStats(true)
    setIsLoadingTopics(true)
    setIsLoadingReports(true)

    try {
      const [statsData, topicsData, reportsData, dimensionsData] = await Promise.allSettled([
        insightsApi.getStats(),
        insightsApi.getRecurringTopics(),
        insightsApi.getReports(),
        insightsApi.getLifeDimensions(),
      ])

      if (statsData.status === 'fulfilled') setStats(statsData.value)
      if (topicsData.status === 'fulfilled') setRecurringTopics(topicsData.value)
      if (reportsData.status === 'fulfilled') setReports(reportsData.value)
      if (dimensionsData.status === 'fulfilled') setLifeDimensions(dimensionsData.value)
      try {
        setIsLoadingHealth(true)
        const health = await insightsApi.getRelationshipHealth({ days: 30 })
        setRelationshipHealth(health)
      } catch { /* silently ignore */ } finally {
        setIsLoadingHealth(false)
      }
    } catch {
      toast.error('Load failed', 'Could not load insights data.')
    } finally {
      setIsLoadingStats(false)
      setIsLoadingTopics(false)
      setIsLoadingReports(false)
    }
  }

  const handleGenerateEvolution = async (cluster: RecurringTopic) => {
    const key = cluster.thoughtIds.join(',')
    setGeneratingEvolution(key)
    try {
      const report = await insightsApi.generateEvolution(cluster.thoughtIds)
      setEvolutionResults((prev) => ({ ...prev, [key]: report }))
      setReports((prev) => [report, ...prev])
      toast.success('Evolution analysis complete', 'Your thinking evolution has been analyzed.')
    } catch (err: any) {
      toast.error('Analysis failed', err.response?.data?.message || 'Could not generate evolution analysis.')
    } finally {
      setGeneratingEvolution(null)
    }
  }

  const handleGenerateWeekly = async () => {
    setGeneratingWeekly(true)
    try {
      const report = await insightsApi.generateWeeklyInsight()
      setReports((prev) => [report, ...prev])
      toast.success('Weekly insight generated', 'Your weekly thinking report is ready.')
    } catch (err: any) {
      toast.error('Generation failed', err.response?.data?.message || 'Could not generate weekly insight.')
    } finally {
      setGeneratingWeekly(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (isLoadingStats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  const handleToggleOptIn = async (enabled: boolean) => {
    setOptInBusy(true)
    try {
      await userContextApi.setRelationshipHealthOptIn(enabled)
      if (enabled) {
        const health = await insightsApi.getRelationshipHealth({ days: 30 })
        setRelationshipHealth(health)
      } else {
        setRelationshipHealth({ optIn: false, reports: [] })
      }
      toast.success(enabled ? 'Opted in' : 'Opted out', 'Relationship health preference updated.')
    } catch (err: any) {
      toast.error('Update failed', err.response?.data?.message || 'Could not update preference.')
    } finally {
      setOptInBusy(false)
    }
  }

  const maxTopicCount = stats?.topicDistribution?.[0]?.count || 1
  const maxTimelineCount = Math.max(...(stats?.timeline?.map((w) => w.count) || [1]))

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <TrendingUp className="w-7 h-7 text-primary-600" />
            Thinking Insights
          </h1>
          <p className="text-gray-600 mt-1">Track how your thinking evolves over time</p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Relationship Health */}
      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            <h2 className="text-lg font-semibold text-gray-900">Relationship Health</h2>
            <span className="text-xs text-gray-400">last 30 days</span>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={!!relationshipHealth?.optIn}
              onChange={(e) => handleToggleOptIn(e.target.checked)}
              disabled={optInBusy}
              className="accent-violet-600"
            />
            <span className="text-gray-600">Enable reports</span>
          </label>
        </div>
        {isLoadingHealth ? (
          <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
        ) : !relationshipHealth?.optIn ? (
          <p className="text-sm text-gray-500">Turn on reports to see aggregated mediation insights per connection. Requires both sides to have an active mediator history.</p>
        ) : relationshipHealth.reports.length === 0 ? (
          <p className="text-sm text-gray-500">No mediation activity yet.</p>
        ) : (
          <div className="space-y-3">
            {relationshipHealth.reports.map((r) => (
              <div key={r.connectionId} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm text-gray-900">{r.partner.name}</div>
                  <span className="text-[11px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded">{r.mediatorStyle}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><div className="text-gray-400">Sessions</div><div className="font-semibold text-gray-800">{r.summary.totalSessions}</div></div>
                  <div><div className="text-gray-400">Messages</div><div className="font-semibold text-gray-800">{r.summary.totalMessages}</div></div>
                  <div><div className="text-gray-400">Sessions trend</div><div className={`font-semibold ${r.trend.sessions.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{(r.trend.sessions.change * 100).toFixed(0)}%</div></div>
                  <div><div className="text-gray-400">Msg trend</div><div className={`font-semibold ${r.trend.messages.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{(r.trend.messages.change * 100).toFixed(0)}%</div></div>
                </div>
                {r.topTopics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.topTopics.map((t) => (
                      <span key={t.topic} className="text-[11px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{t.topic} ×{t.count}</span>
                    ))}
                  </div>
                )}
                {Object.keys(r.actions).length > 0 && (
                  <div className="mt-2 text-[11px] text-gray-600">
                    {Object.entries(r.actions).map(([type, v]) => (
                      <span key={type} className="mr-3">{type}: {v.accepted}/{v.created} accepted</span>
                    ))}
                  </div>
                )}
                {r.summary.lastMediationSummary && (
                  <div className="mt-2 text-xs text-gray-600 italic">“{r.summary.lastMediationSummary}”</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Life Dimensions Wheel */}
      {lifeDimensions.length > 0 && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-primary-600" />
            Life Dimensions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {lifeDimensions.map((dim) => {
              const isNeglected = dim.lastThoughtDate
                ? (Date.now() - new Date(dim.lastThoughtDate).getTime()) > 14 * 86400000
                : dim.thoughtCount === 0;
              const maxCount = Math.max(...lifeDimensions.map((d) => d.thoughtCount), 1);
              const barWidth = Math.max((dim.thoughtCount / maxCount) * 100, 2);

              return (
                <div
                  key={dim.dimension}
                  className={`p-3 rounded-lg border ${
                    isNeglected
                      ? 'border-amber-200 bg-amber-50/50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{dim.dimension}</span>
                    {isNeglected && (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Neglected</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {dim.thoughtCount} thought{dim.thoughtCount !== 1 ? 's' : ''}
                    {dim.percentage > 0 && ` (${dim.percentage}%)`}
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        isNeglected ? 'bg-amber-400' : 'bg-primary-500'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  {dim.lastThoughtDate && (
                    <div className="text-xs text-gray-400 mt-1">
                      Last: {new Date(dim.lastThoughtDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 1: Quick Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <FileText className="w-4 h-4" />
              Total Thoughts
            </div>
            <div className="text-3xl font-bold text-gray-900">{stats.statusFlow.total}</div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <Target className="w-4 h-4" />
              Resolution Rate
            </div>
            <div className="text-3xl font-bold text-emerald-600">{stats.statusFlow.resolutionRate}%</div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <BarChart3 className="w-4 h-4" />
              Top Topic
            </div>
            <div className="text-lg font-bold text-gray-900 truncate">
              {stats.topicDistribution[0]
                ? thoughtTypeLabels[stats.topicDistribution[0].type] || stats.topicDistribution[0].type
                : 'None yet'}
            </div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <Users className="w-4 h-4" />
              Top Persona
            </div>
            <div className="text-lg font-bold text-gray-900 truncate">
              {stats.personaEffectiveness[0]?.personaName || 'None yet'}
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Topic Distribution */}
      {stats && stats.topicDistribution.length > 0 && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary-600" />
            Topic Distribution
          </h2>
          <div className="space-y-3">
            {stats.topicDistribution.map((topic) => (
              <div key={topic.type} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-36 truncate flex-shrink-0">
                  {thoughtTypeLabels[topic.type] || topic.type}
                </span>
                <div className="flex-1 h-7 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${thoughtTypeColors[topic.type] || 'bg-gray-400'}`}
                    style={{ width: `${Math.max((topic.count / maxTopicCount) * 100, 8)}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-600 w-16 text-right">
                  {topic.count} ({topic.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: Thinking Timeline */}
      {stats && stats.timeline.length > 0 && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-600" />
            Thinking Timeline (Last 12 Weeks)
          </h2>
          <div className="flex items-end gap-2 h-40">
            {stats.timeline.map((week, i) => {
              const height = maxTimelineCount > 0 ? (week.count / maxTimelineCount) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-gray-600">{week.count}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                    <div
                      className="w-full bg-primary-500 rounded-t-md transition-all hover:bg-primary-600"
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`Week of ${formatDate(week.week)}: ${week.count} thought(s)\nTypes: ${week.types.join(', ')}`}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 truncate w-full text-center">
                    {new Date(week.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Section 4: Persona Effectiveness */}
      {stats && stats.personaEffectiveness.length > 0 && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-600" />
            Persona Effectiveness
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Persona</th>
                  <th className="text-center py-2 px-3 font-medium text-gray-500">Responses</th>
                  <th className="text-center py-2 px-3 font-medium text-gray-500">Your Replies</th>
                  <th className="text-center py-2 px-3 font-medium text-gray-500">Thoughts</th>
                  <th className="text-center py-2 px-3 font-medium text-gray-500">Resolved</th>
                  <th className="text-center py-2 px-3 font-medium text-gray-500">Engagement</th>
                </tr>
              </thead>
              <tbody>
                {stats.personaEffectiveness.map((persona, i) => (
                  <tr key={persona.personaId} className={`border-b border-gray-100 ${i === 0 ? 'bg-amber-50' : ''}`}>
                    <td className="py-2.5 px-3 font-medium text-gray-900 flex items-center gap-2">
                      {i === 0 && <Zap className="w-4 h-4 text-amber-500" />}
                      {persona.personaName}
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-700">{persona.totalResponses}</td>
                    <td className="py-2.5 px-3 text-center text-gray-700">{persona.directReplies}</td>
                    <td className="py-2.5 px-3 text-center text-gray-700">{persona.thoughtsParticipated}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        persona.resolutionRate >= 50 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {persona.resolutionRate}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${Math.min(persona.engagementScore, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{persona.engagementScore}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Engagement = your direct replies / total responses. Higher means you interact more with this persona.
          </p>
        </div>
      )}

      {/* Section 5: Recurring Topics */}
      <div className="card mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Repeat className="w-5 h-5 text-primary-600" />
            Recurring Topics
          </h2>
          {isLoadingTopics && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        </div>

        {recurringTopics.length === 0 ? (
          <p className="text-gray-500 text-sm">
            {isLoadingTopics
              ? 'Analyzing thought patterns...'
              : 'No recurring topics detected yet. Keep adding thoughts and patterns will emerge as topics recur.'}
          </p>
        ) : (
          <div className="space-y-4">
            {recurringTopics.map((cluster, i) => {
              const key = cluster.thoughtIds.join(',')
              const evolution = evolutionResults[key]
              return (
                <div key={i} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        Cluster: {cluster.size} related thoughts
                      </span>
                    </div>
                    <button
                      onClick={() => handleGenerateEvolution(cluster)}
                      disabled={generatingEvolution === key}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-50"
                    >
                      {generatingEvolution === key ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      Analyze Evolution
                    </button>
                  </div>
                  <div className="space-y-2">
                    {cluster.thoughts.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${thoughtTypeBgColors[t.type] || 'bg-gray-100 text-gray-800'}`}>
                          {thoughtTypeLabels[t.type] || t.type}
                        </span>
                        <span className="text-gray-700 flex-1 truncate">{t.title}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(t.date)}</span>
                      </div>
                    ))}
                  </div>
                  {evolution && (
                    <div className="mt-4 pt-4 border-t border-gray-200 bg-primary-50/30 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-primary-800 mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        {evolution.title}
                      </h4>
                      <div className="prose prose-sm max-w-none text-gray-700">
                        <Markdown content={evolution.content} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 6: Generated Insights / Reports */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            Generated Insights
          </h2>
          <button
            onClick={handleGenerateWeekly}
            disabled={generatingWeekly}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {generatingWeekly ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Generate Weekly Insight
          </button>
        </div>

        {isLoadingReports ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No insight reports yet. Click "Generate Weekly Insight" to create your first thinking report.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      report.reportType === 'weekly' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {report.reportType === 'weekly' ? 'Weekly' : 'Evolution'}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{report.title}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(report.createdAt)}</span>
                  </div>
                  {expandedReport === report.id ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                </button>
                {expandedReport === report.id && (
                  <div className="p-4 pt-0 border-t border-gray-100">
                    <div className="prose prose-sm max-w-none text-gray-700">
                      <Markdown content={report.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
