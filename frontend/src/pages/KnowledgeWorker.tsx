import { useEffect, useRef, useState } from 'react'
import { Briefcase, Send, Sparkles, Loader2, Lock, Hammer, Paperclip, FileText, X, Plus, Clock, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { knowledgeWorkerApi, KwStreamEvent, KwDocument, KwConversation } from '../api/knowledge-worker'
import { toast } from '../components/Toast'

interface UiMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ToolActivity {
  tool: string
  done: boolean
}

/**
 * Knowledge Worker — premium-only screen.
 * Renders a paywall for free users and a chat interface for premium users.
 *
 * This is the Phase 1 scaffold. Tools (python_analyst, web_search, read_document)
 * are wired in follow-up sessions; for now the agent replies with plain text.
 */
export default function KnowledgeWorker() {
  const { tier, active, loaded, loading, load } = useSubscriptionStore()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [tools, setTools] = useState<ToolActivity[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [documents, setDocuments] = useState<KwDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [conversations, setConversations] = useState<KwConversation[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingConvo, setLoadingConvo] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  const refreshDocs = async () => {
    try {
      const docs = await knowledgeWorkerApi.listDocuments()
      setDocuments(docs)
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    if (loaded && active && tier === 'premium') refreshDocs()
  }, [loaded, active, tier])

  const refreshConversations = async () => {
    try {
      const list = await knowledgeWorkerApi.listConversations()
      setConversations(list)
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    if (loaded && active && tier === 'premium') refreshConversations()
  }, [loaded, active, tier])

  const handleNewChat = () => {
    if (streaming) return
    setConversationId(undefined)
    setMessages([])
    setStreamingText('')
    setTools([])
    setInput('')
    setShowHistory(false)
  }

  const handleLoadConversation = async (convoId: string) => {
    if (streaming) return
    setLoadingConvo(true)
    try {
      const msgs = await knowledgeWorkerApi.getMessages(convoId)
      const mapped: UiMessage[] = msgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      setMessages(mapped)
      setConversationId(convoId)
      setStreamingText('')
      setTools([])
      setShowHistory(false)
    } catch (err: any) {
      toast.error('Could not open chat', err?.message || 'Unknown error')
    } finally {
      setLoadingConvo(false)
    }
  }

  const handleDeleteConversation = async (convo: KwConversation) => {
    if (!confirm(`Delete "${convo.title || 'Untitled chat'}"? This cannot be undone.`)) return
    try {
      await knowledgeWorkerApi.deleteConversation(convo.id)
      if (conversationId === convo.id) {
        setConversationId(undefined)
        setMessages([])
      }
      await refreshConversations()
    } catch (err: any) {
      toast.error('Delete failed', err?.message || 'Unknown error')
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large', 'Maximum size is 25 MB.')
      return
    }
    setUploading(true)
    try {
      const uploaded = await knowledgeWorkerApi.uploadDocument(file)
      await refreshDocs()
      setShowDocs(true)
      toast.success('Uploaded', `"${uploaded.filename}" indexed (${uploaded.chunks} chunks).`)
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || err?.message || 'Unknown error')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteDoc = async (doc: KwDocument) => {
    if (!confirm(`Remove "${doc.filename}" from Knowledge Worker?`)) return
    try {
      await knowledgeWorkerApi.deleteDocument(doc.id)
      await refreshDocs()
    } catch (err: any) {
      toast.error('Delete failed', err?.message || 'Unknown error')
    }
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

  if (!loaded || loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading workspace…
      </div>
    )
  }

  // Knowledge Worker is available to all users; premium-specific pricing strategy applies elsewhere.
  // (Paywall intentionally not shown here.)


  const handleSend = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setStreaming(true)
    setStreamingText('')
    setTools([])

    let finalText = ''
    try {
      await knowledgeWorkerApi.stream(text, conversationId, (evt: KwStreamEvent) => {
        switch (evt.event) {
          case 'conversation':
            if (evt.data?.conversationId) setConversationId(evt.data.conversationId)
            break
          case 'tool_start':
            setTools((t) => [...t, { tool: evt.data?.tool || 'tool', done: false }])
            break
          case 'tool_end':
            setTools((t) =>
              t.map((x, i, arr) =>
                i === arr.length - 1 && x.tool === (evt.data?.tool || x.tool) ? { ...x, done: true } : x,
              ),
            )
            break
          case 'token':
            if (evt.data?.chunk) {
              setStreamingText((s) => s + evt.data.chunk)
            }
            break
          case 'token_reset':
            setStreamingText('')
            break
          case 'response':
            finalText = evt.data?.text || ''
            if (evt.data?.conversationId) setConversationId(evt.data.conversationId)
            break
          case 'done':
            break
        }
      })
      if (finalText) {
        setMessages((m) => [...m, { role: 'assistant', content: finalText }])
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: "(no response)" }])
      }
      refreshConversations()
    } catch (e: any) {
      toast.error('Knowledge Worker failed', e?.message || 'Please try again.')
      setMessages((m) => [...m, { role: 'assistant', content: "Sorry, something went wrong." }])
    } finally {
      setStreaming(false)
      setStreamingText('')
      setTools([])
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <Briefcase className="w-6 h-6 text-indigo-600" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Knowledge Worker</h1>
          <p className="text-sm text-gray-500">
            Your premium research &amp; analysis assistant.
          </p>
        </div>
        <button
          onClick={handleNewChat}
          disabled={streaming}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Start a new chat"
        >
          <Plus className="w-4 h-4" />
          New chat
        </button>
        <button
          onClick={() => {
            refreshConversations()
            setShowHistory(true)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          title="View past chats"
        >
          <Clock className="w-4 h-4" />
          History{conversations.length > 0 ? ` (${conversations.length})` : ''}
        </button>
      </div>

      {/* History sidebar overlay */}
      {showHistory && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Your chats</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-gray-200">
              <button
                onClick={handleNewChat}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                Start a new chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingConvo && (
                <div className="px-5 py-3 flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}
              {conversations.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">
                  No past chats yet.
                </div>
              ) : (
                <ul>
                  {conversations.map((c) => {
                    const active = c.id === conversationId
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center gap-2 px-5 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${active ? 'bg-indigo-50' : ''}`}
                        onClick={() => handleLoadConversation(c.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {c.title || 'Untitled chat'}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {new Date(c.updatedAt).toLocaleDateString()} ·{' '}
                            {new Date(c.updatedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteConversation(c)
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                          title="Delete chat"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50">
        {documents.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg">
            <button
              onClick={() => setShowDocs((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <FileText className="w-4 h-4 text-indigo-600" />
              {documents.length} document{documents.length === 1 ? '' : 's'} indexed
              <span className="ml-auto text-xs text-gray-500">{showDocs ? 'Hide' : 'Show'}</span>
            </button>
            {showDocs && (
              <div className="px-3 pb-3 pt-1 space-y-1 border-t border-gray-200">
                {documents.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="truncate flex-1">• {d.filename}</span>
                    <span className="text-xs text-gray-400">{Math.round(d.sizeBytes / 1024)} KB</span>
                    <button
                      onClick={() => handleDeleteDoc(d)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="Delete"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.length === 0 && !streaming && (
          <div className="max-w-xl mx-auto text-center text-gray-500 pt-16">
            <Sparkles className="w-10 h-10 mx-auto mb-4 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-800">Ready when you are.</h2>
            <p className="text-sm mt-2">
              Ask a question, draft a plan, or paste content you want analyzed.
              Full tooling (Python analysis, document RAG, deep research) rolls out shortly.
            </p>
          </div>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[75%] rounded-2xl rounded-br-none bg-indigo-600 text-white px-4 py-2.5 shadow-sm'
                  : 'max-w-[92%] lg:max-w-[80%] rounded-2xl rounded-bl-none bg-white border border-gray-200 text-gray-900 px-5 py-3.5 shadow-sm'
              }
            >
              {m.role === 'user' ? (
                <span className="whitespace-pre-wrap">{m.content}</span>
              ) : (
                <div className="kw-markdown text-[15px] leading-relaxed text-gray-900">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ node, ...props }) => (
                        <h1 className="text-xl font-bold text-gray-900 mt-4 mb-2 first:mt-0" {...props} />
                      ),
                      h2: ({ node, ...props }) => (
                        <h2 className="text-lg font-bold text-gray-900 mt-4 mb-2 first:mt-0" {...props} />
                      ),
                      h3: ({ node, ...props }) => (
                        <h3 className="text-base font-semibold text-gray-900 mt-3 mb-1.5 first:mt-0" {...props} />
                      ),
                      h4: ({ node, ...props }) => (
                        <h4 className="text-sm font-semibold text-gray-800 mt-3 mb-1 first:mt-0" {...props} />
                      ),
                      p: ({ node, ...props }) => (
                        <p className="my-2 first:mt-0 last:mb-0 whitespace-pre-wrap" {...props} />
                      ),
                      ul: ({ node, ...props }) => (
                        <ul className="list-disc pl-6 my-2 space-y-1" {...props} />
                      ),
                      ol: ({ node, ...props }) => (
                        <ol className="list-decimal pl-6 my-2 space-y-1" {...props} />
                      ),
                      li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                      blockquote: ({ node, ...props }) => (
                        <blockquote
                          className="border-l-4 border-indigo-300 bg-indigo-50/60 pl-4 pr-3 py-2 my-3 text-gray-700 italic rounded-r"
                          {...props}
                        />
                      ),
                      hr: () => <hr className="my-4 border-gray-200" />,
                      strong: ({ node, ...props }) => (
                        <strong className="font-semibold text-gray-900" {...props} />
                      ),
                      em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
                      table: ({ node, ...props }) => (
                        <div className="my-3 overflow-x-auto">
                          <table
                            className="min-w-full text-sm border border-gray-200 rounded-md"
                            {...props}
                          />
                        </div>
                      ),
                      thead: ({ node, ...props }) => <thead className="bg-gray-100" {...props} />,
                      th: ({ node, ...props }) => (
                        <th
                          className="px-3 py-2 text-left font-semibold text-gray-800 border-b border-gray-200"
                          {...props}
                        />
                      ),
                      td: ({ node, ...props }) => (
                        <td className="px-3 py-2 border-b border-gray-100 text-gray-700" {...props} />
                      ),
                      img: ({ node, ...props }) => (
                        <img
                          {...props}
                          className="my-3 max-w-full rounded-lg border border-gray-200 shadow-sm"
                          loading="lazy"
                        />
                      ),
                      a: ({ node, ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                        />
                      ),
                      pre: ({ node, ...props }) => (
                        <pre
                          className="my-3 overflow-x-auto rounded-lg bg-gray-900 text-gray-100 p-3 text-xs leading-relaxed"
                          {...props}
                        />
                      ),
                      code: ({ node, className, children, ...props }: any) => {
                        const isInline = !className || !/language-/.test(className)
                        if (isInline) {
                          return (
                            <code
                              className="bg-gray-200 text-indigo-700 px-1.5 py-0.5 rounded text-[0.85em] font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          )
                        }
                        return (
                          <code className={`${className} font-mono`} {...props}>
                            {children}
                          </code>
                        )
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[92%] lg:max-w-[80%] rounded-2xl rounded-bl-none bg-white border border-gray-200 text-gray-900 px-5 py-3.5 shadow-sm whitespace-pre-wrap">
              {tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {tools.map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full"
                    >
                      <Hammer className="w-3 h-3" />
                      {t.tool}
                      {!t.done && <Loader2 className="w-3 h-3 animate-spin" />}
                    </span>
                  ))}
                </div>
              )}
              {streamingText ? (
                <div className="kw-markdown text-[15px] leading-relaxed text-gray-900">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ node, ...props }) => (
                        <img
                          {...props}
                          className="my-3 max-w-full rounded-lg border border-gray-200 shadow-sm"
                          loading="lazy"
                        />
                      ),
                      a: ({ node, ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                        />
                      ),
                      p: ({ node, ...props }) => (
                        <p className="my-1 first:mt-0 last:mb-0 whitespace-pre-wrap" {...props} />
                      ),
                    }}
                  >
                    {streamingText}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="text-gray-400 italic">Thinking…</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 px-6 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
          className="hidden"
          onChange={handleUpload}
        />
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || streaming}
            title="Attach document (PDF, DOCX, XLSX, CSV, TXT)"
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            placeholder="Ask a question or attach a document…"
            disabled={streaming}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function Paywall() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Knowledge Worker</h1>
        <p className="text-sm text-gray-600 mb-6">
          Unlock a premium research &amp; analysis assistant with Python data analysis,
          deep web research, document Q&amp;A, and document generation.
        </p>
        <ul className="text-sm text-left text-gray-700 space-y-1.5 mb-6">
          <li>• Python data analysis with charts</li>
          <li>• Upload &amp; query PDFs, DOCX, spreadsheets</li>
          <li>• Multi-hop deep research with citations</li>
          <li>• Generate PDF &amp; DOCX reports</li>
        </ul>
        <button
          disabled
          className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold opacity-60 cursor-not-allowed"
          title="Upgrade flow lands in Phase 5"
        >
          Upgrade (coming soon)
        </button>
      </div>
    </div>
  )
}
