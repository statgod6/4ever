import { useRef, useEffect } from 'react'
import { MessageCircle, Trash2, X, Loader2, Send } from 'lucide-react'
import { orchestrationApi, StreamEvent } from '../../api/orchestration'
import { toast } from '../../components/Toast'
import Markdown from '../../components/Markdown'

interface Props {
  personaId: string
  personName: string
  chatMessages: Array<{ id: string; role: string; content: string; createdAt: string }>
  setChatMessages: React.Dispatch<React.SetStateAction<Array<{ id: string; role: string; content: string; createdAt: string }>>>
  chatInput: string
  setChatInput: React.Dispatch<React.SetStateAction<string>>
  chatStreaming: boolean
  setChatStreaming: React.Dispatch<React.SetStateAction<boolean>>
  chatStreamText: string
  setChatStreamText: React.Dispatch<React.SetStateAction<string>>
  chatLoading: boolean
  onClose: () => void
}

export default function PersonaChatModal({
  personaId, personName, chatMessages, setChatMessages,
  chatInput, setChatInput, chatStreaming, setChatStreaming,
  chatStreamText, setChatStreamText, chatLoading, onClose,
}: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chatInputRef.current?.focus()
  }, [])

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatStreaming) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatStreaming(true)
    setChatStreamText('')

    const tempUserMsg = { id: `temp-${Date.now()}`, role: 'user', content: msg, createdAt: new Date().toISOString() }
    setChatMessages((prev) => [...prev, tempUserMsg])
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    let fullText = ''
    try {
      await orchestrationApi.personaDirectChatStream(personaId, msg, (event: StreamEvent) => {
        if (event.event === 'token') {
          fullText += event.data.chunk
          setChatStreamText(fullText)
          chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        } else if (event.event === 'response') {
          fullText = event.data.text || fullText
        }
      })
      const assistantMsg = { id: `resp-${Date.now()}`, role: 'assistant', content: fullText, createdAt: new Date().toISOString() }
      setChatMessages((prev) => [...prev, assistantMsg])
    } catch (err: any) {
      toast.error('Chat failed', err.message || 'Could not get response')
    } finally {
      setChatStreaming(false)
      setChatStreamText('')
    }
  }

  const clearChat = async () => {
    try {
      await orchestrationApi.clearPersonaChatHistory(personaId)
      setChatMessages([])
      toast.success('Chat cleared', 'Conversation history has been cleared.')
    } catch {
      toast.error('Failed', 'Could not clear chat history.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Chat Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-gray-900">{personName}</h3>
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full text-xs">AI Persona</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={clearChat} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Clear chat history">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: '300px' }}>
          {chatLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            </div>
          ) : chatMessages.length === 0 && !chatStreaming ? (
            <div className="text-center py-12">
              <MessageCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Start a conversation with {personName}'s AI persona</p>
              <p className="text-gray-400 text-xs mt-1">They'll respond based on their personality and your relationship context</p>
            </div>
          ) : (
            <>
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-900 rounded-bl-md'
                  }`}>
                    {msg.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="text-sm prose prose-sm max-w-none">
                        <Markdown content={msg.content} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatStreaming && chatStreamText && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-gray-100 text-gray-900 rounded-bl-md">
                    <div className="text-sm prose prose-sm max-w-none">
                      <Markdown content={chatStreamText} />
                    </div>
                  </div>
                </div>
              )}
              {chatStreaming && !chatStreamText && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendChatMessage()
                }
              }}
              placeholder={`Message ${personName}...`}
              className="input flex-1 py-2.5 text-sm"
              disabled={chatStreaming}
            />
            <button
              onClick={sendChatMessage}
              disabled={!chatInput.trim() || chatStreaming}
              className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl disabled:opacity-50 hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
            >
              {chatStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
