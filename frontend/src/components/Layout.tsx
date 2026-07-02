import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { 
  Brain, 
  Plus, 
  Users, 
  LogOut, 
  Menu, 
  X,
  MessageCircle,
  Library,
  UserCircle,
  CalendarDays,
  CheckSquare,
  Heart,
  ChevronsLeft,
  ChevronsRight,
  Briefcase,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useMessagingStore } from '../store/messagingStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { connectSocket, disconnectSocket } from '../api/socket'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const location = useLocation()
  const navigate = useNavigate()
  const { logout, user } = useAuthStore()
  const { totalUnread, loadUnreadCount } = useMessagingStore()
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
    { path: '/messages', label: 'Messages', icon: MessageCircle },
    { path: '/persona-library', label: 'Persona Library', icon: Library },
    { path: '/my-context', label: 'My Context', icon: UserCircle },
    { path: '/planner', label: 'Day Planner', icon: CalendarDays },
    { path: '/actions', label: 'Action Items', icon: CheckSquare },
  ]

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
