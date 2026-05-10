import { useState } from 'react'
import { Sparkles, Loader2, Calendar, Sun, BarChart3 } from 'lucide-react'
import { reflectionsApi, type EveningReflection, type WeeklyReflection } from '../api/reflections'
import { toast } from '../components/Toast'
import Markdown from '../components/Markdown'

export default function Reflections() {
  const [evening, setEvening] = useState<EveningReflection | null>(null)
  const [weekly, setWeekly] = useState<WeeklyReflection | null>(null)
  const [loadingEvening, setLoadingEvening] = useState(false)
  const [loadingWeekly, setLoadingWeekly] = useState(false)

  const handleEvening = async () => {
    setLoadingEvening(true)
    try {
      const data = await reflectionsApi.getEvening()
      setEvening(data)
    } catch {
      toast.error('Failed', 'Could not generate evening reflection.')
    } finally {
      setLoadingEvening(false)
    }
  }

  const handleWeekly = async () => {
    setLoadingWeekly(true)
    try {
      const data = await reflectionsApi.getWeekly()
      setWeekly(data)
    } catch {
      toast.error('Failed', 'Could not generate weekly reflection.')
    } finally {
      setLoadingWeekly(false)
    }
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-7 h-7 text-primary-600" />
        <h1 className="text-2xl font-bold text-gray-900">Reflections</h1>
      </div>

      <p className="text-gray-500 mb-8">
        {greeting}. Take a moment to pause and reflect on what matters.
      </p>

      {/* Evening Reflection */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Sun className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-gray-900">Evening Reflection</h2>
          </div>
          <button
            onClick={handleEvening}
            disabled={loadingEvening}
            className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            {loadingEvening ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {evening ? 'Regenerate' : 'How was my day?'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Reviews your today's plan, mood, and thoughts to generate a personalized evening prompt.
        </p>
        {evening && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <Markdown content={evening.reflection} />
          </div>
        )}
      </div>

      {/* Weekly Reflection */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-900">Weekly Reflection</h2>
          </div>
          <button
            onClick={handleWeekly}
            disabled={loadingWeekly}
            className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            {loadingWeekly ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <BarChart3 className="w-4 h-4" />
            )}
            {weekly ? 'Regenerate' : 'Review my week'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Analyzes your past 7 days — tasks, moods, energy, and thinking patterns.
        </p>

        {weekly && (
          <div>
            {/* Stats summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{weekly.stats.completionRate}%</div>
                <div className="text-xs text-gray-500">Completion</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{weekly.stats.avgMood}</div>
                <div className="text-xs text-gray-500">Avg Mood</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{weekly.stats.avgEnergy}</div>
                <div className="text-xs text-gray-500">Avg Energy</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{weekly.stats.thoughtCount}</div>
                <div className="text-xs text-gray-500">Thoughts</div>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <Markdown content={weekly.reflection} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
