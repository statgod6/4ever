import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { 
  Brain, 
  Plus, 
  Users, 
  LogOut, 
  Menu, 
  X,
  Focus,
  MessageCircle,
  Send,
  Loader2,
  Sparkles,
  PlusCircle,
  Library,
  UserCircle,
  TrendingUp,
  CalendarDays,
  CheckSquare,
  Heart,
  Sparkles as SparklesIcon,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Briefcase,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { thoughtsApi } from '../api/thoughts'
import { personasApi } from '../api/personas'
import { orchestrationApi } from '../api/orchestration'
import { useThoughtStore } from '../store/thoughtStore'
import { toast } from './Toast'
import Markdown from './Markdown'
import { useMessagingStore } from '../store/messagingStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { connectSocket, disconnectSocket } from '../api/socket'
import type { Persona } from '../store/personaStore'

interface LayoutProps {
  children: React.ReactNode
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function Layout({ children }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const [focusMode, setFocusMode] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { logout, user } = useAuthStore()
  const { addThought } = useThoughtStore()

  // Focus Mode state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [focusPersonas, setFocusPersonas] = useState<Persona[]>([])
  const [selectedChatPersona, setSelectedChatPersona] = useState<string>('')
  const [quickTitle, setQuickTitle] = useState('')
  const [quickText, setQuickText] = useState('')
  const [isSavingQuick, setIsSavingQuick] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { totalUnread, loadUnreadCount } = useMessagingStore()
  const subTier = useSubscriptionStore((s) => s.tier)
  const subActive = useSubscriptionStore((s) => s.active)
  const subLoaded = useSubscriptionStore((s) => s.loaded)
  const loadSubscription = useSubscriptionStore((s) => s.load)

  // Connect socket & load unread count
  useEffect(() => {
    connectSocket()
    loadUnreadCount()
    if (!subLoaded) loadSubscription()
    const interval = setInterval(loadUnreadCount, 30000)
    return () => { clearInterval(interval); disconnectSocket() }
  }, [])

  useEffect(() => {
    if (focusMode) {
      personasApi.getActive().then(setFocusPersonas).catch(() => {})
    }
  }, [focusMode])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleChatSend = async () => {
    if (!chatInput.trim() || isChatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setIsChatLoading(true)

    try {
      const result = await orchestrationApi.quickChat(userMsg, selectedChatPersona || undefined)
      setChatMessages((prev) => [...prev, { role: 'assistant', content: result.response }])
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }])
    } finally {
      setIsChatLoading(false)
    }
  }

  const handleQuickCapture = async () => {
    if (!quickTitle.trim() || !quickText.trim()) return
    setIsSavingQuick(true)
    try {
      const thought = await thoughtsApi.create({
        title: quickTitle,
        rawText: quickText,
        thoughtType: 'general reflection',
      })
      addThought(thought)
      toast.success('Quick capture saved', 'Navigate to it from Dashboard.')
      setQuickTitle('')
      setQuickText('')
    } catch {
      toast.error('Save failed', 'Could not save your quick thought.')
    } finally {
      setIsSavingQuick(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Brain },
    { path: '/core', label: 'Core Chat', icon: MessageCircle },
    { path: '/knowledge-worker', label: 'Knowledge Worker', icon: Briefcase },
    { path: '/new-thought', label: 'New Thought', icon: Plus },
    { path: '/personas', label: 'Personas', icon: Users },
    { path: '/circle', label: 'My Circle', icon: Heart },
    { path: '/connections', label: 'Connections', icon: Users },
    { path: '/messages', label: 'Messages', icon: MessageCircle },
    { path: '/persona-library', label: 'Persona Library', icon: Library },
    { path: '/my-context', label: 'My Context', icon: UserCircle },
    { path: '/insights', label: 'Insights', icon: TrendingUp },
    { path: '/planner', label: 'Day Planner', icon: CalendarDays },
    { path: '/actions', label: 'Action Items', icon: CheckSquare },
    { path: '/reflections', label: 'Reflections', icon: SparklesIcon },
    { path: '/memory', label: 'Memory', icon: Database },
  ]

  // Focus Mode: Quick capture + AI chat
  if (focusMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-primary-600" />
            <span className="font-bold text-gray-900">Focus Mode</span>
          </div>
          <button
            onClick={() => { setFocusMode(false); setShowChat(false) }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4" />
            Exit Focus
          </button>
        </div>

        <div className="flex-1 flex">
          {/* Quick Capture Panel */}
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-xl">
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Quick Capture</h2>
              <p className="text-sm text-gray-500 mb-6">Capture a thought quickly without distractions.</p>
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Thought title..."
                className="input mb-3 text-lg"
              />
              <textarea
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder="Write your thought here..."
                className="textarea text-base"
                rows={10}
                autoFocus
              />
              <button
                onClick={handleQuickCapture}
                disabled={!quickTitle.trim() || !quickText.trim() || isSavingQuick}
                className="btn-primary mt-4 flex items-center gap-2 disabled:opacity-50"
              >
                {isSavingQuick ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
                Save Thought
              </button>
            </div>
          </div>

          {/* AI Chat Sidebar */}
          {showChat && (
            <div className="w-96 border-l border-gray-200 bg-white flex flex-col">
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary-600" />
                    AI Chat
                  </h3>
                  <button onClick={() => setShowChat(false)} className="p-1 hover:bg-gray-100 rounded">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
                {focusPersonas.length > 0 && (
                  <select
                    value={selectedChatPersona}
                    onChange={(e) => setSelectedChatPersona(e.target.value)}
                    className="input py-1.5 text-sm"
                  >
                    <option value="">General Assistant</option>
                    {focusPersonas.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 && (
                  <p className="text-gray-400 text-sm text-center mt-8">Ask anything to process your thoughts...</p>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {msg.role === 'assistant' ? <Markdown content={msg.content} /> : msg.content}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-xl px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="p-3 border-t border-gray-200">
                <form onSubmit={(e) => { e.preventDefault(); handleChatSend() }} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="input flex-1 py-1.5 text-sm"
                  />
                  <button type="submit" disabled={!chatInput.trim() || isChatLoading} className="p-2 bg-primary-600 text-white rounded-lg disabled:opacity-50 hover:bg-primary-700 transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Chat toggle FAB */}
        {!showChat && (
          <button
            onClick={() => setShowChat(true)}
            className="fixed bottom-8 right-8 w-14 h-14 bg-primary-600 text-white rounded-full shadow-xl hover:bg-primary-700 transition-all hover:scale-110 flex items-center justify-center"
            title="AI Chat"
          >
            <MessageCircle className="w-7 h-7" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 transform transition-all duration-200 ease-in-out lg:translate-x-0 lg:relative lg:inset-0 flex flex-col shrink-0 ${
          isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'
        } ${isCollapsed ? 'lg:w-[68px]' : 'lg:w-64'}`}
      >
        <div className={`flex items-center h-16 border-b border-gray-200 ${
          isCollapsed ? 'justify-center px-2' : 'justify-between px-6'
        }`}>
          <Link to="/" className="flex items-center gap-2">
            <Brain className="w-8 h-8 text-primary-600 shrink-0" />
            {!isCollapsed && <span className="text-xl font-bold text-gray-900">4Ever</span>}
          </Link>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              const next = !isCollapsed
              setIsCollapsed(next)
              try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
            }}
            className="hidden lg:flex p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex-1 overflow-y-auto space-y-1 pb-4 ${
          isCollapsed ? 'p-2' : 'p-4'
        }`}>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg transition-colors ${
                  isCollapsed ? 'justify-center px-2 py-3' : 'px-4 py-3'
                } ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
                {item.path === '/messages' && totalUnread > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className={`shrink-0 border-t border-gray-200 ${
          isCollapsed ? 'p-2' : 'p-4'
        }`}>
          {/* User info */}
          {isCollapsed ? (
            <div className="flex justify-center mb-2">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center" title={user?.name || 'User'}>
                <span className="text-sm font-medium text-primary-700">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-4 px-4">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-sm font-medium text-primary-700">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate">{user?.phoneNumber}</p>
              </div>
            </div>
          )}
          
          <button
            onClick={() => setFocusMode(true)}
            title={isCollapsed ? 'Focus Mode' : undefined}
            className={`w-full flex items-center gap-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors mb-2 ${
              isCollapsed ? 'justify-center px-2' : 'px-4'
            }`}
          >
            <Focus className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>Enter Focus Mode</span>}
          </button>
          
          <button
            onClick={handleLogout}
            title={isCollapsed ? 'Logout' : undefined}
            className={`w-full flex items-center gap-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors ${
              isCollapsed ? 'justify-center px-2' : 'px-4'
            }`}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>Logout</span>}
          </button>

        </div>
      </aside>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <Brain className="w-7 h-7 text-primary-600" />
            <span className="text-lg font-bold text-gray-900">4Ever</span>
          </Link>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}
