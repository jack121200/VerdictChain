import { Zap, RotateCcw } from 'lucide-react'
import type { NavigateFn } from '../types'
import { RESPONSE_ACTIONS, AGENTS } from '../data/mock'

export default function ResponseActions({ navigate }: { navigate: NavigateFn }) {
  const sh = AGENTS.find(a => a.id === 'SH')!
  const stats = [
    { label: 'Actions Today', value: '12', color: 'var(--violet)' },
    { label: 'Auto-Contained', value: '9', color: 'var(--critical)' },
    { label: 'Pending Review', value: '2', color: 'var(--warning)' },
    { label: 'Reverted', value: '1', color: 'var(--safe)' },
  ]

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Response Actions</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>All automated containment actions across all investigations</p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => (
          <div key={i} className="rounded-[10px] px-5 py-4 flex items-center justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.label}</div>
            <div className="font-display font-bold text-[28px]" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Isolation notice */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] mb-5" style={{ background: 'rgba(247,144,9,0.05)', border: '1px solid rgba(247,144,9,0.15)' }}>
        <Zap size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
          <strong style={{ color: 'rgba(255,255,255,0.85)' }}>All actions executed in an isolated simulated environment.</strong> No production systems were modified. Each action is logged in the immutable audit trail.
        </span>
      </div>

      {/* Table */}
      <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
              {['Timestamp', 'Investigation', 'Action', 'Target', 'Confidence', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESPONSE_ACTIONS.map((action, i) => (
              <tr key={action.id} className="hover:bg-white/3 transition-colors" style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-3 font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                  {action.timestamp}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => navigate('investigation-detail', action.investigationId)} className="font-mono-data text-[12px] transition-colors hover:text-white" style={{ color: 'var(--info)' }}>
                    {action.investigationId}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: sh.color, color: '#0A0A0F' }}>SH</div>
                    <span className="text-[13px] text-white">{action.action}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: 'rgba(255,255,255,0.65)', maxWidth: '180px' }}>
                  <div className="truncate">{action.target}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono-data text-[12px] font-bold" style={{ color: action.triggeredByConfidence >= 0.7 ? 'var(--gold)' : 'var(--warning)' }}>
                    {action.triggeredByConfidence.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {action.status === 'Executed' && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>Executed</span>
                  )}
                  {action.status === 'Reverted' && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(54,191,250,0.1)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>Reverted</span>
                  )}
                  {action.status === 'Pending' && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(247,144,9,0.1)', color: 'var(--warning)', border: '1px solid rgba(247,144,9,0.2)' }}>Pending</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {action.status !== 'Reverted' && (
                    <button className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-[6px] transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid var(--border)' }}>
                      <RotateCcw size={11} /> Revert
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
