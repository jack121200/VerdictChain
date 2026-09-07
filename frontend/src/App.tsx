import { useState } from 'react'
import type { PageName, Toast } from './types'
import { getToken, setToken } from './api/client'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Investigations from './pages/Investigations'
import NewInvestigation from './pages/NewInvestigation'
import InvestigationDetail from './pages/InvestigationDetail'
import DebateRoom from './pages/DebateRoom'
import TrustCredibility from './pages/TrustCredibility'
import ResponseActions from './pages/ResponseActions'
import AgentFleet from './pages/AgentFleet'
import AuditTrail from './pages/AuditTrail'
import Settings from './pages/Settings'

export default function App() {
  const [page, setPage] = useState<PageName>(getToken() ? 'dashboard' : 'login')
  const [investigationId, setInvestigationId] = useState<string>('')
  const [scenarioLabel, setScenarioLabel] = useState<string>('')
  const [toasts, setToasts] = useState<Toast[]>([])

  const navigate = (target: PageName, invId?: string) => {
    if (invId) setInvestigationId(invId)
    setPage(target)
    window.scrollTo(0, 0)
  }

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800)
  }

  const signOut = () => {
    setToken(null)
    setPage('login')
  }

  if (page === 'login') {
    return <Login navigate={navigate} />
  }

  return (
    <Layout navigate={navigate} currentPage={page} toasts={toasts} addToast={addToast} signOut={signOut}>
      {page === 'dashboard' && <Dashboard navigate={navigate} addToast={addToast} />}
      {page === 'investigations' && <Investigations navigate={navigate} />}
      {page === 'new-investigation' && (
        <NewInvestigation
          navigate={navigate}
          addToast={addToast}
          onScenarioSelected={label => setScenarioLabel(label)}
        />
      )}
      {page === 'investigation-detail' && <InvestigationDetail navigate={navigate} addToast={addToast} investigationId={investigationId} />}
      {page === 'debate-room' && <DebateRoom navigate={navigate} scenarioLabel={scenarioLabel} />}
      {page === 'trust-credibility' && <TrustCredibility navigate={navigate} />}
      {page === 'response-actions' && <ResponseActions navigate={navigate} />}
      {page === 'agent-fleet' && <AgentFleet navigate={navigate} />}
      {page === 'audit-trail' && <AuditTrail navigate={navigate} />}
      {page === 'settings' && <Settings />}
    </Layout>
  )
}
