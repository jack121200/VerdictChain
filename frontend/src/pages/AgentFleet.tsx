import { RotateCw, Database, Cpu, Activity } from 'lucide-react'
import type { NavigateFn } from '../types'
import { AGENTS } from '../data/mock'

const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'online') return (
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

export default function AgentFleet({ navigate }: { navigate: NavigateFn }) {
  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Agent Fleet</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>5 agents · 4 online · 1 isolated</p>
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {AGENTS.map(agent => (
          <div key={agent.id} className={`rounded-[10px] p-5 relative overflow-hidden ${agent.id === 'WD' ? 'card-gold-hairline' : 'card-violet-hairline'}`}
            style={{ background: 'var(--surface)', border: `1px solid ${agent.status === 'isolated' ? 'rgba(240,68,56,0.3)' : 'var(--border)'}` }}>
            {/* Monogram avatar */}
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                {agent.monogram}
              </div>
              <StatusBadge status={agent.status} />
            </div>

            <div className="mb-1 font-display font-semibold text-white" style={{ fontSize: '14px' }}>{agent.name}</div>
            <div className="text-[12px] leading-snug mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>{agent.role}</div>

            {/* Data source */}
            <div className="flex items-start gap-2 mb-3">
              <Database size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }} />
              <span className="font-mono-data text-[10px] leading-snug" style={{ color: 'var(--info)' }}>{agent.dataSource}</span>
            </div>

            {/* Credibility */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Credibility</span>
                <span className="font-mono-data text-[12px] font-bold" style={{ color: agent.status === 'isolated' ? 'var(--critical)' : 'white' }}>{agent.credibility.toFixed(2)}</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${agent.credibility * 100}%`, background: agent.status === 'isolated' ? 'var(--critical)' : agent.color }} />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="rounded-[6px] p-2 text-center" style={{ background: 'var(--elevated)' }}>
                <div className="font-mono-data text-[11px] font-bold text-white">{agent.uptime}</div>
                <div className="text-[9px] uppercase tracking-[0.3px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Uptime</div>
              </div>
              <div className="rounded-[6px] p-2 text-center" style={{ background: 'var(--elevated)' }}>
                <div className="font-mono-data text-[10px] text-white truncate">{agent.model.split(' ')[0]}</div>
                <div className="text-[9px] uppercase tracking-[0.3px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Model</div>
              </div>
            </div>

            {/* Model label */}
            <div className="flex items-center gap-1.5 mb-4">
              <Cpu size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
              <span className="text-[10px] font-mono-data" style={{ color: 'rgba(255,255,255,0.4)' }}>{agent.model}</span>
            </div>

            {/* Restart button */}
            <button className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[12px] font-medium transition-all hover:opacity-80"
              style={{ border: `1px solid ${agent.color}40`, color: agent.color, background: `${agent.color}10` }}>
              <RotateCw size={12} />
              {agent.status === 'isolated' ? 'Restore Agent' : 'Restart Agent'}
            </button>
          </div>
        ))}
      </div>

      {/* Architecture diagram */}
      <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="font-display font-semibold text-white mb-6" style={{ fontSize: '17px' }}>System Architecture & Data Flow</div>
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          {/* Log sources */}
          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)', minWidth: '120px' }}>
            <Database size={20} className="mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.5)' }} />
            <div className="text-[11px] font-semibold text-white mb-1">Log Sources</div>
            {['pcap/NetFlow', 'auth.log', 'EDR/Sysmon'].map(s => (
              <div key={s} className="font-mono-data text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{s}</div>
            ))}
          </div>

          <Arrow />

          {/* 3 Investigator agents */}
          <div className="flex-shrink-0 flex flex-col gap-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.4px] text-center mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Investigator Agents</div>
            {AGENTS.filter(a => ['NT', 'AL', 'EB'].includes(a.id)).map(agent => (
              <div key={agent.id} className="flex items-center gap-2 px-3 py-2 rounded-[8px]" style={{ background: `${agent.color}15`, border: `1px solid ${agent.color}30` }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>{agent.monogram}</div>
                <span className="text-[11px]" style={{ color: agent.color }}>{agent.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>

          <ArrowDouble label="Debate (3 rounds)" />

          {/* Watchdog */}
          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'rgba(240,180,41,0.06)', border: '1px solid rgba(240,180,41,0.25)', minWidth: '110px' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold mx-auto mb-2" style={{ background: '#F0B429', color: '#0A0A0F' }}>WD</div>
            <div className="text-[11px] font-semibold" style={{ color: '#F0B429' }}>Watchdog</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Trust verification</div>
          </div>

          <Arrow label="Verdict" />

          {/* Self-healing */}
          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'rgba(240,68,56,0.06)', border: '1px solid rgba(240,68,56,0.25)', minWidth: '110px' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold mx-auto mb-2" style={{ background: '#F04438', color: 'white' }}>SH</div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--critical)' }}>Self-Healing</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Auto-containment</div>
          </div>

          <Arrow />

          {/* Dashboard */}
          <div className="flex-shrink-0 rounded-[10px] p-4 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)', minWidth: '100px' }}>
            <Activity size={20} className="mx-auto mb-2" style={{ color: 'var(--violet)' }} />
            <div className="text-[11px] font-semibold text-white">Dashboard</div>
            <div className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Analyst review</div>
          </div>
        </div>
        <div className="mt-4 text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          ↺ Feedback loop: analyst decisions retrain agent credibility baseline
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
