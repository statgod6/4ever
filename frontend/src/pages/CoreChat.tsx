import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Send, Loader2, Trash2, Check, Zap, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { toast } from '../components/Toast'
import { orchestrationApi, StreamEvent } from '../api/orchestration'
import CollapsibleMarkdown from '../components/CollapsibleMarkdown'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  createdAt?: string
}

interface ToolActivity {
  tool: string
  input?: any
  done: boolean
}
// Split assistant content into regular text and persona analysis blocks
function splitPersonaSections(content: string): Array<{ type: 'text' | 'persona'; personaName?: string; thoughtTitle?: string; body: string }> {
  if (!content || typeof content !== 'string') return [{ type: 'text', body: '' }]
  const regex = /## (.+?)'s Analysis of "(.+?)"\n/g
  const parts: Array<{ type: 'text' | 'persona'; personaName?: string; thoughtTitle?: string; body: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    // Text before this persona block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim()
      if (text) parts.push({ type: 'text', body: text })
    }
    // Find the end of the persona block (next ## or end of content)
    const blockStart = match.index + match[0].length
    const nextHeader = content.indexOf('\n## ', blockStart)
    const blockEnd = nextHeader !== -1 ? nextHeader : content.length
    const body = content.slice(blockStart, blockEnd).replace(/---\n_This analysis has been saved.*$/s, '').trim()
    parts.push({ type: 'persona', personaName: match[1], thoughtTitle: match[2], body })
    lastIndex = blockEnd
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim()
    if (text) parts.push({ type: 'text', body: text })
  }

  return parts.length > 0 ? parts : [{ type: 'text', body: content }]
}

function getToolLabel(tool: string, input?: any): string {
  const labels: Record<string, (input?: any) => string> = {
    weather: (i) => `Checking weather for ${i?.location || '...'}`,
    wikipedia: (i) => `Looking up ${i?.query || '...'} on Wikipedia`,
    web_search: (i) => `Searching the web for "${i?.query || '...'}"`,
    news_search: (i) => `Searching news about "${i?.query || '...'}"`,
    calculator: (i) => `Calculating ${i?.expression || '...'}`,
    url_reader: (i) => `Reading ${i?.url ? new URL(i.url).hostname : '...'}`,
    search_memories: () => 'Searching your memories',
    query_planner: () => 'Checking your planner',
    create_action: () => 'Creating an action item',
    create_thought: () => 'Saving a thought',
    create_checkin: () => 'Logging a check-in',
    trigger_persona_analysis: () => 'Consulting personas',
    update_user_context: () => 'Updating your context',
  }
  const labelFn = labels[tool]
  return labelFn ? labelFn(input) : `Using ${tool}`
}

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

export default function CoreChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [thinkingStatus, setThinkingStatus] = useState<string>('')
  const [currentThinking, setCurrentThinking] = useState<string>('')
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Tracks whether the user is "pinned" near the bottom of the scroll.
  // When they scroll up to read, we stop auto-scrolling on new tokens.
  const pinnedToBottomRef = useRef(true)

  useEffect(() => {
    if (pinnedToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, toolActivities])

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      const result = await orchestrationApi.getCoreChatHistory(30)
      setMessages(result.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.createdAt })))
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setSessionStartedAt(result.sessionStartedAt)
    } catch {
      toast.error('Failed to load chat history')
    } finally {
      setIsLoadingHistory(false)
      inputRef.current?.focus()
    }
  }

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || !nextCursor) return
    setIsLoadingMore(true)
    const container = chatContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0
    try {
      const result = await orchestrationApi.getCoreChatHistory(30, nextCursor)
      const older = result.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.createdAt }))
      setMessages((prev) => [...older, ...prev])
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      // Preserve scroll position
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight
        }
      })
    } catch {
      toast.error('Failed to load older messages')
    } finally {
      setIsLoadingMore(false)
    }
  }, [hasMore, isLoadingMore, nextCursor])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    // Update pinned state — user near bottom = pinned
    const distanceFromBottom =
      target.scrollHeight - (target.scrollTop + target.clientHeight)
    pinnedToBottomRef.current = distanceFromBottom < 80
    if (target.scrollTop < 50 && hasMore && !isLoadingMore) {
      loadMore()
    }
  }, [hasMore, isLoadingMore, loadMore])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setIsLoading(true)
    setToolActivities([])
    setThinkingStatus('reasoning')
    setCurrentThinking('')
    // User just sent a message — force-pin to bottom for this response
    pinnedToBottomRef.current = true

    try {
      let streamingMsgAdded = false
      let thinkingText = ''
      await orchestrationApi.coreChatStream(userMsg, (event: StreamEvent) => {
        switch (event.event) {
          case 'thinking':
            setThinkingStatus(event.data.status || 'reasoning')
            break
          case 'thinking_delta':
            thinkingText += (event.data.chunk || event.data.text || '')
            setCurrentThinking(thinkingText)
            break
          case 'tool_start':
            setToolActivities((prev) => [
              ...prev,
              { tool: event.data.name || event.data.tool, input: event.data.args || event.data.input, done: false },
            ])
            break
          case 'tool_end':
            setToolActivities((prev) =>
              prev.map((t) =>
                (t.tool === (event.data.name || event.data.tool) && !t.done) ? { ...t, done: true } : t,
              ),
            )
            break
          case 'token':
            setThinkingStatus('')
            if (!streamingMsgAdded) {
              streamingMsgAdded = true
              setMessages((prev) => [...prev, { role: 'assistant', content: event.data.text || event.data.chunk || '', thinking: thinkingText || undefined }])
            } else {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: (last.content || '') + (event.data.text || event.data.chunk || '') }
                }
                return updated
              })
            }
            break
          case 'response':
            // Final text — replace streamed message with final version for accuracy
            if (streamingMsgAdded) {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: event.data.text, thinking: thinkingText || undefined }
                }
                return updated
              })
            } else {
              setMessages((prev) => [...prev, { role: 'assistant', content: event.data.text, thinking: thinkingText || undefined }])
            }
            break
          case 'done':
            break
        }
      })
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setIsLoading(false)
      setToolActivities([])
      setThinkingStatus('')
      setCurrentThinking('')
      inputRef.current?.focus()
    }
  }

  const clearChat = async () => {
    try {
      await orchestrationApi.clearCoreChatHistory()
    } catch {
      toast.error('Failed to clear history')
    }
    setMessages([])
    setSessionStartedAt(null)
    setHasMore(false)
    setNextCursor(null)
    inputRef.current?.focus()
  }

  const startNewSession = async () => {
    try {
      const result = await orchestrationApi.newCoreChatSession()
      setSessionStartedAt(result.sessionStartedAt)
      toast.success('New session started')
    } catch {
      toast.error('Failed to start new session')
    }
  }

  // Check if a message is the session boundary
  const isSessionBoundary = (msg: ChatMessage, prevMsg?: ChatMessage) => {
    if (!sessionStartedAt || !msg.createdAt || !prevMsg?.createdAt) return false
    const sessionTime = new Date(sessionStartedAt).getTime()
    const msgTime = new Date(msg.createdAt).getTime()
    const prevTime = new Date(prevMsg.createdAt).getTime()
    return prevTime < sessionTime && msgTime >= sessionTime
  }

  // Check if all messages are from before the session (no new messages sent yet)
  const showTrailingSessionDivider = sessionStartedAt && messages.length > 0 &&
    messages.every(m => !m.createdAt || new Date(m.createdAt).getTime() < new Date(sessionStartedAt).getTime())

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            4Ever Core
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Your personal intelligence layer — knows your context, memories, patterns, and goals.
          </p>
        </div>
        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={startNewSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Session
            </button>
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div ref={chatContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-200 bg-white flex flex-col">
        {isLoadingHistory ? (
          <div className="flex flex-col items-center justify-center flex-1">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            <p className="text-sm text-gray-400 mt-2">Loading conversation...</p>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-4">
              <Brain className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Chat with your Core</h2>
            <p className="text-gray-500 text-sm max-w-md mb-6">
              I know everything about you — your goals, situation, patterns, and history. 
              Ask me anything and I'll give you direct, personalized advice.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                'What should I focus on today?',
                'How am I doing this week?',
                'What are my pending decisions?',
                'Give me honest feedback on my patterns',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion)
                    inputRef.current?.focus()
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full hover:bg-amber-100 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-end p-4">
            <div className="space-y-4">
            {/* Load more spinner */}
            {isLoadingMore && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span className="text-xs text-gray-400 ml-2">Loading older messages...</span>
              </div>
            )}
            {hasMore && !isLoadingMore && (
              <button onClick={loadMore} className="text-xs text-amber-600 hover:text-amber-700 text-center w-full py-2">
                Load older messages
              </button>
            )}

            {messages.map((msg, i) => (
              <React.Fragment key={i}>
                {/* Session divider */}
                {isSessionBoundary(msg, messages[i - 1]) && (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-amber-200" />
                    <span className="text-xs font-medium text-amber-500 whitespace-nowrap">New Session</span>
                    <div className="flex-1 h-px bg-amber-200" />
                  </div>
                )}

                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-start gap-2.5 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        msg.role === 'user'
                          ? 'bg-primary-100'
                          : 'bg-gradient-to-br from-amber-400 to-orange-500'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <span className="text-xs font-bold text-primary-700">Y</span>
                      ) : (
                        <Brain className="w-3.5 h-3.5 text-white" />
                      )}
                    </div>
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-50 text-gray-800 border border-gray-100'
                      }`}
                    >
                      {msg.role === 'assistant' && msg.thinking && (
                        <ThinkingBlock content={msg.thinking} />
                      )}
                      {msg.role === 'assistant' ? (
                        (() => {
                          const sections = splitPersonaSections(msg.content)
                          const hasPersona = sections.some(s => s.type === 'persona')
                          if (!hasPersona) {
                            return <CollapsibleMarkdown content={msg.content} defaultCollapsed={i < messages.length - 1} />
                          }
                          return (
                            <div className="space-y-3">
                              {sections.map((section, si) =>
                                section.type === 'persona' ? (
                                  <div key={si} className="border-l-3 border-purple-400 bg-purple-50/50 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="text-xs font-semibold text-purple-700">{section.personaName}</span>
                                      <span className="text-xs text-purple-400">on</span>
                                      <span className="text-xs font-medium text-purple-600 italic">"{section.thoughtTitle}"</span>
                                    </div>
                                    <CollapsibleMarkdown content={section.body} defaultCollapsed={i < messages.length - 1} />
                                  </div>
                                ) : (
                                  <CollapsibleMarkdown key={si} content={section.body} defaultCollapsed={i < messages.length - 1} />
                                )
                              )}
                            </div>
                          )
                        })()
                      ) : (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            ))}

            {/* Session divider at end when no new messages yet */}
            {showTrailingSessionDivider && (
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-amber-200" />
                <span className="text-xs font-medium text-amber-500 whitespace-nowrap">New Session — your AI starts fresh from here</span>
                <div className="flex-1 h-px bg-amber-200" />
              </div>
            )}

            {/* Thinking / Tool Activity Indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                    <Brain className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 min-w-[200px]">
                    {/* Live thinking stream */}
                    {currentThinking && (
                      <ThinkingBlock content={currentThinking} defaultOpen={true} />
                    )}

                    {/* Thinking status */}
                    {toolActivities.length === 0 && !currentThinking && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                        <span className="animate-pulse">
                          {thinkingStatus === 'loading_context' ? 'Loading your context...' : 'Thinking...'}
                        </span>
                      </div>
                    )}

                    {/* Tool activity list */}
                    {toolActivities.length > 0 && (
                      <div className="space-y-1.5">
                        {toolActivities.map((activity, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 text-xs animate-fade-in"
                          >
                            {activity.done ? (
                              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                            ) : (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 shrink-0" />
                            )}
                            <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                            <span className={`font-mono ${activity.done ? 'text-gray-400' : 'text-gray-600'}`}>
                              {getToolLabel(activity.tool, activity.input)}
                            </span>
                          </div>
                        ))}
                        {/* Show "Composing response..." after all tools complete */}
                        {toolActivities.length > 0 && toolActivities.every((t) => t.done) && (
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                            <span className="animate-pulse">Composing response...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="mt-3 flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your Core anything..."
          className="input flex-1 text-sm"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 transition-all flex items-center gap-2 font-medium text-sm"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Send
        </button>
      </form>
    </div>
  )
}
