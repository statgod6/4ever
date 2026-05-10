import { Loader2, BarChart3, AlertTriangle } from 'lucide-react'
import { AnnualReviewData, relationshipsApi } from '../../api/relationships'
import { toast } from '../../components/Toast'

interface Props {
  annualReview: AnnualReviewData | null
  setAnnualReview: React.Dispatch<React.SetStateAction<AnnualReviewData | null>>
  reviewLoading: boolean
  setReviewLoading: React.Dispatch<React.SetStateAction<boolean>>
}

export default function AnnualReviewTab({
  annualReview, setAnnualReview, reviewLoading, setReviewLoading,
}: Props) {
  const loadAnnualReview = async () => {
    setReviewLoading(true)
    try {
      const data = await relationshipsApi.getAnnualReview()
      setAnnualReview(data)
    } catch (err: any) {
      toast.error('Failed', err.response?.data?.message || 'Could not load review')
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <div>
      {!annualReview && !reviewLoading && (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mx-auto mb-5">
            <BarChart3 className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Annual Relationship Review</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">Get a comprehensive look at your relationship patterns over the past year.</p>
          <button onClick={loadAnnualReview} className="btn-primary inline-flex items-center gap-2 shadow-sm">
            <BarChart3 className="w-5 h-5" /> Generate Review
          </button>
        </div>
      )}

      {reviewLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      )}

      {annualReview && !reviewLoading && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card text-center">
              <div className="text-3xl font-bold text-rose-600">{annualReview.totalPeople}</div>
              <div className="text-xs text-gray-500 font-medium mt-1">People in Circle</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-indigo-600">{annualReview.totalInteractions}</div>
              <div className="text-xs text-gray-500 font-medium mt-1">Total Interactions</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-purple-600">{annualReview.ritualCount}</div>
              <div className="text-xs text-gray-500 font-medium mt-1">Active Rituals</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-amber-600">{annualReview.eventsThisYear}</div>
              <div className="text-xs text-gray-500 font-medium mt-1">Life Events</div>
            </div>
          </div>

          {/* Monthly Trend */}
          <div className="card">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Monthly Interaction Trend</h3>
            <div className="flex items-end gap-1 h-32">
              {annualReview.monthlyTrend.map((m) => {
                const maxCount = Math.max(...annualReview.monthlyTrend.map((t) => t.count), 1)
                const height = Math.max(4, (m.count / maxCount) * 100)
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-500 font-medium">{m.count || ''}</span>
                    <div
                      className="w-full bg-gradient-to-t from-indigo-500 to-indigo-300 rounded-t-sm transition-all"
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">{m.month}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Most Active */}
          {annualReview.mostActive.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Most Active Relationships</h3>
              <div className="space-y-2">
                {annualReview.mostActive.filter((p) => p.noteCount > 0).map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-400 w-6 text-right">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{p.name}</span>
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs">{p.relationship}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {p.sentimentBreakdown.positive > 0 && (
                        <span className="text-emerald-600 font-medium">+{p.sentimentBreakdown.positive}</span>
                      )}
                      {p.sentimentBreakdown.negative > 0 && (
                        <span className="text-red-600 font-medium">-{p.sentimentBreakdown.negative}</span>
                      )}
                      <span className="font-bold text-indigo-600">{p.noteCount} notes</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tension Summary */}
          {annualReview.tensionStats.total > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Tension Summary</h3>
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-2xl font-bold text-red-600">{annualReview.tensionStats.total}</div>
                  <div className="text-xs text-gray-500">Total Tensions</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-600">{annualReview.tensionStats.resolved}</div>
                  <div className="text-xs text-gray-500">Resolved</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600">{annualReview.tensionStats.total - annualReview.tensionStats.resolved}</div>
                  <div className="text-xs text-gray-500">Unresolved</div>
                </div>
              </div>
            </div>
          )}

          {/* New People */}
          {annualReview.newPeople.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">New People Added This Year</h3>
              <div className="flex flex-wrap gap-2">
                {annualReview.newPeople.map((p) => (
                  <span key={p.id} className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                    {p.name} ({p.relationship})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Neglected */}
          {annualReview.neglected.length > 0 && (
            <div className="card border-l-4 border-l-amber-400">
              <h3 className="text-sm font-bold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Needs Attention
              </h3>
              <p className="text-sm text-gray-600 mb-3">These people have had no logged interactions in the past year:</p>
              <div className="flex flex-wrap gap-2">
                {annualReview.neglected.map((p) => (
                  <span key={p.id} className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
                    {p.name} ({p.relationship})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-center">
            <button onClick={loadAnnualReview} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <BarChart3 className="w-4 h-4" /> Refresh Review
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
