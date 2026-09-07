import { useEffect, useState } from 'react'
import { ArrowRight, Activity } from 'lucide-react'
import type { NavigateFn, AddToastFn } from '../types'
import { getAgentFleet, listInvestigations, type AgentFleetEntry, type InvestigationSummary } from '../api/client'

const AGENT_IDENTITY: Record<string, { monogram: string; name: string; color: string }> = {
  network_traffic: { monogram: 'NT', name: 'Network-Traffic Agent', color: '#36BFFA' },
  access_log: { monogram: 'AL', name: 'Access-Log Agent', color: '#8B5CF6' },
  endpoint_behavior: { monogram: 'EB', name: 'Endpoint-Behavior Agent', color: '#12B76A' },
}

const VerdictBadge = ({ verdictClass }: { verdictClass: string | null }) => {
  if (!verdictClass) return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(54,191,250,0.12)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>
      INVESTIGATING
    </span>
  )
  if (verdictClass.startsWith('insider')) return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
      {verdictClass.toUpperCase()}
    </span>
  )
  if (verdictClass === 'benign') return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(18,183,106,0.12)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
      BENIGN
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(247,144,9,0.12)', color: 'var(--warning)', border: '1px solid rgba(247,144,9,0.2)' }}>
      {verdictClass.toUpperCase()}
    </span>
  )
}

const CredBar = ({ value, color }: { value: number; color: string }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--border)' }}>
      <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: color }} />
    </div>
    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{value.toFixed(3)}</span>
  </div>
)

export default function Dashboard({ navigate, addToast: _addToast }: { navigate: NavigateFn; addToast: AddToastFn }) {
  const [investigations, setInvestigations] = useState<InvestigationSummary[]>([])
  const [fleet, setFleet] = useState<AgentFleetEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listInvestigations(), getAgentFleet()])
      .then(([inv, fl]) => { setInvestigations(inv); setFleet(fl) })
      .finally(() => setLoading(false))
  }, [])

  const active = investigations.filter(i => i.status === 'investigating')
  const withVerdict = investigations.filter(i => i.status === 'verdict_reached' || i.status === 'ambiguous')
  const threats = withVerdict.filter(i => i.verdict_class && i.verdict_class !== 'benign' && i.verdict_class !== 'ambiguous')
  const avgTrust = fleet.length > 0 ? fleet.reduce((s, a) => s + a.credibility_score, 0) / fleet.length : 0
  const recentVerdicts = withVerdict.slice(0, 5)

  const statCards = [
    { label: 'Total Investigations', value: String(investigations.length) },
    { label: 'Confirmed Threats', value: String(threats.length) },
    { label: 'Agent Trust Average', value: avgTrust.toFixed(3) },
    { label: 'Active Investigations', value: String(active.length) },
  ]

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map((card, i) => (
          <div key={i} className="card-violet-hairline rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>{card.label}</div>
            <div className="font-display font-bold text-white" style={{ fontSize: '32px', lineHeight: '40px' }}>{loading ? '…' : card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4 mb-6">
        <div className="col-span-7">
          <div className="card-violet-hairline rounded-[10px] p-5 h-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={15} style={{ color: 'var(--violet)' }} />
                <span className="font-display font-semibold text-white" style={{ fontSize: '15px' }}>Active Investigations</span>
              </div>
              <button onClick={() => navigate('new-investigation')} className="text-[12px] flex items-center gap-1" style={{ color: 'var(--violet)' }}>
                New <ArrowRight size={12} />
              </button>
            </div>
            {active.length === 0 && (
              <div className="text-[13px] py-8 text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                No investigations in progress. Trigger one from New Investigation.
              </div>
            )}
            {active.map(inv => (
              <div key={inv.investigation_id} onClick={() => navigate('investigation-detail', inv.investigation_id)}
                className="flex items-center justify-between px-3 py-3 rounded-[8px] cursor-pointer transition-all hover:bg-white/4 mb-2"
                style={{ border: '1px solid var(--border)' }}>
                <div>
                  <div className="font-mono-data text-[12px]" style={{ color: 'var(--info)' }}>{inv.investigation_id.slice(0, 8)}</div>
                  <div className="text-[12px] text-white/60">{inv.trigger_type} trigger</div>
                </div>
                <ArrowRight size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-5">
          <div className="rounded-[10px] p-5 h-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="font-display font-semibold text-white" style={{ fontSize: '17px', lineHeight: '24px' }}>Recent Verdicts</div>
              <button onClick={() => navigate('investigations')} className="text-[12px] flex items-center gap-1 transition-colors" style={{ color: 'var(--violet)' }}>
                All <ArrowRight size={12} />
              </button>
            </div>
            <div className="space-y-2">
              {recentVerdicts.length === 0 && <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No verdicts yet.</div>}
              {recentVerdicts.map(inv => (
                <div key={inv.investigation_id} onClick={() => navigate('investigation-detail', inv.investigation_id)}
                  className="flex items-center gap-3 px-3 py-3 rounded-[8px] cursor-pointer transition-all hover:bg-white/4"
                  style={{ border: '1px solid var(--border)' }}>
                  <VerdictBadge verdictClass={inv.verdict_class} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono-data text-[11px]" style={{ color: 'var(--info)' }}>{inv.investigation_id.slice(0, 8)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--gold)' }}>{inv.verdict_confidence?.toFixed(2) ?? '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display font-semibold text-white" style={{ fontSize: '17px' }}>Agent Fleet Status</div>
          <button onClick={() => navigate('agent-fleet')} className="text-[12px] flex items-center gap-1" style={{ color: 'var(--violet)' }}>
            Manage <ArrowRight size={12} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {fleet.map(agent => {
            const identity = AGENT_IDENTITY[agent.agent_id] ?? { monogram: agent.agent_id.slice(0, 2).toUpperCase(), name: agent.agent_id, color: '#8B5CF6' }
            return (
              <button key={agent.agent_id} onClick={() => navigate('agent-fleet')} className="rounded-[10px] p-4 text-left transition-all hover:border-opacity-60"
                style={{ background: 'var(--elevated)', border: `1px solid ${agent.isolated ? 'rgba(240,68,56,0.3)' : 'var(--border)'}` }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: identity.color, color: '#0A0A0F' }}>{identity.monogram}</div>
                  <div>
                    <div className="text-[12px] font-medium text-white leading-tight">{identity.monogram}</div>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: agent.isolated ? 'var(--critical)' : 'var(--safe)' }} />
                      <span className="text-[10px]" style={{ color: agent.isolated ? 'var(--critical)' : 'var(--safe)' }}>{agent.isolated ? 'Isolated' : 'Online'}</span>
                    </div>
                  </div>
                </div>
                <CredBar value={agent.credibility_score} color={agent.isolated ? 'var(--critical)' : identity.color} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
