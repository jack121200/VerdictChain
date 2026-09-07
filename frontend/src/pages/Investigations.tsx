import { useState } from 'react'
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import type { NavigateFn } from '../types'
import { INVESTIGATIONS } from '../data/mock'

const VerdictBadge = ({ verdict }: { verdict: string }) => {
  if (verdict === 'INSIDER_THREAT') return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
      <svg width="7" height="7" viewBox="0 0 8 8"><path d="M4 0L8 8H0L4 0Z" fill="currentColor"/></svg>
      INSIDER THREAT
    </span>
  )
  if (verdict === 'EXTERNAL_ATTACK') return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: 'rgba(247,144,9,0.12)', color: 'var(--warning)', border: '1px solid rgba(247,144,9,0.2)' }}>
      <svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
      EXTERNAL ATTACK
    </span>
  )
  if (verdict === 'FALSE_POSITIVE') return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: 'rgba(18,183,106,0.12)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
      <svg width="7" height="7" viewBox="0 0 8 8"><path d="M1 4L3.5 6.5L7 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
      FALSE POSITIVE
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: 'rgba(54,191,250,0.12)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>
      <svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      INVESTIGATING
    </span>
  )
}

const StatusChip = ({ status }: { status: string }) => {
  const map: Record<string, { color: string; bg: string }> = {
    'Investigating': { color: 'var(--warning)', bg: 'rgba(247,144,9,0.1)' },
    'Verdict Reached': { color: 'var(--info)', bg: 'rgba(54,191,250,0.1)' },
    'Contained': { color: 'var(--safe)', bg: 'rgba(18,183,106,0.1)' },
  }
  const s = map[status] || map['Investigating']
  return (
    <span className="px-2.5 py-1 rounded-full text-[11px] font-medium" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}

const ATTACK_CLASSES = ['Insider Threat', 'External Recon', 'Data Exfiltration', 'Credential Attack', 'Privilege Abuse']

const DonutChart = ({ data }: { data: { label: string; count: number; color: string }[] }) => {
  const total = data.reduce((s, d) => s + d.count, 0)
  let cumulative = 0
  const segments = data.map(d => {
    const pct = (d.count / total) * 100
    const seg = { ...d, pct, start: cumulative }
    cumulative += pct
    return seg
  })
  const r = 42; const cx = 60; const cy = 60
  const circumference = 2 * Math.PI * r

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="16" />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="16"
            strokeDasharray={`${(seg.pct / 100) * circumference} ${circumference}`}
            strokeDashoffset={-((seg.start / 100) * circumference - circumference / 4)}
            style={{ transition: 'all 0.3s' }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Space Grotesk">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="Inter">total</text>
      </svg>
      <div className="space-y-1.5 w-full">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: seg.color }} />
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>{seg.label}</span>
            </div>
            <span className="font-medium text-white">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Investigations({ navigate }: { navigate: NavigateFn }) {
  const [search, setSearch] = useState('')
  const [verdictFilter, setVerdictFilter] = useState('All')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [page, setPage] = useState(1)

  const filtered = INVESTIGATIONS.filter(inv => {
    const matchSearch = search === '' || inv.id.toLowerCase().includes(search.toLowerCase()) || inv.triggerReason.toLowerCase().includes(search.toLowerCase())
    const matchVerdict = verdictFilter === 'All' || inv.verdict === verdictFilter
    return matchSearch && matchVerdict
  })

  const donutData = [
    { label: 'Insider Threat', count: INVESTIGATIONS.filter(i => i.verdict === 'INSIDER_THREAT').length, color: 'var(--critical)' },
    { label: 'External Attack', count: INVESTIGATIONS.filter(i => i.verdict === 'EXTERNAL_ATTACK').length, color: 'var(--warning)' },
    { label: 'Investigating', count: INVESTIGATIONS.filter(i => i.verdict === 'INVESTIGATING').length, color: 'var(--info)' },
    { label: 'False Positive', count: INVESTIGATIONS.filter(i => i.verdict === 'FALSE_POSITIVE').length, color: 'var(--safe)' },
  ]

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white" style={{ fontSize: '22px', lineHeight: '30px' }}>Investigations</h1>
        <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{INVESTIGATIONS.length} total · {INVESTIGATIONS.filter(i => i.status === 'Investigating').length} active</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main table */}
        <div className="col-span-9">
          {/* Filter bar */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                type="text"
                placeholder="Search investigations..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-4 py-2 rounded-[8px] text-[13px] text-white placeholder:text-white/30 outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
            </div>
            <select
              value={verdictFilter}
              onChange={e => setVerdictFilter(e.target.value)}
              className="px-3 py-2 rounded-[8px] text-[13px] text-white/70 outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <option value="All">All Verdicts</option>
              <option value="INSIDER_THREAT">Insider Threat</option>
              <option value="EXTERNAL_ATTACK">External Attack</option>
              <option value="FALSE_POSITIVE">False Positive</option>
              <option value="INVESTIGATING">Investigating</option>
            </select>
            {(search || verdictFilter !== 'All') && (
              <button onClick={() => { setSearch(''); setVerdictFilter('All') }} className="px-3 py-2 rounded-[8px] text-[13px] transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
                Clear filters
              </button>
            )}
            <label className="flex items-center gap-2 ml-auto cursor-pointer">
              <div
                className="w-8 h-4 rounded-full relative transition-all"
                style={{ background: autoRefresh ? 'var(--violet)' : 'var(--border)' }}
                onClick={() => setAutoRefresh(r => !r)}
              >
                <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: autoRefresh ? '17px' : '2px' }} />
              </div>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Auto-refresh</span>
            </label>
          </div>

          {/* Table */}
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                  {['Verdict', 'ID', 'Trigger Reason', 'Attack Class', 'Conf.', 'Rounds', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, i) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate('investigation-detail', inv.id)}
                    className="cursor-pointer transition-all hover:bg-white/4"
                    style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-4 py-3"><VerdictBadge verdict={inv.verdict} /></td>
                    <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: 'var(--info)' }}>{inv.id}</td>
                    <td className="px-4 py-3 text-[13px] text-white/70 max-w-[160px] truncate">{inv.triggerReason}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{inv.attackClass}</td>
                    <td className="px-4 py-3 font-mono-data text-[13px] font-bold" style={{ color: 'var(--gold)' }}>{inv.confidence.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-mono-data text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{inv.rounds}</span>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={inv.status} /></td>
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-1 text-[12px] px-3 py-1 rounded-[6px] transition-all hover:bg-violet-500/20" style={{ color: 'var(--violet)' }}>
                        View <ArrowRight size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span>Showing {filtered.length} of {INVESTIGATIONS.length} results</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} className="p-1.5 rounded-[6px] hover:bg-white/5 transition-colors disabled:opacity-30" disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              {[1, 2, 3].map(p => (
                <button key={p} onClick={() => setPage(p)} className="w-7 h-7 rounded-[6px] text-center text-[12px] transition-all"
                  style={{ background: page === p ? 'var(--violet)' : 'var(--elevated)', color: page === p ? 'white' : 'rgba(255,255,255,0.5)' }}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(3, p + 1))} className="p-1.5 rounded-[6px] hover:bg-white/5 transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Donut chart */}
        <div className="col-span-3">
          <div className="rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="font-display font-semibold text-white mb-4" style={{ fontSize: '15px' }}>By Attack Class</div>
            <DonutChart data={donutData} />
          </div>
        </div>
      </div>
    </div>
  )
}
