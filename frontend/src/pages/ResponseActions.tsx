import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import type { NavigateFn } from '../types'
import { listResponseActions, type ResponseActionEntry } from '../api/client'

export default function ResponseActions({ navigate: _navigate }: { navigate: NavigateFn }) {
  const [actions, setActions] = useState<ResponseActionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listResponseActions()
      .then(setActions)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load response actions'))
      .finally(() => setLoading(false))
  }, [])

  const byType = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.action_type] = (acc[a.action_type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Response Actions</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {loading ? 'Loading…' : `${actions.length} sandboxed containment action(s) across all investigations`}
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>{error}</div>
      )}

      {Object.keys(byType).length > 0 && (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${Object.keys(byType).length}, 1fr)` }}>
          {Object.entries(byType).map(([type, count]) => (
            <div key={type} className="rounded-[10px] px-5 py-4 flex items-center justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{type.replace(/_/g, ' ')}</div>
              <div className="font-display font-bold text-[28px]" style={{ color: 'var(--violet)' }}>{count}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] mb-5" style={{ background: 'rgba(247,144,9,0.05)', border: '1px solid rgba(247,144,9,0.15)' }}>
        <Zap size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
          <strong style={{ color: 'rgba(255,255,255,0.85)' }}>All actions executed in a sandboxed environment</strong> — structurally incapable of reaching a real system (backend/self_healing/sandbox.py has zero networking code). Each action is logged in the immutable audit trail.
        </span>
      </div>

      <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
              {['Timestamp', 'Action', 'Target', 'Reason', 'Simulated'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && actions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No response actions triggered yet.</td></tr>
            )}
            {actions.map((action, i) => (
              <tr key={i} className="hover:bg-white/3 transition-colors" style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-3 font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                  {new Date(action.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: '#F04438', color: 'white' }}>SH</div>
                    <span className="text-[13px] text-white">{action.action_type}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: 'rgba(255,255,255,0.65)', maxWidth: '180px' }}>
                  <div className="truncate">{action.target}</div>
                </td>
                <td className="px-4 py-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.55)', maxWidth: '320px' }}>
                  <div className="truncate">{action.reason}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
                    {action.is_simulated ? 'Simulated' : 'Real'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
