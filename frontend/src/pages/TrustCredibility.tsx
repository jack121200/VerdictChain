import { AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import type { NavigateFn } from '../types'
import { AGENTS, FLEET_TRUST_HISTORY } from '../data/mock'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-[8px] text-[12px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
      <div className="text-white/60 mb-1.5">{label}</div>
      {payload.map((p: any) => {
        const agent = AGENTS.find(a => a.id === p.dataKey)
        return (
          <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: agent?.color }} />
            <span className="text-white/70">{agent?.name.split(' ')[0]}:</span>
            <span className="font-mono-data font-bold text-white">{p.value?.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

const ISOLATION_EVENTS = [
  { id: 'ISO-003', timestamp: '2026-09-05 03:01:15 UTC', agent: 'EB', reason: 'CrS dropped to 0.18 — misclassified internal NAS as external exfiltration destination in INV-0231', investigation: 'INV-0231', backup: 'EB-Backup-01', restored: false },
  { id: 'ISO-002', timestamp: '2026-09-02 14:22:08 UTC', agent: 'AL', reason: 'CrS dropped to 0.27 — false correlation of service-account login pattern in INV-0224', investigation: 'INV-0224', backup: 'AL-Backup-01', restored: true },
  { id: 'ISO-001', timestamp: '2026-08-29 09:44:33 UTC', agent: 'NT', reason: 'CrS dropped to 0.25 — failed to identify encrypted tunnel as C2 channel in INV-0218', investigation: 'INV-0218', backup: 'NT-Backup-01', restored: true },
]

export default function TrustCredibility({ navigate }: { navigate: NavigateFn }) {
  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Trust & Credibility</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Fleet-wide credibility scores over the last 7 days</p>
      </div>

      {/* EB alert */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(240,68,56,0.06)', border: '1px solid rgba(240,68,56,0.2)' }}>
        <AlertTriangle size={15} style={{ color: 'var(--critical)', flexShrink: 0 }} />
        <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
          <strong style={{ color: 'var(--critical)' }}>EB Agent isolated</strong> — credibility score 0.18 (below threshold 0.30). Backup agent EB-Backup-01 activated for INV-0231 onwards.
        </span>
      </div>

      {/* Fleet chart */}
      <div className="rounded-[10px] p-6 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-display font-semibold text-white" style={{ fontSize: '17px' }}>Fleet Credibility Over Time</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Aug 29 – Sep 5, 2026 · All 5 agents · Threshold line at 0.30</div>
          </div>
          <div className="flex flex-wrap gap-3">
            {AGENTS.map(agent => (
              <div key={agent.id} className="flex items-center gap-1.5 text-[11px]">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: agent.color }} />
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>{agent.monogram}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={FLEET_TRUST_HISTORY} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
            <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickCount={6} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0.30} stroke="#F04438" strokeDasharray="5 4" strokeWidth={1.5} label={{ value: 'Isolation threshold (0.30)', position: 'insideTopRight', fill: 'rgba(240,68,56,0.6)', fontSize: 10 }} />
            {AGENTS.map(agent => (
              <Line key={agent.id} type="monotone" dataKey={agent.id} name={agent.name} stroke={agent.color} strokeWidth={2}
                dot={{ r: 3, fill: agent.color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Leaderboard */}
        <div className="col-span-7">
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.4px]" style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)', color: 'rgba(255,255,255,0.4)' }}>
              Agent Leaderboard
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                  {['Agent', 'Current CrS', 'Verified', 'Failed', 'Isolated', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...AGENTS].sort((a, b) => b.credibility - a.credibility).map((agent, i) => (
                  <tr key={agent.id} style={{ borderBottom: '1px solid var(--border)', background: agent.status === 'isolated' ? 'rgba(240,68,56,0.04)' : i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)' }}>
                    <td className="px-4 py-3">
                      <button onClick={() => navigate('agent-fleet')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>{agent.monogram}</div>
                        <span className="text-[13px] font-medium" style={{ color: agent.color }}>{agent.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                          <div className="h-full rounded-full" style={{ width: `${agent.credibility * 100}%`, background: agent.status === 'isolated' ? 'var(--critical)' : agent.color }} />
                        </div>
                        <span className="font-mono-data text-[12px] font-bold" style={{ color: agent.status === 'isolated' ? 'var(--critical)' : 'white' }}>{agent.credibility.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--safe)' }}>{[12, 18, 7, 22, 9][i]}</td>
                    <td className="px-4 py-3 text-[13px]" style={{ color: [0, 0, 2, 0, 0][i] > 0 ? 'var(--critical)' : 'rgba(255,255,255,0.3)' }}>{[0, 0, 2, 0, 0][i]}</td>
                    <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{[0, 0, 1, 0, 0][i]}×</td>
                    <td className="px-4 py-3">
                      {agent.status === 'isolated' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>ISOLATED</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)' }}>TRUSTED</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Isolation Events */}
        <div className="col-span-5">
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.4px]" style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)', color: 'rgba(255,255,255,0.4)' }}>
              Isolation Events
            </div>
            {ISOLATION_EVENTS.map(event => {
              const agent = AGENTS.find(a => a.id === event.agent)!
              return (
                <div key={event.id} className="p-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>{agent.monogram}</div>
                      <span className="text-[12px] font-semibold" style={{ color: agent.color }}>{agent.name.split(' ')[0]}</span>
                      <span className="font-mono-data text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--elevated)', color: 'var(--info)' }}>{event.investigation}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${event.restored ? 'text-safe' : 'text-critical'}`} style={{ background: event.restored ? 'rgba(18,183,106,0.1)' : 'rgba(240,68,56,0.1)', color: event.restored ? 'var(--safe)' : 'var(--critical)' }}>
                      {event.restored ? 'RESTORED' : 'ACTIVE'}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>{event.reason}</p>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <span className="font-mono-data">{event.timestamp}</span>
                    <span>· Backup: {event.backup}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
