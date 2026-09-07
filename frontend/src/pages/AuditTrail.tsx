import { useEffect, useState } from 'react'
import { Shield, Bot, User, Cpu, AlertTriangle } from 'lucide-react'
import type { NavigateFn } from '../types'
import { getAuditTrail, type AuditEntry } from '../api/client'

const AGENT_COLORS: Record<string, string> = { network_traffic: '#36BFFA', access_log: '#8B5CF6', endpoint_behavior: '#12B76A', watchdog: '#F0B429', self_healing: '#F04438' }

export default function AuditTrail({ navigate }: { navigate: NavigateFn }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [chainValid, setChainValid] = useState<boolean | null>(null)
  const [actorFilter, setActorFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getAuditTrail()
      .then(res => { setEntries(res.entries); setChainValid(res.chain_valid) })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load audit trail'))
      .finally(() => setLoading(false))
  }, [])

  const actors = Array.from(new Set(entries.map(e => e.actor)))
  const filtered = actorFilter === 'All' ? entries : entries.filter(e => e.actor === actorFilter)

  const ActorIcon = ({ actor }: { actor: string }) => {
    if (actor === 'self_healing' || actor === 'watchdog') return <Bot size={12} style={{ color: 'var(--violet)' }} />
    if (actor === 'analyst') return <User size={12} style={{ color: 'var(--info)' }} />
    return <Cpu size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
  }

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Audit Trail</h1>
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {loading ? 'Loading…' : `Hash-chained, append-only log · ${entries.length} entries`}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>{error}</div>
      )}

      {chainValid !== null && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-6"
          style={{
            background: chainValid ? 'rgba(54,191,250,0.04)' : 'rgba(240,68,56,0.08)',
            border: `1px solid ${chainValid ? 'rgba(54,191,250,0.15)' : 'rgba(240,68,56,0.3)'}`,
          }}>
          {chainValid ? <Shield size={14} style={{ color: 'var(--info)', flexShrink: 0 }} /> : <AlertTriangle size={14} style={{ color: 'var(--critical)', flexShrink: 0 }} />}
          <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {chainValid
              ? 'Hash chain verified — every entry’s prev_hash matches the actual preceding entry. No tampering detected.'
              : 'Hash chain verification FAILED — an entry does not match its expected hash. The log may have been tampered with.'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <select value={actorFilter} onChange={e => setActorFilter(e.target.value)}
          className="px-3 py-2 rounded-[8px] text-[13px] text-white/70 outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          <option value="All">All Actors</option>
          {actors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="ml-auto text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{filtered.length} entries</span>
      </div>

      <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
              {['Timestamp', 'Actor', 'Action', 'Investigation', 'Entry Hash'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No audit entries yet.</td></tr>
            )}
            {filtered.map(entry => (
              <tr key={entry.id} className="hover:bg-white/3 transition-colors" style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-3 font-mono-data text-[11px] whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.5)' }}>{new Date(entry.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ActorIcon actor={entry.actor} />
                    <span className="text-[12px] font-medium" style={{ color: AGENT_COLORS[entry.actor] || 'rgba(255,255,255,0.6)' }}>{entry.actor}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[13px] text-white/75">{entry.action}</td>
                <td className="px-4 py-3">
                  {entry.investigation_id ? (
                    <button onClick={() => navigate('investigation-detail', entry.investigation_id!)} className="font-mono-data text-[11px] transition-colors hover:text-white" style={{ color: 'var(--info)' }}>
                      {entry.investigation_id.slice(0, 8)}
                    </button>
                  ) : <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono-data text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{entry.entry_hash.slice(0, 16)}…</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
