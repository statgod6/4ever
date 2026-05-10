import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewThought from './pages/NewThought'
import ThoughtThread from './pages/ThoughtThread'
import Personas from './pages/Personas'
import MyContext from './pages/MyContext'
import Insights from './pages/Insights'
import Planner from './pages/Planner'
import Actions from './pages/Actions'
import Reflections from './pages/Reflections'
import CoreChat from './pages/CoreChat'
import KnowledgeWorker from './pages/KnowledgeWorker'
import MyCircle from './pages/MyCircle'
import Connections from './pages/Connections'
import Messages from './pages/Messages'
import SharedRelationship from './pages/SharedRelationship'
import MemoryDashboard from './pages/MemoryDashboard'
import ToastContainer from './components/Toast'
import ConfirmModal from './components/ConfirmModal'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return (
      <>
        <Login />
        <ToastContainer />
        <ConfirmModal />
      </>
    )
  }

  return (
    <>
    <Layout>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new-thought" element={<NewThought />} />
        <Route path="/thought/:id" element={<ThoughtThread />} />
        <Route path="/personas" element={<Personas />} />
        <Route path="/my-context" element={<MyContext />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/planner" element={<Planner />} />
        <Route path="/actions" element={<Actions />} />
        <Route path="/reflections" element={<Reflections />} />
        <Route path="/core" element={<CoreChat />} />
        <Route path="/knowledge-worker" element={<KnowledgeWorker />} />
        <Route path="/circle" element={<MyCircle />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/shared/:connectionId" element={<SharedRelationship />} />
        <Route path="/memory" element={<MemoryDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
    <ToastContainer />
    <ConfirmModal />
    </>
  )
}

export default App
