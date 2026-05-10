import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  RefreshControl, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native'
import { plannerApi, type PlanTask, type DayPlan, type PlannedDate } from '../api/planner'
import { Colors, BorderRadius, Spacing, FontSize } from '../constants/colors'
import { neonCard, neonSoft } from '../constants/neonStyles'
import { useTheme } from '../contexts/ThemeContext'
import { showToast } from '../components/Toast'
import Markdown from 'react-native-markdown-display'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  let startDay = firstDay.getDay() - 1
  if (startDay < 0) startDay = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

const createMdStyles = (colors: typeof Colors) => StyleSheet.create({
  body: { fontSize: FontSize.sm, color: colors.text, lineHeight: 22 },
  heading1: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 4 },
  heading2: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  heading3: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 6, marginBottom: 4 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.textSecondary },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  list_item: { marginBottom: 2 },
  code_inline: { backgroundColor: colors.gray[100], paddingHorizontal: 4, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  link: { color: colors.primary[600] },
})

export default function PlannerScreen() {
  const { colors, isDark } = useTheme()
  const styles = createStyles(colors, isDark)
  const mdStyles = createMdStyles(colors)
  const todayStr = toDateStr(new Date())

  // Calendar state
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [plannedDates, setPlannedDates] = useState<PlannedDate[]>([])
  const [showCalendar, setShowCalendar] = useState(false)

  // Selected day state
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [newTimeSlot, setNewTimeSlot] = useState('')

  // Insight state
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({})
  const [expandedInsight, setExpandedInsight] = useState<Record<string, boolean>>({})

  // Calendar cells
  const calendarDays = useMemo(() => getCalendarDays(calYear, calMonth), [calYear, calMonth])

  // Planned dates lookup
  const plannedLookup = useMemo(() => {
    const map: Record<string, number> = {}
    plannedDates.forEach((p) => { map[p.date] = p.taskCount })
    return map
  }, [plannedDates])

  // Load planned dates for calendar month
  const loadPlannedDates = useCallback(async (year: number, month: number) => {
    try {
      const dates = await plannerApi.getPlannedDates(year, month + 1)
      setPlannedDates(dates)
    } catch { setPlannedDates([]) }
  }, [])

  useEffect(() => { loadPlannedDates(calYear, calMonth) }, [calYear, calMonth, loadPlannedDates])

  // Load plan for selected date
  const loadPlan = useCallback(async (date: string) => {
    setLoading(true)
    setExpandedInsight({})
    try { const data = await plannerApi.getPlan(date); setPlan(data) } catch { setPlan(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPlan(selectedDate) }, [selectedDate, loadPlan])

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
    if (d.getFullYear() !== calYear || d.getMonth() !== calMonth) {
      setCalYear(d.getFullYear())
      setCalMonth(d.getMonth())
    }
  }

  // Task operations
  const toggleStatus = async (task: PlanTask) => {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    try {
      await plannerApi.updateTaskStatus(task.id, newStatus as any)
      setPlan((prev) => prev ? { ...prev, tasks: prev.tasks.map((t) => t.id === task.id ? { ...t, status: newStatus } : t) } : null)
    } catch { showToast('Failed to update', 'error') }
  }

  const skipTask = async (task: PlanTask) => {
    const newStatus = task.status === 'skipped' ? 'pending' : 'skipped'
    try {
      await plannerApi.updateTaskStatus(task.id, newStatus as any)
      setPlan((prev) => prev ? { ...prev, tasks: prev.tasks.map((t) => t.id === task.id ? { ...t, status: newStatus } : t) } : null)
    } catch { showToast('Failed to update', 'error') }
  }

  const addTask = async () => {
    if (!newTask.trim()) return
    const tasks = [...(plan?.tasks || []), { timeSlot: newTimeSlot.trim(), task: newTask.trim(), sortOrder: (plan?.tasks?.length || 0) }]
    try {
      const updated = await plannerApi.savePlan(selectedDate, tasks)
      setPlan(updated)
      setNewTask('')
      setNewTimeSlot('')
      loadPlannedDates(calYear, calMonth)
    } catch { showToast('Failed to add', 'error') }
  }

  const deleteTask = async (taskId: string) => {
    if (!plan) return
    const remaining = plan.tasks.filter((t) => t.id !== taskId).map((t, i) => ({ timeSlot: t.timeSlot, task: t.task, sortOrder: i, insight: t.insight }))
    try {
      const updated = await plannerApi.savePlan(selectedDate, remaining)
      setPlan(updated)
      loadPlannedDates(calYear, calMonth)
    } catch { showToast('Failed to delete', 'error') }
  }

  const confirmDelete = (taskId: string, taskName: string) => {
    Alert.alert('Delete Task', `Remove "${taskName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTask(taskId) },
    ])
  }

  const handleGetInsight = async (task: PlanTask) => {
    if (!task.id) return
    setInsightLoading((prev) => ({ ...prev, [task.id]: true }))
    try {
      const result = await plannerApi.getTaskInsight(task.id)
      setPlan((prev) => prev ? {
        ...prev,
        tasks: prev.tasks.map((t) => t.id === task.id ? { ...t, insight: result.insight } : t),
      } : null)
      setExpandedInsight((prev) => ({ ...prev, [task.id]: true }))
      if (!result.cached) showToast('Insight generated', 'success')
    } catch { showToast('Could not generate insight', 'error') } finally {
      setInsightLoading((prev) => ({ ...prev, [task.id]: false }))
    }
  }

  const done = (plan?.tasks || []).filter((t) => t.status === 'done').length
  const total = (plan?.tasks || []).length
  const dateLabel = selectedDate === todayStr ? 'Today' : ''

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.heading}>Day Planner</Text>
          <View style={styles.headerBtns}>
            <TouchableOpacity style={styles.todayBtn} onPress={() => { setSelectedDate(todayStr); const now = new Date(); setCalYear(now.getFullYear()); setCalMonth(now.getMonth()) }}>
              <Text style={styles.todayBtnText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.calToggleBtn} onPress={() => setShowCalendar(!showCalendar)}>
              <Text style={styles.calToggleBtnText}>{showCalendar ? '\u25b2' : '\ud83d\udcc5'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Calendar */}
      {showCalendar && (
        <View style={styles.calCard}>
          {/* Month Navigation */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.monthBtn}>
              <Text style={styles.monthBtnText}>{'\u276E'}</Text>
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{MONTH_NAMES[calMonth]} {calYear}</Text>
            <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.monthBtn}>
              <Text style={styles.monthBtnText}>{'\u276F'}</Text>
            </TouchableOpacity>
          </View>

          {/* Day Headers */}
          <View style={styles.dayHeaderRow}>
            {DAY_NAMES.map((d) => <Text key={d} style={styles.dayHeaderText}>{d}</Text>)}
          </View>

          {/* Calendar Grid */}
          <View style={styles.calGrid}>
            {calendarDays.map((day, i) => {
              if (!day) return <View key={`empty-${i}`} style={styles.calCell} />
              const ds = toDateStr(day)
              const isSelected = ds === selectedDate
              const isToday = ds === todayStr
              const hasTasks = (plannedLookup[ds] || 0) > 0
              const isPast = ds < todayStr

              return (
                <TouchableOpacity
                  key={ds}
                  style={[styles.calCell, isSelected && styles.calCellSelected, isToday && !isSelected && styles.calCellToday]}
                  onPress={() => selectDay(day)}
                >
                  <Text style={[styles.calCellText, isSelected && styles.calCellTextSelected, isPast && !isSelected && styles.calCellTextPast]}>
                    {day.getDate()}
                  </Text>
                  {hasTasks && <View style={[styles.calDot, isSelected && styles.calDotSelected]} />}
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#10b981' }]} /><Text style={styles.legendText}>Has tasks</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.primary[600] }]} /><Text style={styles.legendText}>Selected</Text></View>
          </View>
        </View>
      )}

      {/* Selected Date Header */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateHeaderText}>{formatDisplayDate(selectedDate)}</Text>
        {dateLabel ? <View style={styles.dateBadge}><Text style={styles.dateBadgeText}>{dateLabel}</Text></View> : null}
      </View>
      {total > 0 && <Text style={styles.progress}>{done}/{total} completed</Text>}

      {/* Tasks */}
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary[500]} style={{ marginTop: 40 }} />
      ) : (plan?.tasks || []).length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>{'\u23f0'}</Text>
          <Text style={styles.emptyTitle}>No tasks planned</Text>
          <Text style={styles.emptySubtitle}>Add tasks below to plan this day</Text>
        </View>
      ) : (
        (plan?.tasks || []).map((task) => {
          const isDone = task.status === 'done'
          const isSkipped = task.status === 'skipped'
          return (
            <View key={task.id} style={[styles.taskCard, isDone && styles.taskCardDone, isSkipped && styles.taskCardSkipped]}>
              <View style={styles.taskTop}>
                {/* Status buttons */}
                <View style={styles.taskStatusBtns}>
                  <TouchableOpacity onPress={() => toggleStatus(task)} style={[styles.checkbox, isDone && styles.checkboxDone]}>
                    {isDone && <Text style={styles.checkmark}>{'\u2713'}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => skipTask(task)} style={[styles.skipBtn, isSkipped && styles.skipBtnActive]}>
                    <Text style={[styles.skipBtnText, isSkipped && styles.skipBtnTextActive]}>{'\u23ed'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Task content */}
                <View style={styles.taskContent}>
                  <Text style={[styles.taskText, isDone && styles.taskDoneText, isSkipped && styles.taskSkippedText]}>{task.task}</Text>
                  {task.timeSlot ? <Text style={styles.timeSlot}>{task.timeSlot}</Text> : null}
                </View>

                {/* Actions */}
                <View style={styles.taskActions}>
                  {task.insight ? (
                    <TouchableOpacity style={styles.insightViewBtn} onPress={() => setExpandedInsight((p) => ({ ...p, [task.id]: !p[task.id] }))}>
                      <Text style={styles.insightViewBtnText}>{expandedInsight[task.id] ? 'Hide' : '\u2728'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.insightBtn, (insightLoading[task.id] || !task.task.trim()) && { opacity: 0.4 }]}
                      onPress={() => handleGetInsight(task)}
                      disabled={insightLoading[task.id] || !task.task.trim()}
                    >
                      {insightLoading[task.id] ? <ActivityIndicator size="small" color={colors.primary[500]} /> : <Text style={styles.insightBtnText}>{'\u2728'}</Text>}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDelete(task.id, task.task)}>
                    <Text style={styles.deleteBtnText}>{'\ud83d\uddd1'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Expanded Insight */}
              {task.insight && expandedInsight[task.id] && (
                <View style={styles.insightBox}>
                  <Text style={styles.insightHeader}>{'\u2728'} Workflow: {task.task}</Text>
                  <Markdown style={mdStyles}>{task.insight}</Markdown>
                </View>
              )}
            </View>
          )
        })
      )}

      {/* Add Task Row */}
      <View style={styles.addSection}>
        <TextInput style={styles.addTimeInput} value={newTimeSlot} onChangeText={setNewTimeSlot} placeholder="Time slot" placeholderTextColor={colors.textMuted} />
        <TextInput style={styles.addTaskInput} value={newTask} onChangeText={setNewTask} placeholder="Add a task..." placeholderTextColor={colors.textMuted} onSubmitEditing={addTask} />
        <TouchableOpacity style={styles.addBtn} onPress={addTask}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const createStyles = (colors: typeof Colors, isDark: boolean = false) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: Spacing.xl, paddingBottom: 120 },
  header: { marginBottom: Spacing.md },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
  headerBtns: { flexDirection: 'row', gap: 8 },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: colors.border },
  todayBtnText: { fontSize: FontSize.sm, color: colors.textSecondary },
  calToggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: colors.border },
  calToggleBtnText: { fontSize: 16 },

  // Calendar
  calCard: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: Spacing.lg, ...neonCard(colors, isDark) },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  monthBtn: { padding: 8 },
  monthBtnText: { fontSize: 18, color: colors.textSecondary },
  monthTitle: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  dayHeaderText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.textMuted, paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', height: 40, justifyContent: 'center', alignItems: 'center' },
  calCellSelected: { backgroundColor: colors.primary[600], borderRadius: 10 },
  calCellToday: { backgroundColor: colors.primary[50], borderRadius: 10, borderWidth: 1, borderColor: colors.primary[300] },
  calCellText: { fontSize: 14, fontWeight: '500', color: colors.text },
  calCellTextSelected: { color: '#ffffff', fontWeight: '700' },
  calCellTextPast: { color: colors.gray[400] },
  calDot: { position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 3, backgroundColor: '#10b981' },
  calDotSelected: { backgroundColor: colors.card },
  legend: { flexDirection: 'row', gap: 16, marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: colors.gray[100] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.textMuted },

  // Date header
  dateHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  dateHeaderText: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text },
  dateBadge: { backgroundColor: colors.primary[100], paddingHorizontal: 10, paddingVertical: 2, borderRadius: BorderRadius.full },
  dateBadgeText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary[700] },
  progress: { fontSize: FontSize.sm, color: colors.primary[600], fontWeight: '600', marginBottom: Spacing.md },

  // Empty
  emptyCard: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: Spacing.md, ...neonSoft(colors, isDark) },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text, marginBottom: 4 },
  emptySubtitle: { fontSize: FontSize.sm, color: colors.textSecondary },

  // Task card
  taskCard: { backgroundColor: colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginTop: Spacing.sm, borderWidth: 1, borderColor: colors.border, ...neonCard(colors, isDark) },
  taskCardDone: { backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : '#f0fdf4', borderColor: isDark ? '#22C55E' : '#bbf7d0', ...(isDark ? { shadowColor: '#22C55E', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 4 } : null) },
  taskCardSkipped: { opacity: 0.5, backgroundColor: isDark ? colors.gray[100] : colors.gray[50] },
  taskTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  taskStatusBtns: { flexDirection: 'column', gap: 4, alignItems: 'center', marginTop: 2 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.gray[300], justifyContent: 'center', alignItems: 'center' },
  checkboxDone: { backgroundColor: colors.green[500], borderColor: colors.green[500] },
  checkmark: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  skipBtn: { width: 20, height: 20, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  skipBtnActive: { backgroundColor: colors.gray[300] },
  skipBtnText: { fontSize: 10, color: colors.gray[400] },
  skipBtnTextActive: { color: '#ffffff' },
  taskContent: { flex: 1 },
  taskText: { fontSize: FontSize.base, color: colors.text, lineHeight: 22 },
  taskDoneText: { textDecorationLine: 'line-through', color: colors.textMuted },
  taskSkippedText: { textDecorationLine: 'line-through', color: colors.textMuted },
  timeSlot: { fontSize: FontSize.xs, color: colors.primary[600], marginTop: 2, fontWeight: '500' },
  taskActions: { flexDirection: 'column', gap: 6, alignItems: 'center' },
  insightBtn: { padding: 6 },
  insightBtnText: { fontSize: 16 },
  insightViewBtn: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: isDark ? 'rgba(34,197,94,0.16)' : '#ecfdf5', borderRadius: BorderRadius.md, ...(isDark ? { borderWidth: 1, borderColor: '#22C55E' } : null) },
  insightViewBtnText: { fontSize: 12, color: isDark ? '#4ADE80' : '#059669', fontWeight: '600' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 14 },

  // Insight box
  insightBox: { marginTop: Spacing.md, backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : '#f0fdf4', borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: isDark ? '#22C55E' : '#bbf7d0', ...(isDark ? { shadowColor: '#22C55E', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) },
  insightHeader: { fontSize: FontSize.sm, fontWeight: '600', color: isDark ? '#86EFAC' : '#065f46', marginBottom: 8 },

  // Add section
  addSection: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  addTimeInput: { width: 100, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.sm, fontSize: FontSize.sm, color: colors.text, ...neonSoft(colors, isDark) },
  addTaskInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: BorderRadius.md, padding: Spacing.sm, fontSize: FontSize.sm, color: colors.text, ...neonSoft(colors, isDark) },
  addBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, backgroundColor: colors.primary[500], justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: '#ffffff', fontSize: FontSize.xl, fontWeight: '700' },
})
