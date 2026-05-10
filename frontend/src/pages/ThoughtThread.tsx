import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Send, Sparkles, User, CheckCircle, Archive, RotateCcw, Columns, List, Download, FileText, Reply, MessageSquare, Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { thoughtsApi } from '../api/thoughts'
import { personasApi } from '../api/personas'
import { orchestrationApi, type StreamEvent } from '../api/orchestration'
import { useThoughtStore } from '../store/thoughtStore'
import CollapsibleMarkdown from '../components/CollapsibleMarkdown'
import { toast } from '../components/Toast'
import { confirm } from '../components/ConfirmModal'
import type { Persona } from '../store/personaStore'

function ThinkingBlock({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 transition-colors"
      >
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3" />
        <span>Thinking{!isOpen ? ` (${content.length} chars)` : '...'}</span>
      </button>
      {isOpen && (
        <div className="mt-1.5 pl-5 text-xs text-purple-700/70 leading-relaxed max-h-48 overflow-y-auto border-l-2 border-purple-200 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}

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

export default function ThoughtThread() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { currentThought, setCurrentThought } = useThoughtStore()
  const [isLoading, setIsLoading] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([])
  const [continueText, setContinueText] = useState('')
  const [isContinuing, setIsContinuing] = useState(false)
  const [viewMode, setViewMode] = useState<'thread' | 'compare'>('thread')
  const [replyingTo, setReplyingTo] = useState<{ personaId: string; personaName: string } | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  // Per-persona inline reply state (for comparison view)
  const [inlineReplyTexts, setInlineReplyTexts] = useState<Record<string, string>>({})
  const [inlineReplyLoading, setInlineReplyLoading] = useState<Record<string, boolean>>({})
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({})
  const [personaSectionCollapsed, setPersonaSectionCollapsed] = useState(false)
  // Reply All state
  const [replyAllText, setReplyAllText] = useState('')
  const [replyAllLoading, setReplyAllLoading] = useState(false)
  // Streaming reply state: { personaId -> partial text }
  const [streamingReply, setStreamingReply] = useState<Record<string, string>>({})
  // Streaming thinking state: { personaId -> thinking text }
  const [streamingThinking, setStreamingThinking] = useState<Record<string, string>>({})

  useEffect(() => {
    if (id) {
      loadThought()
      loadPersonas()
    }
  }, [id])

  const loadThought = async () => {
    try {
      const data = await thoughtsApi.getById(id!)
      setCurrentThought(data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load thought')
    } finally {
      setIsLoading(false)
    }
  }

  const loadPersonas = async () => {
    try {
      const data = await personasApi.getActive()
      setPersonas(data)
    } catch (err) {
      console.error('Failed to load personas:', err)
    }
  }

  const handleAnalyze = async () => {
    if (selectedPersonas.length === 0) return

    setIsAnalyzing(true)
    setError('')

    try {
      await orchestrationApi.analyzeThought(id!, selectedPersonas)
      await loadThought()
      setSelectedPersonas([])
      toast.success('Analysis complete', `${selectedPersonas.length} persona(s) responded.`)
    } catch (err: any) {
      toast.error('Analysis failed', err.response?.data?.message || 'Failed to analyze thought')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!continueText.trim()) return

    setIsContinuing(true)
    setError('')

    try {
      const threadId = currentThought?.threads[0]?.id
      if (threadId) {
        await thoughtsApi.continueThread(threadId, continueText)
        setContinueText('')

        // Auto-trigger persona analysis with previously used personas
        const previousPersonaIds = [...new Set(
          (currentThought?.threads[0]?.runs || []).map((r) => r.personaId)
        )]
        // Use selected personas if any, otherwise use previously run personas
        const personaIdsToRun = selectedPersonas.length > 0 ? selectedPersonas : previousPersonaIds

        if (personaIdsToRun.length > 0) {
          setIsAnalyzing(true)
          toast.info('Analyzing...', `Re-running ${personaIdsToRun.length} persona(s) on your follow-up.`)
          await orchestrationApi.analyzeThought(id!, personaIdsToRun)
          setSelectedPersonas([])
          toast.success('Analysis complete', `${personaIdsToRun.length} persona(s) responded to your follow-up.`)
          setIsAnalyzing(false)
        } else {
          toast.success('Message sent', 'Your follow-up has been added. Select personas above to analyze.')
        }
        await loadThought()
      }
    } catch (err: any) {
      toast.error('Send failed', err.response?.data?.message || 'Failed to continue thread')
      setIsAnalyzing(false)
    } finally {
      setIsContinuing(false)
    }
  }

  const togglePersona = (personaId: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(personaId)
        ? prev.filter((id) => id !== personaId)
        : [...prev, personaId]
    )
  }

  const handleReplyToPersona = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!replyText.trim() || !replyingTo) return

    setIsReplying(true)
    const personaId = replyingTo.personaId
    const personaName = replyingTo.personaName
    setStreamingReply((prev) => ({ ...prev, [personaId]: '' }))
    setStreamingThinking((prev) => ({ ...prev, [personaId]: '' }))
    try {
      await orchestrationApi.replyToPersonaStream(id!, personaId, replyText, (event: StreamEvent) => {
        if (event.event === 'thinking_delta') {
          setStreamingThinking((prev) => ({ ...prev, [personaId]: (prev[personaId] || '') + event.data.chunk }))
        } else if (event.event === 'token') {
          setStreamingReply((prev) => ({ ...prev, [personaId]: (prev[personaId] || '') + event.data.chunk }))
        } else if (event.event === 'response') {
          setStreamingReply((prev) => ({ ...prev, [personaId]: event.data.text }))
        }
      })
      setReplyText('')
      setReplyingTo(null)
      setStreamingReply((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      setStreamingThinking((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      await loadThought()
      toast.success('Reply received', `${personaName} responded to your follow-up.`)
    } catch (err: any) {
      toast.error('Reply failed', err.response?.data?.message || 'Failed to get persona reply')
      setStreamingReply((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      setStreamingThinking((prev) => { const n = { ...prev }; delete n[personaId]; return n })
    } finally {
      setIsReplying(false)
    }
  }

  const handleInlineReply = async (personaId: string, personaName: string) => {
    const text = inlineReplyTexts[personaId]?.trim()
    if (!text) return

    setInlineReplyLoading((prev) => ({ ...prev, [personaId]: true }))
    setStreamingReply((prev) => ({ ...prev, [personaId]: '' }))
    setStreamingThinking((prev) => ({ ...prev, [personaId]: '' }))
    try {
      await orchestrationApi.replyToPersonaStream(id!, personaId, text, (event: StreamEvent) => {
        if (event.event === 'thinking_delta') {
          setStreamingThinking((prev) => ({ ...prev, [personaId]: (prev[personaId] || '') + event.data.chunk }))
        } else if (event.event === 'token') {
          setStreamingReply((prev) => ({ ...prev, [personaId]: (prev[personaId] || '') + event.data.chunk }))
        } else if (event.event === 'response') {
          setStreamingReply((prev) => ({ ...prev, [personaId]: event.data.text }))
        }
      })
      setInlineReplyTexts((prev) => ({ ...prev, [personaId]: '' }))
      setStreamingReply((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      setStreamingThinking((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      await loadThought()
      toast.success('Reply received', `${personaName} responded.`)
    } catch (err: any) {
      toast.error('Reply failed', err.response?.data?.message || 'Failed to get persona reply')
      setStreamingReply((prev) => { const n = { ...prev }; delete n[personaId]; return n })
      setStreamingThinking((prev) => { const n = { ...prev }; delete n[personaId]; return n })
    } finally {
      setInlineReplyLoading((prev) => ({ ...prev, [personaId]: false }))
    }
  }

  const handleReplyAll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!replyAllText.trim() || personaGroups.length === 0) return

    setReplyAllLoading(true)
    const text = replyAllText.trim()
    setReplyAllText('')
    const loadingMap: Record<string, boolean> = {}
    personaGroups.forEach((g) => { loadingMap[g.personaId] = true })
    setInlineReplyLoading((prev) => ({ ...prev, ...loadingMap }))

    try {
      // Fire all persona replies in parallel
      const results = await Promise.allSettled(
        personaGroups.map((g) => orchestrationApi.replyToPersona(id!, g.personaId, text))
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length
      await loadThought()
      if (failed === 0) {
        toast.success('All replied', `${succeeded} persona(s) responded to your message.`)
      } else {
        toast.warning('Partial success', `${succeeded} replied, ${failed} failed.`)
      }
    } catch (err: any) {
      toast.error('Reply All failed', err.response?.data?.message || 'Failed to send replies')
    } finally {
      setReplyAllLoading(false)
      setInlineReplyLoading({})
    }
  }

  const toggleCardCollapse = (id: string) => {
    setCollapsedCards((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleStatusChange = async (newStatus: string) => {
    const labels: Record<string, string> = { resolved: 'Resolve', archived: 'Archive', open: 'Reopen' }
    const confirmed = await confirm({
      title: `${labels[newStatus]} this thought?`,
      message: newStatus === 'archived'
        ? 'Archived thoughts will be hidden from your active view.'
        : newStatus === 'resolved'
        ? 'Mark this thought as resolved. You can always reopen it later.'
        : 'Reopen this thought for further analysis.',
      confirmLabel: labels[newStatus],
      variant: newStatus === 'archived' ? 'warning' : 'default',
    })
    if (!confirmed) return

    try {
      await thoughtsApi.update(id!, { status: newStatus })
      await loadThought()
      toast.success('Status updated', `Thought marked as ${newStatus}.`)
    } catch (err: any) {
      toast.error('Update failed', err.response?.data?.message || 'Failed to update status')
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const exportAsMarkdown = () => {
    if (!currentThought) return
    const lines: string[] = []
    lines.push(`# ${currentThought.title}`)
    lines.push(`**Type:** ${thoughtTypeLabels[currentThought.thoughtType] || currentThought.thoughtType}`)
    lines.push(`**Status:** ${currentThought.status}`)
    lines.push(`**Created:** ${formatDate(currentThought.createdAt)}`)
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('## Original Thought')
    lines.push(currentThought.rawText)
    lines.push('')

    const thread = currentThought.threads[0]
    if (thread?.summary) {
      lines.push('## Summary')
      lines.push(thread.summary.runningSummary)
      lines.push('')
    }

    lines.push('## Conversation')
    lines.push('')
    const msgs = thread?.messages || []
    const rns = thread?.runs || []
    for (const msg of msgs) {
      if (msg.role === 'user') {
        lines.push(`### You (${formatDate(msg.createdAt)})`)
      } else {
        const run = msg.personaId ? rns.find((r) => r.personaId === msg.personaId) : undefined
        const name = run?.persona?.name || 'Assistant'
        lines.push(`### ${name} (${formatDate(msg.createdAt)})`)
      }
      lines.push(msg.content)
      lines.push('')
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentThought.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported', 'Markdown file downloaded.')
  }

  const exportAsPDF = () => {
    window.print()
    toast.info('Print dialog', 'Use "Save as PDF" in the print dialog.')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  if (!currentThought) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-600">Thought not found</p>
        <button
          onClick={() => navigate('/')}
          className="btn-primary mt-4"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  const thread = currentThought.threads[0]
  const messages = thread?.messages || []
  const runs = thread?.runs || []

  // Group messages by persona for comparison view (include directed user messages in each branch)
  const assistantMessages = messages.filter((m) => m.role === 'assistant')
  const personaIds = [...new Set(assistantMessages.map((m) => m.personaId).filter(Boolean))]
  const personaGroups = personaIds.map((pid) => {
    const run = runs.find((r) => r.personaId === pid)
    // Build full conversation branch: global user msgs + directed msgs + this persona's responses
    const branchMessages = messages.filter((m) => {
      if (m.role === 'user') return !m.personaId || m.personaId === pid
      return m.personaId === pid
    })
    return {
      personaId: pid!,
      personaName: run?.persona?.name || 'Unknown',
      messages: assistantMessages.filter((m) => m.personaId === pid),
      branchMessages,
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={exportAsMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Markdown
          </button>
          <button
            onClick={exportAsPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {/* Thought Header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">
                {currentThought.title}
              </h1>
              <span className="px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm font-medium">
                {thoughtTypeLabels[currentThought.thoughtType] ||
                  currentThought.thoughtType}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                currentThought.status === 'open'
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentThought.status === 'resolved'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {currentThought.status.charAt(0).toUpperCase() + currentThought.status.slice(1)}
              </span>
            </div>
            <p className="text-gray-700 whitespace-pre-wrap">
              {currentThought.rawText}
            </p>
            <div className="mt-4 text-sm text-gray-500">
              Created {formatDate(currentThought.createdAt)}
            </div>
          </div>

          {/* Status Transition Buttons */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            {currentThought.status === 'open' && (
              <button
                onClick={() => handleStatusChange('resolved')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Resolve
              </button>
            )}
            {currentThought.status === 'open' && (
              <button
                onClick={() => handleStatusChange('archived')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Archive className="w-4 h-4" />
                Archive
              </button>
            )}
            {currentThought.status === 'resolved' && (
              <button
                onClick={() => handleStatusChange('archived')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Archive className="w-4 h-4" />
                Archive
              </button>
            )}
            {(currentThought.status === 'resolved' || currentThought.status === 'archived') && (
              <button
                onClick={() => handleStatusChange('open')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reopen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Persona Selection */}
      <div className="card mb-6">
        <button
          type="button"
          onClick={() => setPersonaSectionCollapsed(!personaSectionCollapsed)}
          className="flex items-center gap-2 w-full text-left"
        >
          {personaSectionCollapsed ? (
            <ChevronRight className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
          <h2 className="text-lg font-semibold text-gray-900">
            Analyze with Personas
          </h2>
          {selectedPersonas.length > 0 && personaSectionCollapsed && (
            <span className="text-xs text-primary-600 font-medium">{selectedPersonas.length} selected</span>
          )}
        </button>
        {!personaSectionCollapsed && (
          <div className="mt-4 animate-fadeIn">
            {personas.length === 0 ? (
              <p className="text-gray-500">
                No active personas.{' '}
                <button
                  onClick={() => navigate('/personas')}
                  className="text-primary-600 hover:underline"
                >
                  Create personas
                </button>
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {personas.map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => togglePersona(persona.id)}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        selectedPersonas.includes(persona.id)
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900 text-sm">
                        {persona.name}
                      </div>
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={selectedPersonas.length === 0 || isAnalyzing}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Analyze with {selectedPersonas.length} persona
                      {selectedPersonas.length !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Thread Summary */}
      {thread?.summary && (
        <div className="card mb-6 bg-yellow-50 border-yellow-200">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">
            Thread Summary
          </h3>
          <div className="text-yellow-700 text-sm">
            <CollapsibleMarkdown content={thread.summary.runningSummary} />
          </div>
        </div>
      )}

      {/* View Toggle */}
      {assistantMessages.length > 1 && personaIds.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-medium text-gray-600">View:</span>
          <button
            onClick={() => setViewMode('thread')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'thread'
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <List className="w-4 h-4" />
            Thread
          </button>
          <button
            onClick={() => setViewMode('compare')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'compare'
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Columns className="w-4 h-4" />
            Compare
          </button>
        </div>
      )}

      {/* Conversation - Thread View */}
      {viewMode === 'thread' && (
      <div className="space-y-4 mb-6">
        {messages.map((message) => {
          const run = message.personaId
            ? runs.find((r) => r.personaId === message.personaId)
            : undefined

          return (
            <div
              key={message.id}
              className={`card ${
                message.role === 'user'
                  ? 'bg-white'
                  : message.modelName?.startsWith('core:')
                  ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300'
                  : 'bg-primary-50 border-primary-200'
              }`}
            >
              {/* Clickable header for assistant messages */}
              {message.role !== 'user' && (
                <button
                  type="button"
                  onClick={() => toggleCardCollapse(message.id)}
                  className="flex items-center gap-3 w-full text-left"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      message.modelName?.startsWith('core:')
                        ? 'bg-amber-200'
                        : 'bg-primary-100'
                    }`}
                  >
                    {message.modelName?.startsWith('core:') ? (
                      <Brain className="w-4 h-4 text-amber-700" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-primary-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {message.modelName?.startsWith('core:')
                        ? '4Ever Core'
                        : run?.persona?.name || 'Assistant'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(message.createdAt)}
                    </span>
                    {message.modelName && (
                      <span className="text-xs text-gray-400">
                        via {message.modelName}
                      </span>
                    )}
                  </div>
                  {collapsedCards[message.id] ? (
                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  )}
                </button>
              )}

              {/* User messages: always shown inline */}
              {message.role === 'user' && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-200">
                    <User className="w-4 h-4 text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-gray-900">You</span>
                      <span className="text-xs text-gray-500">{formatDate(message.createdAt)}</span>
                    </div>
                    <div className="text-gray-700 whitespace-pre-wrap">
                      {message.personaId && (
                        <span className="text-xs font-medium text-primary-600 mb-1 block">
                          <MessageSquare className="w-3 h-3 inline mr-1" />
                          Replying to {run?.persona?.name || runs.find(r => r.personaId === message.personaId)?.persona?.name || 'persona'}
                        </span>
                      )}
                      {message.content}
                    </div>
                  </div>
                </div>
              )}

              {/* Collapsible assistant content */}
              {message.role !== 'user' && !collapsedCards[message.id] && (
                <div className="mt-3 pl-11 text-gray-700 animate-fadeIn">
                  {message.modelName?.startsWith('core:') ? (
                    <div>
                      <div className="text-xs font-medium text-amber-600 mb-2">Unified synthesis from all persona responses</div>
                      <CollapsibleMarkdown content={message.content} />
                    </div>
                  ) : (
                    <>
                      <CollapsibleMarkdown content={message.content} />
                      <div className="mt-3 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (replyingTo?.personaId === message.personaId) {
                              setReplyingTo(null)
                              setReplyText('')
                            } else {
                              setReplyingTo({ personaId: message.personaId!, personaName: run?.persona?.name || 'Assistant' })
                              setReplyText('')
                            }
                          }}
                          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                            replyingTo?.personaId === message.personaId
                              ? 'bg-primary-100 text-primary-700'
                              : 'text-gray-500 hover:text-primary-600 hover:bg-primary-50'
                          }`}
                        >
                          <Reply className="w-3.5 h-3.5" />
                          {replyingTo?.personaId === message.personaId ? 'Cancel' : 'Reply to ' + (run?.persona?.name || 'Assistant')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* Conversation - Comparison View */}
      {viewMode === 'compare' && (
        <div className="mb-6">
          {/* Reply All bar */}
          {personaGroups.length > 1 && (
            <div className="card mb-4 border-amber-200 bg-amber-50/50">
              <form onSubmit={handleReplyAll} className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-amber-700 flex-shrink-0">
                  <Send className="w-4 h-4" />
                  <span className="text-sm font-semibold whitespace-nowrap">Reply to All ({personaGroups.length})</span>
                </div>
                <input
                  type="text"
                  value={replyAllText}
                  onChange={(e) => setReplyAllText(e.target.value)}
                  placeholder="Type a message all personas will respond to individually..."
                  className="input flex-1 text-sm"
                />
                <button
                  type="submit"
                  disabled={!replyAllText.trim() || replyAllLoading}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 flex-shrink-0"
                >
                  {replyAllLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send All
                </button>
              </form>
              <p className="text-xs text-amber-600 mt-2">Each persona responds independently with their own perspective — same question, different answers.</p>
            </div>
          )}

          {/* Side-by-side persona columns with full conversation branches */}
          <div className={`grid gap-4 ${personaGroups.length === 2 ? 'grid-cols-2' : personaGroups.length >= 3 ? 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
            {personaGroups.map((group) => (
              <div key={group.personaId} className="card bg-white border-gray-200 flex flex-col">
                {/* Persona header */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-primary-100">
                    <Sparkles className="w-4 h-4 text-primary-600" />
                  </div>
                  <span className="font-semibold text-gray-900">{group.personaName}</span>
                  <span className="text-xs text-gray-400 ml-auto">{group.messages.length} response(s)</span>
                </div>

                {/* Conversation branch */}
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-1">
                  {group.branchMessages.map((message) => {
                    const isUser = message.role === 'user'
                    const isDirected = isUser && !!message.personaId
                    return (
                      <div key={message.id} className={`rounded-lg p-2.5 ${isUser ? 'bg-gray-50' : 'bg-primary-50'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {isUser ? (
                            <User className="w-3 h-3 text-gray-500" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-primary-500" />
                          )}
                          <span className="text-xs font-medium text-gray-600">
                            {isUser ? 'You' : group.personaName}
                          </span>
                          {isDirected && (
                            <span className="text-xs text-primary-500 font-medium">
                              (directed)
                            </span>
                          )}
                          <span className="text-xs text-gray-400 ml-auto">{formatDate(message.createdAt)}</span>
                        </div>
                        <div className="text-sm text-gray-700">
                          {isUser ? (
                            <span className="whitespace-pre-wrap">{message.content}</span>
                          ) : (
                            <CollapsibleMarkdown content={message.content} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Streaming reply preview */}
                {streamingReply[group.personaId] !== undefined && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="w-3 h-3 animate-spin text-primary-500" />
                      <span className="text-xs font-medium text-primary-600">{group.personaName} is typing...</span>
                    </div>
                    {streamingThinking[group.personaId] && (
                      <ThinkingBlock content={streamingThinking[group.personaId]} defaultOpen={!streamingReply[group.personaId]} />
                    )}
                    <div className="text-sm text-gray-700">
                      {streamingReply[group.personaId] ? (
                        <CollapsibleMarkdown content={streamingReply[group.personaId]} />
                      ) : !streamingThinking[group.personaId] ? (
                        <span className="text-gray-400 italic">Loading context...</span>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* Inline reply input */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleInlineReply(group.personaId, group.personaName)
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={inlineReplyTexts[group.personaId] || ''}
                      onChange={(e) =>
                        setInlineReplyTexts((prev) => ({ ...prev, [group.personaId]: e.target.value }))
                      }
                      placeholder={`Reply to ${group.personaName}...`}
                      className="input flex-1 text-sm py-1.5"
                      disabled={inlineReplyLoading[group.personaId]}
                    />
                    <button
                      type="submit"
                      disabled={!inlineReplyTexts[group.personaId]?.trim() || inlineReplyLoading[group.personaId]}
                      className="p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 transition-colors flex-shrink-0"
                    >
                      {inlineReplyLoading[group.personaId] ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>

          {/* Core Synthesis Card in comparison view */}
          {(() => {
            const coreMessages = messages.filter((m) => m.role === 'assistant' && m.modelName?.startsWith('core:'))
            if (coreMessages.length === 0) return null
            const latestCore = coreMessages[coreMessages.length - 1]
            return (
              <div className="card mt-4 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-200">
                    <Brain className="w-4 h-4 text-amber-700" />
                  </div>
                  <span className="font-semibold text-gray-900">4Ever Core</span>
                  <span className="text-xs text-amber-600 ml-auto">Unified Synthesis</span>
                </div>
                <div className="text-sm text-gray-700">
                  <CollapsibleMarkdown content={latestCore.content} />
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Per-Persona Reply Form */}
      {replyingTo && (
        <div className="card mb-4 border-primary-200 bg-primary-50/30">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-primary-800">
              Reply to {replyingTo.personaName}
            </h3>
            <span className="text-xs text-primary-500">Only this persona will see and respond to your message</span>
          </div>
          <form onSubmit={handleReplyToPersona} className="flex gap-3">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Ask ${replyingTo.personaName} a follow-up...`}
              className="input flex-1"
              autoFocus
            />
            <button
              type="submit"
              disabled={!replyText.trim() || isReplying}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isReplying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Reply className="w-4 h-4" />
                  Reply
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setReplyingTo(null); setReplyText('') }}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </form>

          {/* Streaming reply preview (thread view) */}
          {streamingReply[replyingTo.personaId] !== undefined && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 className="w-3 h-3 animate-spin text-primary-500" />
                <span className="text-xs font-medium text-primary-600">{replyingTo.personaName} is typing...</span>
              </div>
              {streamingThinking[replyingTo.personaId] && (
                <ThinkingBlock content={streamingThinking[replyingTo.personaId]} defaultOpen={!streamingReply[replyingTo.personaId]} />
              )}
              <div className="text-sm text-gray-700">
                {streamingReply[replyingTo.personaId] ? (
                  <CollapsibleMarkdown content={streamingReply[replyingTo.personaId]} />
                ) : !streamingThinking[replyingTo.personaId] ? (
                  <span className="text-gray-400 italic">Loading context...</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Continue Thread */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          Continue the conversation
        </h3>
        <form onSubmit={handleContinue} className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={continueText}
              onChange={(e) => setContinueText(e.target.value)}
              placeholder="Add your response or follow-up question..."
              className="input flex-1"
            />
            <button
              type="submit"
              disabled={!continueText.trim() || isContinuing || isAnalyzing}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isContinuing || isAnalyzing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send
                </>
              )}
            </button>
          </div>
          {runs.length > 0 && (
            <p className="text-xs text-gray-400">
              Personas that previously responded will auto-analyze your follow-up, or select specific ones above.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
