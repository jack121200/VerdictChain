import { useState } from 'react'
import { TrendingUp, TrendingDown, ArrowRight, Activity } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { NavigateFn, AddToastFn } from '../types'
import { INVESTIGATIONS, AGENTS, DASHBOARD_ACTIVITY, SPARKLINE_INVESTIGATIONS, SPARKLINE_THREATS, SPARKLINE_TRUST, SPARKLINE_TIME } from '../data/mock'

const VerdictBadge = ({ verdict, confidence }: { verdict: string; confidence: number }) => {
  if (verdict === 'INSIDER_THREAT') return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
      <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 0L8 8H0L4 0Z" fill="currentColor"/></svg>
      INSIDER THREAT
    </span>
  )
  if (verdict === 'EXTERNAL_ATTACK') return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(247,144,9,0.12)', color: 'var(--warning)', border: '1px solid rgba(247,144,9,0.2)' }}>
      <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
      EXTERNAL ATTACK
    </span>
  )
  if (verdict === 'FALSE_POSITIVE') return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(18,183,106,0.12)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
      <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4L3.5 6.5L7 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
      FALSE POSITIVE
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(54,191,250,0.12)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>
      <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 1v3l2 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
      INVESTIGATING
    </span>
  )
}

const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 80; const h = 28
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h * 0.85 - 2}`).join(' ')
  return (
    <svg width={w} height={h} className="opacity-70">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const CredBarFull = ({ value, color }: { value: number; color: string }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${value * 100}%`, background: color }} />
    </div>
    <span className="font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.6)', minWidth: '32px' }}>{value.toFixed(2)}</span>
  </div>
)

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-[8px] text-[12px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
      <div className="text-white/60 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-white/80 capitalize">{p.dataKey}:</span>
          <span className="text-white font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ navigate, addToast }: { navigate: NavigateFn; addToast: AddToastFn }) {
  const [loading] = useState(false)

  const statCards = [
    { label: 'Investigations Today', value: '7', trend: '+2 vs yesterday', up: true, sparkData: SPARKLINE_INVESTIGATIONS, color: 'var(--violet)' },
    { label: 'Confirmed Threats', value: '3', trend: '+1 vs yesterday', up: true, sparkData: SPARKLINE_THREATS, color: 'var(--critical)' },
    { label: 'Agent Trust Average', value: '0.73', trend: '−0.04 vs yesterday', up: false, sparkData: SPARKLINE_TRUST, color: 'var(--gold)' },
    { label: 'Avg Time to Verdict', value: '28 min', trend: '−3 min vs yesterday', up: true, sparkData: SPARKLINE_TIME, color: 'var(--safe)' },
  ]

  const recentVerdicts = INVESTIGATIONS.filter(i => i.verdict !== 'INVESTIGATING').slice(0, 5)

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      {/* Error state banner example */}
      {/* <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)', color: 'var(--critical)' }}>
        <AlertTriangle size={15} /> Log ingest pipeline disconnected — last update 4 min ago
      </div> */}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map((card, i) => (
          <div key={i} className="card-violet-hairline rounded-[10px] p-5 relative overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>{card.label}</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="font-display font-bold text-white" style={{ fontSize: '32px', lineHeight: '40px' }}>{card.value}</div>
                <div className="flex items-center gap-1 mt-1 text-[12px]" style={{ color: card.up ? 'var(--safe)' : 'var(--critical)' }}>
                  {card.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {card.trend}
                </div>
              </div>
              <Sparkline data={card.sparkData} color={card.color} />
            </div>
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-12 gap-4 mb-6">
        {/* Left 60% - Activity + Active Investigation */}
        <div className="col-span-7 flex flex-col gap-4">
          {/* Area chart */}
          <div className="rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-display font-semibold text-white" style={{ fontSize: '17px', lineHeight: '24px' }}>Investigation Activity</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Today · Sep 5, 2026</div>
              </div>
              <div className="flex items-center gap-4 text-[12px]">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--violet)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: 'var(--violet)' }} />Investigations
                </span>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--critical)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: 'var(--critical)' }} />Threats
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={DASHBOARD_ACTIVITY} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gradViolet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradRed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F04438" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#F04438" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="investigations" stroke="#8B5CF6" strokeWidth={2} fill="url(#gradViolet)" />
                <Area type="monotone" dataKey="threats" stroke="#F04438" strokeWidth={2} fill="url(#gradRed)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Active investigation card */}
          <div className="card-violet-hairline rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={15} style={{ color: 'var(--violet)' }} />
                <span className="font-display font-semibold text-white" style={{ fontSize: '15px' }}>Active Investigation</span>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--warning)' }}>
                <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--warning)' }} />
                Round 2 of 3 in progress
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono-data text-[13px] mb-1" style={{ color: 'var(--info)' }}>INV-0229</div>
                <div className="text-[13px] text-white/70 mb-3">Unusual Data Exfiltration Volume · WIN11-VICTIM-02</div>
                <div className="flex items-center gap-2">
                  {['NT', 'AL', 'EB'].map(id => {
                    const agent = AGENTS.find(a => a.id === id)!
                    return (
                      <button key={id} onClick={() => navigate('agent-fleet')}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold transition-all hover:opacity-80"
                        style={{ background: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}30` }}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                          {agent.monogram}
                        </span>
                        {agent.name.split(' ')[0]}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[28px] font-display font-bold" style={{ color: 'var(--gold)' }}>0.57</div>
                <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>current confidence</div>
                <button onClick={() => navigate('investigation-detail', 'INV-0229')}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all hover:opacity-90"
                  style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.25)' }}>
                  View <ArrowRight size={12} />
                </button>
              </div>
            </div>
            {/* Round progress */}
            <div className="mt-4 flex gap-1.5">
              {[1, 2, 3].map(r => (
                <div key={r} className="flex-1 h-1 rounded-full transition-all" style={{
                  background: r === 1 ? 'var(--violet)' : r === 2 ? 'var(--warning)' : 'var(--border)'
                }} />
              ))}
            </div>
          </div>
        </div>

        {/* Right 40% - Recent Verdicts */}
        <div className="col-span-5">
          <div className="rounded-[10px] p-5 h-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="font-display font-semibold text-white" style={{ fontSize: '17px', lineHeight: '24px' }}>Recent Verdicts</div>
              <button onClick={() => navigate('investigations')} className="text-[12px] flex items-center gap-1 transition-colors" style={{ color: 'var(--violet)' }}>
                All <ArrowRight size={12} />
              </button>
            </div>
            <div className="space-y-2">
              {recentVerdicts.map(inv => (
                <div
                  key={inv.id}
                  onClick={() => navigate('investigation-detail', inv.id)}
                  className="flex items-center gap-3 px-3 py-3 rounded-[8px] cursor-pointer transition-all hover:bg-white/4"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <VerdictBadge verdict={inv.verdict} confidence={inv.confidence} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono-data text-[11px]" style={{ color: 'var(--info)' }}>{inv.id}</div>
                    <div className="text-[12px] text-white/60 truncate">{inv.triggerReason}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--gold)' }}>{inv.confidence.toFixed(2)}</div>
                    <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {inv.timestamp.split(' ')[1]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Fleet Strip */}
      <div className="rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display font-semibold text-white" style={{ fontSize: '17px' }}>Agent Fleet Status</div>
          <button onClick={() => navigate('agent-fleet')} className="text-[12px] flex items-center gap-1" style={{ color: 'var(--violet)' }}>
            Manage <ArrowRight size={12} />
          </button>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {AGENTS.map(agent => (
            <button
              key={agent.id}
              onClick={() => navigate('agent-fleet')}
              className="rounded-[10px] p-4 text-left transition-all hover:border-opacity-60"
              style={{ background: 'var(--elevated)', border: `1px solid ${agent.status === 'isolated' ? 'rgba(240,68,56,0.3)' : 'var(--border)'}` }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                  {agent.monogram}
                </div>
                <div>
                  <div className="text-[12px] font-medium text-white leading-tight">{agent.monogram}</div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: agent.status === 'online' ? 'var(--safe)' : 'var(--critical)' }} />
                    <span className="text-[10px]" style={{ color: agent.status === 'online' ? 'var(--safe)' : 'var(--critical)' }}>
                      {agent.status === 'online' ? 'Online' : 'Isolated'}
                    </span>
                  </div>
                </div>
              </div>
              <CredBar value={agent.credibility} color={agent.status === 'isolated' ? 'var(--critical)' : agent.color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const CredBar = ({ value, color }: { value: number; color: string }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--border)' }}>
      <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: color }} />
    </div>
    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{value.toFixed(2)}</span>
  </div>
)
