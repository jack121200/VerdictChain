import { useEffect, useState } from 'react'
import { Database, Cpu, Activity } from 'lucide-react'
import type { NavigateFn } from '../types'
import { getAgentFleet, type AgentFleetEntry } from '../api/client'

// Static identity metadata (monogram/color/role text) - the design system's
// fixed agent-identity table (SKILL-design-system.md), not per-instance data.
// credibility_score and isolated ALWAYS come from the real API, never from here.
const AGENT_IDENTITY: Record<string, { monogram: string; name: string; color: string; role: string; dataSource: string }> = {
  network_traffic: { monogram: 'NT', name: 'Network-Traffic Agent', color: '#36BFFA', role: 'Analyzes network-flow data for DDoS, port-scan, brute-force, and botnet C2 patterns', dataSource: 'CICIDS2017 network flows' },
  access_log: { monogram: 'AL', name: 'Access-Log Agent', color: '#8B5CF6', role: 'Audits file-access events for off-hours and unusual-volume access', dataSource: 'CERT r4.2 file.csv' },
  endpoint_behavior: { monogram: 'EB', name: 'Endpoint-Behavior Agent', color: '#12B76A', role: 'Monitors logon timing and device-connect activity for insider anomalies', dataSource: 'CERT r4.2 logon.csv + device.csv' },
}

const StatusBadge = ({ isolated }: { isolated: boolean }) => {
  if (!isolated) return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
      <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--safe)' }} />Online
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.25)' }}>
      <svg width="7" height="7" viewBox="0 0 8 8"><path d="M4 0L8 8H0L4 0Z" fill="currentColor"/></svg>ISOLATED
    </span>
  )
}

export default function AgentFleet({ navigate: _navigate }: { navigate: NavigateFn }) {
  const [fleet, setFleet] = useState<AgentFleetEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getAgentFleet()
      .then(setFleet)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load agent fleet'))
      .finally(() => setLoading(false))
  }, [])

  const onlineCount = fleet.filter(a => !a.isolated).length

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Agent Fleet</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {loading ? 'Loading…' : `${fleet.length} investigator agents · ${onlineCount} online · ${fleet.length - onlineCount} isolated`}
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>
          {error}
        </div>
      )}

      {/* Agent cards - real credibility from Watchdog's Redis state via GET /agents/fleet */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {fleet.map(agent => {
          const identity = AGENT_IDENTITY[agent.agent_id] ?? {
            monogram: agent.agent_id.slice(0, 2).toUpperCase(),
            name: agent.agent_id,
            color: '#8B5CF6',
            role: '',
            dataSource: '',
          }
          return (
            <div key={agent.agent_id} className="rounded-[10px] p-5 relative overflow-hidden card-violet-hairline"
              style={{ background: 'var(--surface)', border: `1px solid ${agent.isolated ? 'rgba(240,68,56,0.3)' : 'var(--border)'}` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-bold" style={{ background: identity.color, color: '#0A0A0F' }}>
                  {identity.monogram}
                </div>
                <StatusBadge isolated={agent.isolated} />
              </div>

              <div className="mb-1 font-display font-semibold text-white" style={{ fontSize: '14px' }}>{identity.name}</div>
              <div className="text-[12px] leading-snug mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>{identity.role}</div>

              <div className="flex items-start gap-2 mb-3">
                <Database size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }} />
                <span className="font-mono-data text-[10px] leading-snug" style={{ color: 'var(--info)' }}>{identity.dataSource}</span>
              </div>

              <div className="mb-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Credibility (CrS)</span>
                  <span className="font-mono-data text-[12px] font-bold" style={{ color: agent.isolated ? 'var(--critical)' : 'white' }}>{agent.credibility_score.toFixed(3)}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${agent.credibility_score * 100}%`, background: agent.isolated ? 'var(--critical)' : identity.color }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Architecture diagram - static, structural documentation of the
          system's design, not per-instance data (no numbers shown here). */}
      <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="font-display font-semibold text-white mb-6" style={{ fontSize: '17px' }}>System Architecture & Data Flow</div>
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)', minWidth: '120px' }}>
            <Database size={20} className="mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.5)' }} />
            <div className="text-[11px] font-semibold text-white mb-1">Log Sources</div>
            {['CICIDS2017', 'CERT r4.2'].map(s => (
              <div key={s} className="font-mono-data text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{s}</div>
            ))}
          </div>

          <Arrow />

          <div className="flex-shrink-0 flex flex-col gap-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.4px] text-center mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Investigator Agents</div>
            {Object.entries(AGENT_IDENTITY).map(([id, identity]) => (
              <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-[8px]" style={{ background: `${identity.color}15`, border: `1px solid ${identity.color}30` }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: identity.color, color: '#0A0A0F' }}>{identity.monogram}</div>
                <span className="text-[11px]" style={{ color: identity.color }}>{identity.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>

          <ArrowDouble label="Debate (3 rounds)" />

          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'rgba(240,180,41,0.06)', border: '1px solid rgba(240,180,41,0.25)', minWidth: '110px' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold mx-auto mb-2" style={{ background: '#F0B429', color: '#0A0A0F' }}>WD</div>
            <div className="text-[11px] font-semibold" style={{ color: '#F0B429' }}>Watchdog</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Trust verification</div>
          </div>

          <Arrow label="Verdict" />

          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'rgba(240,68,56,0.06)', border: '1px solid rgba(240,68,56,0.25)', minWidth: '110px' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold mx-auto mb-2" style={{ background: '#F04438', color: 'white' }}>SH</div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--critical)' }}>Self-Healing</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Auto-containment</div>
          </div>

          <Arrow />

          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)', minWidth: '100px' }}>
            <Activity size={20} className="mx-auto mb-2" style={{ color: 'var(--violet)' }} />
            <div className="text-[11px] font-semibold text-white">Dashboard</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Analyst review</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="flex-shrink-0 flex flex-col items-center gap-1">
    {label && <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>}
    <svg width="32" height="16" viewBox="0 0 32 16">
      <path d="M0 8H28M28 8L20 3M28 8L20 13" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </div>
)

const ArrowDouble = ({ label }: { label?: string }) => (
  <div className="flex-shrink-0 flex flex-col items-center gap-1">
    <span className="text-[10px] text-center" style={{ color: 'var(--violet)' }}>{label}</span>
    <svg width="40" height="20" viewBox="0 0 40 20">
      <path d="M0 8H36M36 8L28 3M36 8L28 13" stroke="var(--violet)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
      <path d="M40 12H4M4 12L12 7M4 12L12 17" stroke="var(--violet)" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.3" />
    </svg>
  </div>
)
