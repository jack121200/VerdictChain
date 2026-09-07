import { useEffect, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import type { NavigateFn } from '../types'
import { listInvestigations, type InvestigationSummary } from '../api/client'

const StatusChip = ({ status }: { status: string }) => {
  const map: Record<string, { color: string; bg: string }> = {
    investigating: { color: 'var(--warning)', bg: 'rgba(247,144,9,0.1)' },
    verdict_reached: { color: 'var(--info)', bg: 'rgba(54,191,250,0.1)' },
    ambiguous: { color: 'var(--warning)', bg: 'rgba(247,144,9,0.1)' },
    contained: { color: 'var(--safe)', bg: 'rgba(18,183,106,0.1)' },
    error: { color: 'var(--critical)', bg: 'rgba(240,68,56,0.1)' },
  }
  const s = map[status] || map['investigating']
  return <span className="px-2.5 py-1 rounded-full text-[11px] font-medium capitalize" style={{ background: s.bg, color: s.color }}>{status.replace(/_/g, ' ')}</span>
}

export default function Investigations({ navigate }: { navigate: NavigateFn }) {
  const [search, setSearch] = useState('')
  const [investigations, setInvestigations] = useState<InvestigationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    listInvestigations()
      .then(setInvestigations)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load investigations'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const filtered = investigations.filter(inv => {
    const q = search.toLowerCase()
    return q === '' || inv.investigation_id.toLowerCase().includes(q) || (inv.verdict_class ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-white" style={{ fontSize: '22px', lineHeight: '30px' }}>Investigations</h1>
          <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {loading ? 'Loading…' : `${investigations.length} total · ${investigations.filter(i => i.status === 'investigating').length} active`}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>{error}</div>
      )}

      <div className="relative max-w-xs mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
        <input
          type="text"
          placeholder="Search by ID or verdict..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-4 py-2 rounded-[8px] text-[13px] text-white placeholder:text-white/30 outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        />
      </div>

      <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
              {['ID', 'Trigger', 'Verdict', 'Conf.', 'Status', 'Created', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No investigations yet — trigger one from New Investigation.</td></tr>
            )}
            {filtered.map((inv, i) => (
              <tr
                key={inv.investigation_id}
                onClick={() => navigate('investigation-detail', inv.investigation_id)}
                className="cursor-pointer transition-all hover:bg-white/4"
                style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}
              >
                <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: 'var(--info)' }}>{inv.investigation_id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-[12px] capitalize" style={{ color: 'rgba(255,255,255,0.55)' }}>{inv.trigger_type}</td>
                <td className="px-4 py-3 text-[13px] text-white/70">{inv.verdict_class ?? '—'}</td>
                <td className="px-4 py-3 font-mono-data text-[13px] font-bold" style={{ color: 'var(--gold)' }}>{inv.verdict_confidence?.toFixed(2) ?? '—'}</td>
                <td className="px-4 py-3"><StatusChip status={inv.status} /></td>
                <td className="px-4 py-3 font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{new Date(inv.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <button className="text-[12px] px-3 py-1 rounded-[6px]" style={{ color: 'var(--violet)' }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
