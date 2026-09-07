import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { NavigateFn } from '../types'
import { getAgentFleet, getAuditTrail, type AgentFleetEntry, type AuditEntry } from '../api/client'

const AGENT_IDENTITY: Record<string, { monogram: string; name: string; color: string }> = {
  network_traffic: { monogram: 'NT', name: 'Network-Traffic Agent', color: '#36BFFA' },
  access_log: { monogram: 'AL', name: 'Access-Log Agent', color: '#8B5CF6' },
  endpoint_behavior: { monogram: 'EB', name: 'Endpoint-Behavior Agent', color: '#12B76A' },
}

export default function TrustCredibility({ navigate }: { navigate: NavigateFn }) {
  const [fleet, setFleet] = useState<AgentFleetEntry[]>([])
  const [isolationEvents, setIsolationEvents] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getAgentFleet(), getAuditTrail(200)])
      .then(([fleetRes, auditRes]) => {
        setFleet(fleetRes)
        // credibility_log isn't exposed globally yet - approximate "isolation
        // events" from the audit trail's own record of watchdog/self_healing
        // actions rather than fabricate a dedicated events feed.
        setIsolationEvents(auditRes.entries.filter(e => e.action.toLowerCase().includes('isolat')))
      })
      .finally(() => setLoading(false))
  }, [])

  const isolatedAgent = fleet.find(a => a.isolated)

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Trust & Credibility</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {loading ? 'Loading…' : `Live credibility scores for ${fleet.length} investigator agents`}
        </p>
      </div>

      {isolatedAgent && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(240,68,56,0.06)', border: '1px solid rgba(240,68,56,0.2)' }}>
          <AlertTriangle size={15} style={{ color: 'var(--critical)', flexShrink: 0 }} />
          <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
            <strong style={{ color: 'var(--critical)' }}>{AGENT_IDENTITY[isolatedAgent.agent_id]?.name ?? isolatedAgent.agent_id} isolated</strong> —
            credibility score {isolatedAgent.credibility_score.toFixed(3)} (below threshold 0.30).
          </span>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-7">
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.4px]" style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)', color: 'rgba(255,255,255,0.4)' }}>
              Agent Leaderboard
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                  {['Agent', 'Current CrS', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...fleet].sort((a, b) => b.credibility_score - a.credibility_score).map((agent, i) => {
                  const identity = AGENT_IDENTITY[agent.agent_id] ?? { monogram: agent.agent_id.slice(0, 2).toUpperCase(), name: agent.agent_id, color: '#8B5CF6' }
                  return (
                    <tr key={agent.agent_id} style={{ borderBottom: '1px solid var(--border)', background: agent.isolated ? 'rgba(240,68,56,0.04)' : i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)' }}>
                      <td className="px-4 py-3">
                        <button onClick={() => navigate('agent-fleet')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: identity.color, color: '#0A0A0F' }}>{identity.monogram}</div>
                          <span className="text-[13px] font-medium" style={{ color: identity.color }}>{identity.name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                            <div className="h-full rounded-full" style={{ width: `${agent.credibility_score * 100}%`, background: agent.isolated ? 'var(--critical)' : identity.color }} />
                          </div>
                          <span className="font-mono-data text-[12px] font-bold" style={{ color: agent.isolated ? 'var(--critical)' : 'white' }}>{agent.credibility_score.toFixed(3)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {agent.isolated ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>ISOLATED</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)' }}>TRUSTED</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-span-5">
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.4px]" style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)', color: 'rgba(255,255,255,0.4)' }}>
              Isolation Events (from Audit Trail)
            </div>
            {isolationEvents.length === 0 && (
              <div className="p-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No isolation events recorded yet.</div>
            )}
            {isolationEvents.map(event => (
              <div key={event.id} className="p-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--critical)' }}>{event.actor}</span>
                  {event.investigation_id && (
                    <span className="font-mono-data text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--elevated)', color: 'var(--info)' }}>{event.investigation_id.slice(0, 8)}</span>
                  )}
                </div>
                <p className="text-[11px] leading-snug mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>{event.action}</p>
                <div className="text-[10px] font-mono-data" style={{ color: 'rgba(255,255,255,0.3)' }}>{new Date(event.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
