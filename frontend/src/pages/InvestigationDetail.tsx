import { useEffect, useState } from 'react'
import { Shield, ArrowLeft } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import type { NavigateFn, AddToastFn } from '../types'
import { getInvestigation, submitFeedback, type InvestigationDetail as InvestigationDetailData } from '../api/client'

const AGENT_COLORS: Record<string, string> = { network_traffic: '#36BFFA', access_log: '#8B5CF6', endpoint_behavior: '#12B76A' }
const AGENT_MONOGRAMS: Record<string, string> = { network_traffic: 'NT', access_log: 'AL', endpoint_behavior: 'EB' }
const AGENT_NAMES: Record<string, string> = { network_traffic: 'Network-Traffic Agent', access_log: 'Access-Log Agent', endpoint_behavior: 'Endpoint-Behavior Agent' }

const ConfidenceChip = ({ value }: { value: number }) => (
  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold font-mono-data" style={{
    background: value >= 0.7 ? 'rgba(240,68,56,0.1)' : value >= 0.5 ? 'rgba(247,144,9,0.1)' : 'rgba(54,191,250,0.1)',
    color: value >= 0.7 ? 'var(--critical)' : value >= 0.5 ? 'var(--warning)' : 'var(--info)',
    border: `1px solid ${value >= 0.7 ? 'rgba(240,68,56,0.2)' : value >= 0.5 ? 'rgba(247,144,9,0.2)' : 'rgba(54,191,250,0.2)'}`,
  }}>
    {value.toFixed(2)}
  </span>
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-[8px] text-[12px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
      <div className="text-white/60 mb-1.5">Round {label}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ background: AGENT_COLORS[p.dataKey] }} />
          <span className="text-white/70">{AGENT_NAMES[p.dataKey]?.split(' ')[0]}:</span>
          <span className="font-bold font-mono-data text-white">{p.value?.toFixed(3)}</span>
        </div>
      ))}
    </div>
  )
}

const TABS = ['Report', 'Debate Transcript', 'Trust Log', 'Response Actions']

export default function InvestigationDetail({ navigate, addToast, investigationId }: { navigate: NavigateFn; addToast: AddToastFn; investigationId: string }) {
  const [activeTab, setActiveTab] = useState(0)
  const [data, setData] = useState<InvestigationDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!investigationId) return
    setLoading(true)
    getInvestigation(investigationId)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load investigation'))
      .finally(() => setLoading(false))
  }, [investigationId])

  const confirmVerdict = async () => {
    if (!data) return
    await submitFeedback(data.investigation_id, true)
    addToast(`Verdict confirmed — ${data.investigation_id} marked correct by analyst`, 'success')
  }

  const markFalsePositive = async () => {
    if (!data) return
    await submitFeedback(data.investigation_id, false)
    addToast(`Marked as false positive — ${data.investigation_id}`, 'info')
  }

  if (!investigationId) {
    return <div className="px-8 py-6 text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>No investigation selected.</div>
  }
  if (loading) {
    return <div className="px-8 py-6 text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Loading investigation…</div>
  }
  if (error || !data) {
    return <div className="px-8 py-6 text-[13px]" style={{ color: 'var(--critical)' }}>{error || 'Investigation not found'}</div>
  }

  const roundMessages = (round: number) => data.debate.filter(m => m.round === round)
  const trustData = [1, 2, 3].map(round => {
    const row: Record<string, number> = { round }
    for (const c of data.credibility.filter(c => c.round === round)) row[c.agent_id] = c.crs_after
    return row
  })
  const perAgentSummary = Object.keys(AGENT_NAMES).map(agentId => {
    const logs = data.credibility.filter(c => c.agent_id === agentId)
    const first = logs[0]
    const last = logs[logs.length - 1]
    const verified = logs.filter(l => l.verification_match_rate >= 0.5).length
    const failed = logs.filter(l => l.verification_match_rate < 0.5).length
    return { agentId, start: first?.crs_before ?? 0.5, end: last?.crs_after ?? 0.5, isolated: logs.some(l => l.isolated), verified, failed }
  })

  const verdictClass = data.verdict_class ?? 'pending'
  const confidence = data.verdict_confidence ?? 0

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="px-8 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => navigate('investigations')} className="flex items-center gap-1.5 text-[12px] mb-4 hover:text-white transition-colors" style={{ color: 'rgba(255,255,255,0.45)' }}>
          <ArrowLeft size={13} /> Back to Investigations
        </button>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="font-mono-data text-[16px] font-bold" style={{ color: 'var(--info)' }}>{data.investigation_id.slice(0, 8)}</span>
          <span className="px-3 py-1.5 rounded-full text-[12px] font-bold" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.3)' }}>
            {verdictClass.toUpperCase()}
          </span>
          <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{data.status} · {new Date(data.created_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="px-8 py-5">
        <div className="card-gold-hairline rounded-[10px] p-6 flex items-center justify-between" style={{ background: 'rgba(240,180,41,0.05)', border: '1px solid rgba(240,180,41,0.25)' }}>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'var(--gold)' }}>Final Verdict</div>
            <div className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>{verdictClass}</div>
            <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{data.trigger_type} trigger · {data.status}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-1" style={{ color: 'var(--gold)' }}>Confidence</div>
            <div className="font-display font-bold" style={{ fontSize: '48px', lineHeight: '56px', color: 'var(--gold)' }}>{confidence.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="px-8" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex gap-0">
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)} className="px-4 py-3 text-[13px] font-medium transition-all relative"
              style={{ color: activeTab === i ? 'var(--violet)' : 'rgba(255,255,255,0.45)', borderBottom: activeTab === i ? '2px solid var(--violet)' : '2px solid transparent' }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6">
        {activeTab === 0 && (
          <div className="max-w-3xl space-y-6">
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="font-display font-semibold text-white mb-3" style={{ fontSize: '17px' }}>Executive Summary</div>
              <p className="text-[14px] leading-[22px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Investigation <span className="font-mono-data" style={{ color: 'var(--info)' }}>{data.investigation_id}</span> ({data.trigger_type} trigger)
                completed {data.debate.length > 0 ? Math.max(...data.debate.map(d => d.round)) : 0} debate round(s) across{' '}
                {new Set(data.debate.map(d => d.agent_id)).size} investigator agent(s). Final verdict:{' '}
                <strong style={{ color: 'var(--gold)' }}>{verdictClass}</strong> at confidence <strong style={{ color: 'var(--gold)' }}>{confidence.toFixed(2)}</strong>.
                {data.actions.length > 0 && ` ${data.actions.length} sandboxed containment action(s) were triggered.`}
              </p>
            </div>

            {data.debate.length > 0 && (
              <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="font-display font-semibold text-white mb-4" style={{ fontSize: '17px' }}>Key Evidence (Round 3 citations)</div>
                <ul className="space-y-3">
                  {roundMessages(3).flatMap(m => m.cited_evidence).slice(0, 6).map((ev, i) => (
                    <li key={i} className="rounded-[8px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                      <div className="px-4 py-2.5 font-mono-data text-[11px] leading-snug" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.75)', wordBreak: 'break-all' }}>
                        row_id={ev.row_id} · {ev.field}={ev.value}
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ml-2" style={{ background: 'rgba(54,191,250,0.12)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>
                          <Shield size={9} />VERIFIED
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 1 && (
          <div className="max-w-3xl space-y-8">
            {data.debate.length === 0 && <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No debate transcript recorded for this investigation.</div>}
            {[1, 2, 3].map(round => {
              const msgs = roundMessages(round)
              if (msgs.length === 0) return null
              return (
                <div key={round}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.4px] px-3 py-1 rounded-full" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
                      Round {round} of 3
                    </span>
                    <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  </div>
                  <div className="space-y-3">
                    {msgs.map((msg, i) => (
                      <div key={i} className="rounded-[10px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: AGENT_COLORS[msg.agent_id], color: '#0A0A0F' }}>
                              {AGENT_MONOGRAMS[msg.agent_id]}
                            </div>
                            <span className="text-[13px] font-semibold" style={{ color: AGENT_COLORS[msg.agent_id] }}>{AGENT_NAMES[msg.agent_id]}</span>
                          </div>
                          <ConfidenceChip value={msg.confidence} />
                        </div>
                        <p className="text-[13px] leading-[20px] mb-3" style={{ color: 'rgba(255,255,255,0.75)' }}>{msg.theory}</p>
                        <div className="space-y-1.5">
                          {msg.cited_evidence.map((ev, j) => (
                            <div key={j} className="flex items-start gap-2">
                              <Shield size={11} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--info)' }} />
                              <span className="font-mono-data text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.55)', wordBreak: 'break-all' }}>
                                row_id={ev.row_id} {ev.field}={ev.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 2 && (
          <div className="space-y-6">
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="font-display font-semibold text-white mb-4" style={{ fontSize: '17px' }}>Credibility Score Trajectory</div>
              {trustData.length === 0 ? (
                <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No credibility data for this investigation.</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trustData} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                    <XAxis dataKey="round" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 1]} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickCount={6} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0.30} stroke="#F04438" strokeDasharray="5 4" strokeWidth={1.5} label={{ value: 'Isolation threshold', position: 'insideTopRight', fill: 'rgba(240,68,56,0.7)', fontSize: 10 }} />
                    {Object.keys(AGENT_NAMES).map(agentId => (
                      <Line key={agentId} type="monotone" dataKey={agentId} stroke={AGENT_COLORS[agentId]} strokeWidth={2} dot={{ r: 4, fill: AGENT_COLORS[agentId], strokeWidth: 0 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                    {['Agent', 'Starting CrS', 'Final CrS', 'Δ', 'Verified rounds', 'Failed rounds', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perAgentSummary.map((row, i) => {
                    const delta = row.end - row.start
                    return (
                      <tr key={row.agentId} style={{ background: row.isolated ? 'rgba(240,68,56,0.04)' : i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: AGENT_COLORS[row.agentId], color: '#0A0A0F' }}>{AGENT_MONOGRAMS[row.agentId]}</div>
                            <span className="text-[13px] font-medium" style={{ color: AGENT_COLORS[row.agentId] }}>{AGENT_NAMES[row.agentId]}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-data text-[12px] text-white/60">{row.start.toFixed(3)}</td>
                        <td className="px-4 py-3 font-mono-data text-[12px] font-bold" style={{ color: row.isolated ? 'var(--critical)' : 'white' }}>{row.end.toFixed(3)}</td>
                        <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: delta < 0 ? 'var(--critical)' : delta > 0 ? 'var(--safe)' : 'rgba(255,255,255,0.4)' }}>{delta > 0 ? '+' : ''}{delta.toFixed(3)}</td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--safe)' }}>{row.verified}</td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: row.failed > 0 ? 'var(--critical)' : 'rgba(255,255,255,0.4)' }}>{row.failed}</td>
                        <td className="px-4 py-3">
                          {row.isolated ? (
                            <span className="px-2 py-1 rounded-full text-[10px] font-bold" style={{ background: 'rgba(240,68,56,0.15)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.25)' }}>ISOLATED — reset</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-[10px] font-medium" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>TRUSTED</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 3 && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-2" style={{ background: 'rgba(240,68,56,0.05)', border: '1px solid rgba(240,68,56,0.15)' }}>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <strong style={{ color: 'rgba(255,255,255,0.85)' }}>All actions executed in a sandboxed environment.</strong> No production systems were modified.
              </span>
            </div>
            {data.actions.length === 0 && <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No response actions were triggered for this investigation.</div>}
            <div className="relative pl-8">
              <div className="absolute left-3.5 top-0 bottom-0 w-px" style={{ background: 'var(--border)' }} />
              {data.actions.map((action, i) => (
                <div key={i} className="relative mb-4">
                  <div className="absolute left-[-19px] top-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--surface)', border: '2px solid var(--critical)' }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--critical)' }} />
                  </div>
                  <div className="rounded-[10px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: '#F04438', color: 'white' }}>SH</div>
                        <span className="text-[13px] font-semibold text-white">{action.action_type}</span>
                      </div>
                      <span className="font-mono-data text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{new Date(action.created_at).toLocaleString()}</span>
                    </div>
                    <div className="font-mono-data text-[11px] mb-2" style={{ color: 'var(--info)' }}>{action.target}</div>
                    <div className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.55)' }}>{action.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-10 mx-8 mb-2 flex items-center gap-3 px-5 py-3 rounded-[10px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
        <div className="flex-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {data.investigation_id.slice(0, 8)} · Verdict: <strong style={{ color: 'var(--critical)' }}>{verdictClass}</strong> · Confidence: <strong style={{ color: 'var(--gold)' }}>{confidence.toFixed(2)}</strong>
        </div>
        <button onClick={confirmVerdict} className="px-5 py-2 rounded-[10px] text-[13px] font-semibold text-white transition-all hover:opacity-90" style={{ background: 'var(--violet)' }}>
          Confirm Verdict
        </button>
        <button onClick={markFalsePositive} className="px-5 py-2 rounded-[10px] text-[13px] font-medium transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid var(--border)' }}>
          Mark False Positive
        </button>
      </div>
    </div>
  )
}
