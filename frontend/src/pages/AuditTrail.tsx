import { useState } from 'react'
import { Download, Shield, Bot, User, Cpu } from 'lucide-react'
import type { NavigateFn } from '../types'
import { AUDIT_ENTRIES, AGENTS } from '../data/mock'

export default function AuditTrail({ navigate }: { navigate: NavigateFn }) {
  const [actorFilter, setActorFilter] = useState('All')
  const [invFilter, setInvFilter] = useState('')

  const filtered = AUDIT_ENTRIES.filter(e => {
    const matchActor = actorFilter === 'All' || e.actorType === actorFilter
    const matchInv = !invFilter || e.investigationId.includes(invFilter.toUpperCase())
    return matchActor && matchInv
  })

  const ActorIcon = ({ type }: { type: string }) => {
    if (type === 'agent') return <Bot size={12} style={{ color: 'var(--violet)' }} />
    if (type === 'analyst') return <User size={12} style={{ color: 'var(--info)' }} />
    return <Cpu size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
  }

  const getAgentColor = (actor: string) => {
    const match = actor.match(/^([A-Z]{2}) Agent$/)
    if (match) {
      const agent = AGENTS.find(a => a.id === match[1])
      return agent?.color
    }
    return null
  }

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Audit Trail</h1>
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Immutable, chronological log of all system decisions · {AUDIT_ENTRIES.length} entries</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-medium transition-all hover:opacity-80" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.7)', border: '1px solid var(--border)' }}>
          <Download size={14} /> Export Audit Log
        </button>
      </div>

      {/* Tamper-evident notice */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(54,191,250,0.04)', border: '1px solid rgba(54,191,250,0.15)' }}>
        <Shield size={14} style={{ color: 'var(--info)', flexShrink: 0 }} />
        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
          This log is cryptographically signed and append-only. Every entry is hashed and chained. Modification of any entry breaks the chain and is detectable.
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select value={actorFilter} onChange={e => setActorFilter(e.target.value)}
          className="px-3 py-2 rounded-[8px] text-[13px] text-white/70 outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          <option value="All">All Actors</option>
          <option value="agent">Agents</option>
          <option value="analyst">Analysts</option>
          <option value="system">System</option>
        </select>
        <input
          type="text"
          placeholder="Filter by Investigation ID..."
          value={invFilter}
          onChange={e => setInvFilter(e.target.value)}
          className="px-3 py-2 rounded-[8px] text-[13px] text-white/70 outline-none placeholder:text-white/25"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '220px' }}
        />
        <span className="ml-auto text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{filtered.length} entries</span>
      </div>

      {/* Ledger table */}
      <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
              {['ID', 'Timestamp', 'Actor', 'Action', 'Investigation', 'Entry Hash'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => {
              const agentColor = getAgentColor(entry.actor)
              return (
                <tr key={entry.id} className="hover:bg-white/3 transition-colors" style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}>
                  <td className="px-4 py-3 font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{entry.id}</td>
                  <td className="px-4 py-3 font-mono-data text-[11px] whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.5)' }}>{entry.timestamp}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ActorIcon type={entry.actorType} />
                      <span className="text-[12px] font-medium" style={{ color: agentColor || (entry.actorType === 'analyst' ? 'var(--info)' : 'rgba(255,255,255,0.6)') }}>
                        {entry.actor}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-white/75" style={{ maxWidth: '280px' }}>
                    <div className="truncate">{entry.action}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate('investigation-detail', entry.investigationId)} className="font-mono-data text-[11px] transition-colors hover:text-white" style={{ color: 'var(--info)' }}>
                      {entry.investigationId}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono-data text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{entry.hash}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-center text-[11px] font-mono-data" style={{ color: 'rgba(255,255,255,0.2)' }}>
        Chain root: sha256:000000...000000 · Last block: {AUDIT_ENTRIES[0]?.hash || 'n/a'} · {AUDIT_ENTRIES.length} entries · Verified ✓
      </div>
    </div>
  )
}
