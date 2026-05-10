import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  CalendarDays,
  Plus,
  Trash2,
  Loader2,
  Save,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  SkipForward,
  RotateCcw,
} from 'lucide-react'
import { plannerApi, type PlanTask, type PlannedDate } from '../api/planner'
import { checkInApi } from '../api/checkin'
import { toast } from '../components/Toast'
import Markdown from '../components/Markdown'

interface LocalTask {
  id?: string
  tempId: string
  timeSlot: string
  task: string
  insight: string | null
  status: string
  sortOrder: number
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getTomorrowDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return toDateStr(d)
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function isSameDay(a: string, b: string): boolean {
  return a === b
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  // Monday = 0 ... Sunday = 6
  let startDay = firstDay.getDay() - 1
  if (startDay < 0) startDay = 6

  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  // fill to complete last week
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

let tempCounter = 0

export default function Planner() {
  const todayStr = toDateStr(new Date())
  const tomorrowStr = getTomorrowDate()

  // Calendar state
  const [calYear, setCalYear] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.getFullYear()
  })
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.getMonth()
  })
  const [plannedDates, setPlannedDates] = useState<PlannedDate[]>([])

  // Selected day state
  const [selectedDate, setSelectedDate] = useState(tomorrowStr)
  const [tasks, setTasks] = useState<LocalTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({})
  const [expandedInsight, setExpandedInsight] = useState<Record<string, boolean>>({})
  const [showCalendar, setShowCalendar] = useState(false)

  // Check-in state
  const [checkInMood, setCheckInMood] = useState<number>(0)
  const [checkInEnergy, setCheckInEnergy] = useState<number>(0)
  const [checkInNote, setCheckInNote] = useState('')
  const [checkInSaving, setCheckInSaving] = useState(false)

  // Calendar cells
  const calendarDays = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth])

  // Planned dates lookup
  const plannedLookup = useMemo(() => {
    const map: Record<string, number> = {}
    plannedDates.forEach((p) => { map[p.date] = p.taskCount })
    return map
  }, [plannedDates])

  // Load planned dates for current calendar month
  const loadPlannedDates = useCallback(async (year: number, month: number) => {
    try {
      const dates = await plannerApi.getPlannedDates(year, month + 1) // API expects 1-indexed
      setPlannedDates(dates)
    } catch {
      setPlannedDates([])
    }
  }, [])

  useEffect(() => {
    loadPlannedDates(calYear, calMonth)
  }, [calYear, calMonth, loadPlannedDates])

  // Load plan for selected date
  const loadPlan = useCallback(async (date: string) => {
    setIsLoading(true)
    setHasChanges(false)
    setExpandedInsight({})
    try {
      const [plan, checkIn] = await Promise.all([
        plannerApi.getPlan(date),
        checkInApi.getCheckIn(date).catch(() => null),
      ])
      if (checkIn) {
        setCheckInMood(checkIn.mood)
        setCheckInEnergy(checkIn.energy)
        setCheckInNote(checkIn.note || '')
      } else {
        setCheckInMood(0)
        setCheckInEnergy(0)
        setCheckInNote('')
      }
      if (plan && plan.tasks.length > 0) {
        setTasks(
          plan.tasks.map((t: PlanTask) => ({
            id: t.id,
            tempId: `existing-${t.id}`,
            timeSlot: t.timeSlot,
            task: t.task,
            insight: t.insight,
            status: t.status || 'pending',
            sortOrder: t.sortOrder,
          }))
        )
      } else {
        setTasks([])
      }
    } catch {
      setTasks([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlan(selectedDate)
  }, [selectedDate, loadPlan])

  // Re-fetch when user navigates back to this page (e.g. after adding from Actions)
  useEffect(() => {
    const handleFocus = () => {
      loadPlan(selectedDate)
      loadPlannedDates(calYear, calMonth)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [selectedDate, calYear, calMonth, loadPlan, loadPlannedDates])

  const navigateMonth = (delta: number) => {
    let newMonth = calMonth + delta
    let newYear = calYear
    if (newMonth < 0) { newMonth = 11; newYear-- }
    if (newMonth > 11) { newMonth = 0; newYear++ }
    setCalMonth(newMonth)
    setCalYear(newYear)
  }

  const selectDay = (d: Date) => {
    const ds = toDateStr(d)
    setSelectedDate(ds)
    // If clicked date is in a different month, navigate calendar
    if (d.getFullYear() !== calYear || d.getMonth() !== calMonth) {
      setCalYear(d.getFullYear())
      setCalMonth(d.getMonth())
    }
  }

  const goToToday = () => {
    const now = new Date()
    setCalYear(now.getFullYear())
    setCalMonth(now.getMonth())
    setSelectedDate(toDateStr(now))
  }

  // Task operations
  const addTask = () => {
    tempCounter++
    setTasks((prev) => [
      ...prev,
      {
        tempId: `new-${tempCounter}`,
        timeSlot: '',
        task: '',
        insight: null,
        status: 'pending',
        sortOrder: prev.length,
      },
    ])
    setHasChanges(true)
  }

  const removeTask = (tempId: string) => {
    setTasks((prev) => prev.filter((t) => t.tempId !== tempId))
    setHasChanges(true)
  }

  const updateTask = (tempId: string, field: 'timeSlot' | 'task', value: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.tempId === tempId ? { ...t, [field]: value, insight: field === 'task' ? null : t.insight } : t))
    )
    setHasChanges(true)
  }

  const moveTask = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= tasks.length) return
    setTasks((prev) => {
      const updated = [...prev]
      const temp = updated[index]
      updated[index] = updated[newIndex]
      updated[newIndex] = temp
      return updated.map((t, i) => ({ ...t, sortOrder: i }))
    })
    setHasChanges(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const validTasks = tasks.filter((t) => t.timeSlot.trim() && t.task.trim())
      const plan = await plannerApi.savePlan(
        selectedDate,
        validTasks.map((t, i) => ({
          timeSlot: t.timeSlot,
          task: t.task,
          sortOrder: i,
          insight: t.insight,
        }))
      )
      if (plan && plan.tasks) {
        setTasks(
          plan.tasks.map((t: PlanTask) => ({
            id: t.id,
            tempId: `existing-${t.id}`,
            timeSlot: t.timeSlot,
            task: t.task,
            insight: t.insight,
            status: t.status || 'pending',
            sortOrder: t.sortOrder,
          }))
        )
      }
      setHasChanges(false)
      toast.success('Plan saved', `Your plan for ${formatDisplayDate(selectedDate)} has been saved.`)
      // Refresh calendar dots
      loadPlannedDates(calYear, calMonth)
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.message || 'Could not save plan.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGetInsight = async (localTask: LocalTask) => {
    if (!localTask.id) {
      toast.warning('Save first', 'Please save your plan before generating insights.')
      return
    }

    setInsightLoading((prev) => ({ ...prev, [localTask.tempId]: true }))
    try {
      const result = await plannerApi.getTaskInsight(localTask.id)
      setTasks((prev) =>
        prev.map((t) => (t.tempId === localTask.tempId ? { ...t, insight: result.insight } : t))
      )
      setExpandedInsight((prev) => ({ ...prev, [localTask.tempId]: true }))
      if (!result.cached) {
        toast.success('Insight generated', 'Task workflow breakdown is ready.')
      }
    } catch (err: any) {
      toast.error('Insight failed', err.response?.data?.message || 'Could not generate insight.')
    } finally {
      setInsightLoading((prev) => ({ ...prev, [localTask.tempId]: false }))
    }
  }

  // Date labels
  const dateLabel = isSameDay(selectedDate, todayStr) ? 'Today' : isSameDay(selectedDate, tomorrowStr) ? 'Tomorrow' : ''

  const handleToggleStatus = async (localTask: LocalTask, newStatus: 'done' | 'skipped' | 'pending') => {
    if (!localTask.id) {
      toast.warning('Save first', 'Save your plan before marking tasks.')
      return
    }
    try {
      await plannerApi.updateTaskStatus(localTask.id, newStatus)
      setTasks((prev) =>
        prev.map((t) => (t.tempId === localTask.tempId ? { ...t, status: newStatus } : t))
      )
    } catch {
      toast.error('Update failed', 'Could not update task status.')
    }
  }

  const handleCheckInSave = async (mood: number, energy: number, note: string) => {
    setCheckInSaving(true)
    try {
      await checkInApi.saveCheckIn(selectedDate, mood, energy, note || undefined)
    } catch {
      // silent fail — it's auto-save
    } finally {
      setCheckInSaving(false)
    }
  }

  const MOOD_EMOJIS = ['', '\ud83d\ude1e', '\ud83d\ude15', '\ud83d\ude10', '\ud83d\ude42', '\ud83d\ude04']
  const ENERGY_LABELS = ['', '\u26a0\ufe0f Very Low', '\ud83d\udd0b Low', '\u26a1 Medium', '\ud83d\udcaa High', '\ud83d\ude80 Peak']

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <CalendarDays className="w-7 h-7 text-primary-600" />
            Day Planner
          </h1>
          <p className="text-gray-600 mt-1">Plan any day with time-slotted tasks and AI workflows</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors text-gray-600"
          >
            Go to Today
          </button>
          <button
            onClick={() => setShowCalendar((v) => !v)}
            className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors text-gray-600"
            title={showCalendar ? 'Hide calendar' : 'Show calendar'}
          >
            {showCalendar ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Calendar + Day Detail Layout */}
      <div className={`grid grid-cols-1 ${showCalendar ? 'lg:grid-cols-[340px_1fr]' : ''} gap-6`}>
        {/* Calendar */}
        <div className={`card h-fit ${showCalendar ? '' : 'hidden'}`}>
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => navigateMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {MONTH_NAMES[calMonth]} {calYear}
            </h2>
            <button onClick={() => navigateMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="h-10" />

              const ds = toDateStr(day)
              const isSelected = isSameDay(ds, selectedDate)
              const isCurrentDay = isSameDay(ds, todayStr)
              const taskCount = plannedLookup[ds] || 0
              const isPast = ds < todayStr

              return (
                <button
                  key={ds}
                  onClick={() => selectDay(day)}
                  className={`
                    relative h-10 rounded-lg text-sm font-medium transition-all
                    ${isSelected
                      ? 'bg-primary-600 text-white shadow-md'
                      : isCurrentDay
                        ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-300'
                        : isPast
                          ? 'text-gray-400 hover:bg-gray-50'
                          : 'text-gray-700 hover:bg-gray-100'
                    }
                  `}
                >
                  {day.getDate()}
                  {taskCount > 0 && (
                    <span
                      className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-white' : 'bg-emerald-500'
                      }`}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Has tasks
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary-600" />
              Selected
            </div>
          </div>
        </div>

        {/* Day Detail Panel */}
        <div>
          {/* Selected Date Header */}
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold text-gray-900">{formatDisplayDate(selectedDate)}</h2>
            {dateLabel && (
              <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-full text-sm font-medium">
                {dateLabel}
              </span>
            )}
          </div>

          {/* Daily Check-In Card */}
          <div className="card mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Mood */}
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">Mood</span>
                <div className="flex gap-1.5 mt-1">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      onClick={() => { setCheckInMood(v); handleCheckInSave(v, checkInEnergy || 3, checkInNote) }}
                      className={`w-8 h-8 rounded-full text-lg flex items-center justify-center transition-all ${
                        checkInMood === v
                          ? 'ring-2 ring-primary-400 bg-primary-50 scale-110'
                          : 'hover:bg-gray-100'
                      }`}
                      title={`Mood ${v}/5`}
                    >
                      {MOOD_EMOJIS[v]}
                    </button>
                  ))}
                </div>
              </div>
              {/* Energy */}
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">Energy</span>
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      onClick={() => { setCheckInEnergy(v); handleCheckInSave(checkInMood || 3, v, checkInNote) }}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                        checkInEnergy === v
                          ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {ENERGY_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>
              {/* Note */}
              <div className="flex-1">
                <span className="text-xs font-medium text-gray-500 uppercase">Quick Note</span>
                <input
                  type="text"
                  value={checkInNote}
                  onChange={(e) => setCheckInNote(e.target.value)}
                  onBlur={() => { if (checkInMood > 0) handleCheckInSave(checkInMood, checkInEnergy || 3, checkInNote) }}
                  placeholder="How's your day?"
                  className="input text-sm w-full mt-1"
                />
              </div>
              {checkInSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-4" />}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="card text-center py-12">
              <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks planned</h3>
              <p className="text-gray-500 mb-5">Add time slots and tasks to plan this day.</p>
              <button onClick={addTask} className="btn-primary inline-flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Add First Task
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Column Headers */}
              <div className="hidden md:grid md:grid-cols-[auto_40px_160px_1fr_140px] gap-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="w-8" />
                <div></div>
                <div>Time Slot</div>
                <div>Task</div>
                <div className="text-center">Insight</div>
              </div>

              {/* Task Rows */}
              {tasks.map((localTask, index) => {
                const isDone = localTask.status === 'done'
                const isSkipped = localTask.status === 'skipped'
                return (
                <div key={localTask.tempId} className={`card !p-0 overflow-hidden ${isDone ? 'bg-emerald-50/40 border-emerald-200' : isSkipped ? 'bg-gray-50 border-gray-200 opacity-60' : ''}`}>
                  <div className="grid grid-cols-1 md:grid-cols-[auto_40px_160px_1fr_140px] gap-3 p-4 items-start">
                    {/* Reorder + Delete */}
                    <div className="flex md:flex-col items-center gap-1 justify-center">
                      <button
                        onClick={() => moveTask(index, 'up')}
                        disabled={index === 0}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        title="Move up"
                      >
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      </button>
                      <button
                        onClick={() => removeTask(localTask.tempId)}
                        className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveTask(index, 'down')}
                        disabled={index === tasks.length - 1}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        title="Move down"
                      >
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>

                    {/* Status Toggle */}
                    <div className="flex items-center justify-center">
                      {isDone ? (
                        <button
                          onClick={() => handleToggleStatus(localTask, 'pending')}
                          className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 transition-colors"
                          title="Mark as pending"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      ) : isSkipped ? (
                        <button
                          onClick={() => handleToggleStatus(localTask, 'pending')}
                          className="w-7 h-7 rounded-full bg-gray-400 text-white flex items-center justify-center hover:bg-gray-500 transition-colors"
                          title="Undo skip"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleToggleStatus(localTask, 'done')}
                            className="w-7 h-7 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
                            title="Mark done"
                          >
                            <Check className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(localTask, 'skipped')}
                            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title="Skip"
                          >
                            <SkipForward className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Time Slot */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1 md:hidden">Time Slot</label>
                      <input
                        type="text"
                        value={localTask.timeSlot}
                        onChange={(e) => updateTask(localTask.tempId, 'timeSlot', e.target.value)}
                        placeholder="6:00 - 7:00 AM"
                        className={`input text-sm w-full ${isDone ? 'line-through text-gray-400' : ''}`}
                      />
                    </div>

                    {/* Task */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1 md:hidden">Task</label>
                      <input
                        type="text"
                        value={localTask.task}
                        onChange={(e) => updateTask(localTask.tempId, 'task', e.target.value)}
                        placeholder="What will you do in this time slot?"
                        className={`input text-sm w-full ${isDone ? 'line-through text-gray-400' : isSkipped ? 'line-through text-gray-400' : ''}`}
                      />
                    </div>

                    {/* Insight Button */}
                    <div className="flex items-center justify-center">
                      {localTask.insight ? (
                        <button
                          onClick={() =>
                            setExpandedInsight((prev) => ({
                              ...prev,
                              [localTask.tempId]: !prev[localTask.tempId],
                            }))
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors w-full justify-center"
                        >
                          <Sparkles className="w-4 h-4" />
                          {expandedInsight[localTask.tempId] ? 'Hide' : 'View'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGetInsight(localTask)}
                          disabled={insightLoading[localTask.tempId] || !localTask.id || !localTask.task.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-40 w-full justify-center"
                        >
                          {insightLoading[localTask.tempId] ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          Insight
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Insight */}
                  {localTask.insight && expandedInsight[localTask.tempId] && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-emerald-800 mb-2 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Workflow for: {localTask.task}
                        </h4>
                        <div className="prose prose-sm max-w-none text-gray-700">
                          <Markdown content={localTask.insight} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )})
            }
            </div>
          )}

          {/* Add Task Button */}
          <button
            onClick={addTask}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Time Slot
          </button>
        </div>
      </div>

      {/* Sticky Save Bar */}
      {(hasChanges || tasks.length > 0) && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-40">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {tasks.filter((t) => t.timeSlot.trim() && t.task.trim()).length} task(s) planned
              {hasChanges && (
                <span className="ml-2 text-amber-600 font-medium">· Unsaved changes</span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={isSaving || tasks.filter((t) => t.timeSlot.trim() && t.task.trim()).length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              Save Plan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
