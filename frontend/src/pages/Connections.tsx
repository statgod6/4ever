import { useState, useEffect } from 'react'
import {
  Users, Search, UserPlus, Check, X, Trash2, Loader2,
  MessageCircle, Phone, Clock, UserCheck, Heart,
} from 'lucide-react'
import { connectionsApi, type SearchResult } from '../api/messaging'
import { useMessagingStore } from '../store/messagingStore'
import { toast } from '../components/Toast'
import { useNavigate } from 'react-router-dom'

export default function Connections() {
  const navigate = useNavigate()
  const { connections, pendingRequests, connectionsLoading, loadConnections, loadPendingRequests } = useMessagingStore()
  const [activeTab, setActiveTab] = useState<'connections' | 'pending' | 'search'>('connections')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [invitePhone, setInvitePhone] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    loadConnections()
    loadPendingRequests()
  }, [])

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return
    setSearching(true)
    try {
      const results = await connectionsApi.search(searchQuery)
      setSearchResults(results)
    } catch { toast.error('Search failed') } finally {
      setSearching(false)
    }
  }

  const handleSendRequest = async (userId: string) => {
    setActionLoading(userId)
    try {
      await connectionsApi.sendRequest(userId)
      toast.success('Connection request sent!')
      handleSearch() // refresh
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to send request')
    } finally { setActionLoading(null) }
  }

  const handleInvite = async () => {
    if (!invitePhone.trim()) return
    setActionLoading('invite')
    try {
      await connectionsApi.sendInvite(invitePhone)
      toast.success('Invite sent!')
      setInvitePhone('')
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to send invite')
    } finally { setActionLoading(null) }
  }

  const handleAccept = async (id: string) => {
    setActionLoading(id)
    try {
      await connectionsApi.accept(id)
      toast.success('Connection accepted!')
      loadPendingRequests()
      loadConnections()
    } catch { toast.error('Failed') } finally { setActionLoading(null) }
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    try {
      await connectionsApi.reject(id)
      loadPendingRequests()
    } catch { toast.error('Failed') } finally { setActionLoading(null) }
  }

  const handleRemove = async (id: string) => {
    setActionLoading(id)
    try {
      await connectionsApi.remove(id)
      toast.success('Connection removed')
      loadConnections()
    } catch { toast.error('Failed') } finally { setActionLoading(null) }
  }

  const tabs = [
    { key: 'connections', label: 'My Connections', icon: Users, count: connections.length },
    { key: 'pending', label: 'Pending', icon: Clock, count: pendingRequests.length },
    { key: 'search', label: 'Find People', icon: Search },
  ] as const

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-7 h-7 text-primary-600" />
          Connections
        </h1>
        <p className="text-gray-500 mt-1">Connect with people on 4Ever to message and share</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {'count' in t && t.count ? (
              <span className="bg-primary-100 text-primary-700 text-xs px-1.5 py-0.5 rounded-full">{t.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Connections List */}
      {activeTab === 'connections' && (
        <div className="space-y-3">
          {connectionsLoading ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
          ) : connections.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <UserCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No connections yet. Find people to connect with!</p>
            </div>
          ) : (
            connections.map((conn) => (
              <div key={conn.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:border-primary-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary-700">{conn.user.name?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{conn.user.name}</p>
                    <p className="text-xs text-gray-500">{conn.user.phoneNumber}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/shared/${conn.id}`)}
                    className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    title="Shared relationship"
                  >
                    <Heart className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => navigate(`/messages?user=${conn.user.id}&name=${encodeURIComponent(conn.user.name)}`)}
                    className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    title="Message"
                  >
                    <MessageCircle className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleRemove(conn.id)}
                    disabled={actionLoading === conn.id}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove"
                  >
                    {actionLoading === conn.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Pending Requests */}
      {activeTab === 'pending' && (
        <div className="space-y-3">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No pending requests</p>
            </div>
          ) : (
            pendingRequests.map((req) => (
              <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <span className="text-sm font-bold text-amber-700">{req.requester.name?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{req.requester.name}</p>
                    <p className="text-xs text-gray-500">{req.requester.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAccept(req.id)}
                    disabled={actionLoading === req.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> Accept
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    disabled={actionLoading === req.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Search */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by name or phone..."
                className="input pl-10 w-full"
              />
            </div>
            <button onClick={handleSearch} disabled={searching} className="btn-primary flex items-center gap-2">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>

          {/* Invite by phone */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Phone className="w-4 h-4" /> Invite by phone number</p>
            <div className="flex gap-2">
              <input
                type="tel"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="+919876543210"
                className="input flex-1"
              />
              <button onClick={handleInvite} disabled={actionLoading === 'invite'} className="btn-primary flex items-center gap-2">
                {actionLoading === 'invite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Send
              </button>
            </div>
          </div>

          {/* Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">{searchResults.length} results</p>
              {searchResults.map((user) => (
                <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-blue-700">{user.name?.[0]?.toUpperCase() || '?'}</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.phoneNumber}</p>
                    </div>
                  </div>
                  {user.connectionStatus === 'accepted' ? (
                    <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full">Connected</span>
                  ) : user.connectionStatus === 'pending' ? (
                    <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-full">Pending</span>
                  ) : (
                    <button
                      onClick={() => handleSendRequest(user.id)}
                      disabled={actionLoading === user.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    >
                      {actionLoading === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
