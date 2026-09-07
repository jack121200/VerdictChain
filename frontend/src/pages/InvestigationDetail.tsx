import { useState } from 'react'
import { Shield, Copy, ArrowLeft, CheckCircle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from 'recharts'
import type { NavigateFn, AddToastFn } from '../types'
import { INVESTIGATIONS, AGENTS, DEBATE_MESSAGES, RESPONSE_ACTIONS, TRUST_LOG_DATA, RAW_EVIDENCE_LINES } from '../data/mock'

const inv = INVESTIGATIONS[0]

const VerdictBadge = () => (
  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold" style={{ background: 'rgba(240,68,56,0.15)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.3)' }}>
    <svg width="9" height="9" viewBox="0 0 9 9"><path d="M4.5 0L9 9H0L4.5 0Z" fill="currentColor"/></svg>
    INSIDER THREAT
  </span>
)

const AgentChip = ({ agentId, onClick }: { agentId: string; onClick?: () => void }) => {
  const agent = AGENTS.find(a => a.id === agentId)!
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[12px] font-semibold transition-all hover:opacity-80"
    >
      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: agent.color, color: '#0A0A0F' }}>
        {agent.monogram}
      </span>
      <span style={{ color: agent.color }}>{agent.name}</span>
    </button>
  )
}

const VerifiedSeal = () => (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ml-2" style={{ background: 'rgba(54,191,250,0.12)', color: 'var(--info)', border: '1px solid rgba(54,191,250,0.2)' }}>
    <Shield size={9} />VERIFIED
  </span>
)

const ConfidenceChip = ({ value }: { value: number }) => (
  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold font-mono-data" style={{
    background: value >= 0.7 ? 'rgba(240,68,56,0.1)' : value >= 0.5 ? 'rgba(247,144,9,0.1)' : 'rgba(54,191,250,0.1)',
    color: value >= 0.7 ? 'var(--critical)' : value >= 0.5 ? 'var(--warning)' : 'var(--info)',
    border: `1px solid ${value >= 0.7 ? 'rgba(240,68,56,0.2)' : value >= 0.5 ? 'rgba(247,144,9,0.2)' : 'rgba(54,191,250,0.2)'}`,
  }}>
    {value.toFixed(2)}
  </span>
)

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
            <span className="text-white/70">{p.name}:</span>
            <span className="font-bold font-mono-data text-white">{p.value?.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

const TABS = ['Report', 'Debate Transcript', 'Trust Log', 'Response Actions', 'Raw Evidence']

export default function InvestigationDetail({ navigate, addToast, investigationId }: { navigate: NavigateFn; addToast: AddToastFn; investigationId: string }) {
  const [activeTab, setActiveTab] = useState(0)
  const [copied, setCopied] = useState(false)

  const confirmVerdict = () => {
    addToast('Verdict confirmed — INV-0231 marked as validated by analyst', 'success')
  }

  const markFalsePositive = () => {
    addToast('Marked as false positive — investigation closed', 'info')
  }

  const exportReport = () => {
    addToast('Report exported as PDF — VerdictChain-INV-0231.pdf', 'success')
  }

  const copyLogs = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const roundMessages = (round: number) => DEBATE_MESSAGES.filter(m => m.round === round)

  return (
    <div className="max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="px-8 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => navigate('investigations')}
          className="flex items-center gap-1.5 text-[12px] mb-4 hover:text-white transition-colors"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          <ArrowLeft size={13} /> Back to Investigations
        </button>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono-data text-[18px] font-bold" style={{ color: 'var(--info)' }}>{inv.id}</span>
            <VerdictBadge />
            <div>
              <div className="text-[13px] text-white/60">{inv.triggerReason}</div>
              <div className="font-mono-data text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{inv.timestamp} · {inv.host} · {inv.ip}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Verdict Seal */}
      <div className="px-8 py-5">
        <div className="card-gold-hairline rounded-[10px] p-6 flex items-center justify-between" style={{ background: 'rgba(240,180,41,0.05)', border: '1px solid rgba(240,180,41,0.25)' }}>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'var(--gold)' }}>Final Verdict</div>
            <div className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>INSIDER THREAT</div>
            <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {inv.triggerReason} · {inv.host} · <span className="font-mono-data">{inv.username}</span>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-[12px] font-medium px-2 py-1 rounded-[6px]" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.2)' }}>
                {inv.mitreId} — {inv.mitreName}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-1" style={{ color: 'var(--gold)' }}>Confidence</div>
            <div className="font-display font-bold" style={{ fontSize: '48px', lineHeight: '56px', color: 'var(--gold)' }}>{inv.confidence.toFixed(2)}</div>
            <div className="text-[12px] font-semibold mt-1" style={{ color: 'var(--gold)' }}>HIGH CONFIDENCE</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex gap-0">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className="px-4 py-3 text-[13px] font-medium transition-all relative"
              style={{
                color: activeTab === i ? 'var(--violet)' : 'rgba(255,255,255,0.45)',
                borderBottom: activeTab === i ? '2px solid var(--violet)' : '2px solid transparent',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-8 py-6">
        {/* REPORT TAB */}
        {activeTab === 0 && (
          <div className="max-w-3xl space-y-6">
            {/* Summary */}
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="font-display font-semibold text-white mb-3" style={{ fontSize: '17px' }}>Executive Summary</div>
              <p className="text-[14px] leading-[22px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                On 2026-09-05 at 02:31 UTC, user <span className="font-mono-data" style={{ color: 'var(--info)' }}>j.sharma</span> (IT-Support, UID 1042) authenticated to <span className="font-mono-data" style={{ color: 'var(--info)' }}>WINSRV-DC01</span> using a valid Kerberos ticket and accessed 23 files under <span className="font-mono-data" style={{ color: 'var(--info)' }}>/shares/Finance/</span>, a department boundary they have no authorized access to. A total of 2.3 GB was staged via <span className="font-mono-data" style={{ color: 'var(--info)' }}>robocopy.exe</span> to the Finance NAS. Activity occurred outside business hours. Three investigator agents debated the evidence across three rounds; the Watchdog assigned a weighted confidence of 0.85. Containment was executed automatically.
              </p>
            </div>

            {/* Attack classification */}
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-[13px]">
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Attack Class</div><div className="text-white">Insider Threat</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Affected Host</div><div className="font-mono-data" style={{ color: 'var(--info)' }}>WIN11-VICTIM-01 (10.20.14.22)</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>User Account</div><div className="font-mono-data" style={{ color: 'var(--info)' }}>j.sharma (UID 1042)</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>MITRE Technique</div>
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[12px] font-medium" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.2)' }}>
                    {inv.mitreId} — {inv.mitreName}
                  </div>
                </div>
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Debate Rounds</div><div className="text-white">3 of 3</div></div>
                <div><div className="text-[11px] uppercase tracking-[0.4px] mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Data Transferred</div><div className="font-mono-data text-white">2.3 GB (23 files)</div></div>
              </div>
            </div>

            {/* Key Evidence */}
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="font-display font-semibold text-white mb-4" style={{ fontSize: '17px' }}>Key Evidence</div>
              <ul className="space-y-3">
                {[
                  { line: 'winevt_security.log:2026-09-05T02:31:44Z EventID=4624 j.sharma WINSRV-DC01 LogonType=3 KerberosTicket=VALID', note: 'Off-hours authentication with valid Kerberos ticket' },
                  { line: 'winevt_object.log:2026-09-05T02:31:51Z EventID=4663 j.sharma READ /shares/Finance/Q3-Projections.xlsx', note: 'Cross-department file access — Finance boundary violation' },
                  { line: 'sysmon_proc.log:2026-09-05T02:33:18Z PID=4431 robocopy.exe args="/MIR \\\\WINSRV-DC01\\Finance\\ \\\\WINSRV-NAS01\\staging$\\"', note: 'Bulk staging via robocopy — not in IT-Support baseline' },
                  { line: 'hr_roles.db:UID=1042 j.sharma dept=IT-Support(04) finance_access=FALSE', note: 'No authorization for Finance share access' },
                ].map((ev, i) => (
                  <li key={i} className="rounded-[8px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <div className="px-4 py-2.5 font-mono-data text-[11px] leading-snug" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.75)', wordBreak: 'break-all' }}>
                      {ev.line}
                      <VerifiedSeal />
                    </div>
                    <div className="px-4 py-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{ev.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* DEBATE TRANSCRIPT TAB */}
        {activeTab === 1 && (
          <div className="max-w-3xl space-y-8">
            {[1, 2, 3].map(round => (
              <div key={round}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.4px] px-3 py-1 rounded-full" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
                    Round {round} of 3 — {round === 1 ? 'Initial Positions' : round === 2 ? 'Rebuttals' : 'Final Positions'}
                  </span>
                  <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                </div>
                <div className="space-y-3">
                  {roundMessages(round).map((msg, i) => {
                    const agent = AGENTS.find(a => a.id === msg.agentId)!
                    const isRebuttal = !!msg.rebuttalTo
                    return (
                      <div key={i} className={`${isRebuttal ? 'ml-8' : ''}`}>
                        {isRebuttal && (
                          <div className="flex items-center gap-2 mb-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            <div className="w-px h-3" style={{ background: 'var(--violet)', opacity: 0.4 }} />
                            Rebuttal
                          </div>
                        )}
                        <div
                          className={`rounded-[10px] p-4 ${isRebuttal ? 'card-violet-hairline' : ''}`}
                          style={{ background: 'var(--surface)', border: `1px solid ${isRebuttal ? 'rgba(139,92,246,0.2)' : 'var(--border)'}` }}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                                {agent.monogram}
                              </div>
                              <span className="text-[13px] font-semibold" style={{ color: agent.color }}>{agent.name}</span>
                            </div>
                            <ConfidenceChip value={msg.confidence} />
                          </div>
                          {/* Claim */}
                          <p className="text-[13px] leading-[20px] mb-3" style={{ color: 'rgba(255,255,255,0.75)' }}>{msg.claim}</p>
                          {/* Evidence */}
                          {msg.evidence.length > 0 && (
                            <div className="space-y-1.5">
                              {msg.evidence.map((ev, j) => (
                                <div key={j} className="flex items-start gap-2">
                                  <Shield size={11} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--info)' }} />
                                  <span className="font-mono-data text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.55)', wordBreak: 'break-all' }}>{ev}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Verdict block */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1" style={{ background: 'var(--gold)', opacity: 0.3 }} />
                <span className="text-[11px] font-bold uppercase tracking-[0.4px] px-3 py-1 rounded-full" style={{ background: 'rgba(240,180,41,0.1)', color: 'var(--gold)', border: '1px solid rgba(240,180,41,0.3)' }}>
                  Verdict
                </span>
                <div className="h-px flex-1" style={{ background: 'var(--gold)', opacity: 0.3 }} />
              </div>
              <div className="card-gold-hairline rounded-[10px] p-5" style={{ background: 'rgba(240,180,41,0.05)', border: '1px solid rgba(240,180,41,0.25)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: '#F0B429', color: '#0A0A0F' }}>WD</div>
                  <span className="text-[13px] font-semibold" style={{ color: '#F0B429' }}>Watchdog / Trust Agent</span>
                  <span className="ml-auto font-mono-data text-[14px] font-bold" style={{ color: 'var(--gold)' }}>0.85</span>
                </div>
                <p className="text-[13px] leading-[20px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  Evidence convergence across NT (0.82) and AL (0.91) establishes unauthorized cross-department file access by <span className="font-mono-data" style={{ color: 'var(--info)' }}>j.sharma</span> using valid credentials outside authorized hours. EB credibility reduced to 0.18 following verified misclassification of internal NAS as external exfiltration destination — EB isolated, backup agent activated. Weighted consensus confidence: <strong style={{ color: 'var(--gold)' }}>0.85</strong>. Classification: <strong style={{ color: 'var(--violet)' }}>T1078 — Valid Accounts (insider misuse)</strong>. Self-Healing response triggered.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TRUST LOG TAB */}
        {activeTab === 2 && (
          <div className="space-y-6">
            {/* Chart */}
            <div className="rounded-[10px] p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-display font-semibold text-white" style={{ fontSize: '17px' }}>Credibility Score Trajectory</div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>INV-0231 · Rounds 0–3 · Threshold: 0.30</div>
                </div>
                <div className="flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-[8px]" style={{ background: 'rgba(240,68,56,0.1)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
                  <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 0L8 8H0L4 0Z" fill="currentColor"/></svg>
                  EB isolated at R3 — backup activated
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={TRUST_LOG_DATA} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis dataKey="round" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 1]} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickCount={6} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0.30} stroke="#F04438" strokeDasharray="5 4" strokeWidth={1.5} label={{ value: 'Isolation threshold (0.30)', position: 'insideTopRight', fill: 'rgba(240,68,56,0.7)', fontSize: 10 }} />
                  {AGENTS.map(agent => (
                    <Line
                      key={agent.id}
                      type="monotone"
                      dataKey={agent.id}
                      name={agent.name}
                      stroke={agent.color}
                      strokeWidth={agent.id === 'EB' ? 2.5 : 2}
                      dot={{ r: 4, fill: agent.color, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: agent.color }}
                      strokeDasharray={agent.id === 'EB' && TRUST_LOG_DATA.at(-1)?.[agent.id as keyof typeof TRUST_LOG_DATA[0]] as number < 0.30 ? '5 3' : undefined}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Per-agent table */}
            <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                    {['Agent', 'Starting CrS', 'Final CrS', 'Δ Delta', 'Verified Claims', 'Failed Claims', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 'NT', start: 0.88, end: 0.88, verified: 4, failed: 0, status: 'online' },
                    { id: 'AL', start: 0.82, end: 0.83, verified: 5, failed: 0, status: 'online' },
                    { id: 'EB', start: 0.91, end: 0.18, verified: 2, failed: 2, status: 'isolated' },
                    { id: 'WD', start: 0.95, end: 0.95, verified: 6, failed: 0, status: 'online' },
                    { id: 'SH', start: 0.87, end: 0.91, verified: 3, failed: 0, status: 'online' },
                  ].map((row, i) => {
                    const agent = AGENTS.find(a => a.id === row.id)!
                    const delta = row.end - row.start
                    const isolated = row.status === 'isolated'
                    return (
                      <tr key={row.id} style={{ background: isolated ? 'rgba(240,68,56,0.04)' : i % 2 === 0 ? 'var(--surface)' : 'rgba(20,20,31,0.5)', borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>{agent.monogram}</div>
                            <span className="text-[13px] font-medium" style={{ color: agent.color }}>{agent.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-data text-[12px] text-white/60">{row.start.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono-data text-[12px] font-bold" style={{ color: isolated ? 'var(--critical)' : 'white' }}>{row.end.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono-data text-[12px]" style={{ color: delta < 0 ? 'var(--critical)' : delta > 0 ? 'var(--safe)' : 'rgba(255,255,255,0.4)' }}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--safe)' }}>{row.verified}</td>
                        <td className="px-4 py-3 text-[13px]" style={{ color: row.failed > 0 ? 'var(--critical)' : 'rgba(255,255,255,0.4)' }}>{row.failed}</td>
                        <td className="px-4 py-3">
                          {isolated ? (
                            <span className="px-2 py-1 rounded-full text-[10px] font-bold" style={{ background: 'rgba(240,68,56,0.15)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.25)' }}>
                              ISOLATED — backup activated
                            </span>
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

        {/* RESPONSE ACTIONS TAB */}
        {activeTab === 3 && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-2" style={{ background: 'rgba(240,68,56,0.05)', border: '1px solid rgba(240,68,56,0.15)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" style={{ color: 'var(--warning)', flexShrink: 0 }}><circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M7 4v4M7 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <strong style={{ color: 'rgba(255,255,255,0.85)' }}>All actions executed in an isolated simulated environment.</strong> No production systems were modified.
              </span>
            </div>

            {/* Timeline */}
            <div className="relative pl-8">
              <div className="absolute left-3.5 top-0 bottom-0 w-px" style={{ background: 'var(--border)' }} />
              {RESPONSE_ACTIONS.filter(a => a.investigationId === 'INV-0231').map((action, i) => {
                const shAgent = AGENTS.find(a => a.id === 'SH')!
                return (
                  <div key={action.id} className="relative mb-4">
                    <div className="absolute left-[-19px] top-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--surface)', border: '2px solid var(--critical)' }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--critical)' }} />
                    </div>
                    <div className="rounded-[10px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: shAgent.color, color: '#0A0A0F' }}>SH</div>
                          <span className="text-[13px] font-semibold text-white">{action.action}</span>
                        </div>
                        <span className="font-mono-data text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{action.timestamp}</span>
                      </div>
                      <div className="font-mono-data text-[11px] mb-2" style={{ color: 'var(--info)' }}>{action.target}</div>
                      <div className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.55)' }}>{action.reason}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* RAW EVIDENCE TAB */}
        {activeTab === 4 && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex gap-2">
                {['All', 'zeek', 'win-evtx', 'sysmon', 'anomaly'].map(f => (
                  <button key={f} className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-all" style={{ background: f === 'All' ? 'var(--violet)' : 'var(--elevated)', color: f === 'All' ? 'white' : 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
                    {f}
                  </button>
                ))}
              </div>
              <button
                onClick={copyLogs}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all hover:opacity-80"
                style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.6)', border: '1px solid var(--border)' }}
              >
                {copied ? <CheckCircle size={13} style={{ color: 'var(--safe)' }} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>
            <div className="rounded-[10px] p-5 overflow-x-auto" style={{ background: '#0D0D14', border: '1px solid var(--border)' }}>
              {RAW_EVIDENCE_LINES.map((line, i) => {
                const type = line.match(/\[(\w+)\]/)?.[1] || ''
                const color = type === 'zeek' ? 'var(--info)' : type === 'win-evtx' ? 'var(--violet)' : type === 'sysmon' ? 'var(--safe)' : type === 'anomaly' ? 'var(--warning)' : 'rgba(255,255,255,0.6)'
                return (
                  <div key={i} className="flex gap-3 py-1 hover:bg-white/2 px-2 rounded">
                    <span className="font-mono-data text-[11px] select-none" style={{ color: 'rgba(255,255,255,0.2)', minWidth: '24px' }}>{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-mono-data text-[11px] leading-relaxed" style={{ color, wordBreak: 'break-all' }}>{line}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-10 mx-8 mb-2 flex items-center gap-3 px-5 py-3 rounded-[10px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
        <div className="flex-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          INV-0231 · Verdict: <strong style={{ color: 'var(--critical)' }}>INSIDER THREAT</strong> · Confidence: <strong style={{ color: 'var(--gold)' }}>0.85</strong>
        </div>
        <button onClick={confirmVerdict} className="px-5 py-2 rounded-[10px] text-[13px] font-semibold text-white transition-all hover:opacity-90" style={{ background: 'var(--violet)' }}>
          Confirm Verdict
        </button>
        <button onClick={markFalsePositive} className="px-5 py-2 rounded-[10px] text-[13px] font-medium transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid var(--border)' }}>
          Mark False Positive
        </button>
        <button onClick={exportReport} className="px-5 py-2 rounded-[10px] text-[13px] font-medium transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
          Export Report
        </button>
      </div>
    </div>
  )
}
