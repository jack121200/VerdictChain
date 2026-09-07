import { useState, useEffect, useRef } from 'react'
import { Radio, AlertTriangle } from 'lucide-react'
import type { NavigateFn } from '../types'
import { connectScenarioFeed, simulateScenario, type ScenarioLabel } from '../api/client'

const AGENT_COLORS: Record<string, string> = {
  network_traffic: '#36BFFA',
  access_log: '#8B5CF6',
  endpoint_behavior: '#12B76A',
}
const AGENT_MONOGRAMS: Record<string, string> = {
  network_traffic: 'NT',
  access_log: 'AL',
  endpoint_behavior: 'EB',
}
const AGENT_NAMES: Record<string, string> = {
  network_traffic: 'Network-Traffic',
  access_log: 'Access-Log',
  endpoint_behavior: 'Endpoint-Behavior',
}

interface RoundUpdate {
  type: 'round_update'
  round: number
  agent_id: string
  theory: string
  confidence: number
  provider: string
  credibility: { crs_before: number; crs_after: number; verification_match_rate: number; isolated: boolean }
}

interface VerdictMessage {
  type: 'verdict'
  verdict: { verdict_class: string; verdict_confidence: number; status: string }
  actions_taken: { action_type: string; target: string; reason: string | null }[]
}

interface ErrorMessage {
  type: 'error'
  detail: string
}

type LiveMessage = RoundUpdate | VerdictMessage | ErrorMessage

export default function DebateRoom({ navigate, scenarioLabel }: { navigate: NavigateFn; scenarioLabel: string }) {
  const [messages, setMessages] = useState<RoundUpdate[]>([])
  const [verdict, setVerdict] = useState<VerdictMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const triggered = useRef(false)

  useEffect(() => {
    if (!scenarioLabel) return
    setMessages([])
    setVerdict(null)
    setError(null)
    triggered.current = false

    const ws = connectScenarioFeed(scenarioLabel, raw => {
      const msg = raw as unknown as LiveMessage
      if (msg.type === 'round_update') setMessages(prev => [...prev, msg])
      else if (msg.type === 'verdict') setVerdict(msg)
      else if (msg.type === 'error') setError(msg.detail)
    })

    ws.onopen = () => {
      setConnected(true)
      // Subscribe first, THEN trigger - round 1's first push can arrive
      // before the HTTP response does (this is the actual real-time proof).
      if (!triggered.current) {
        triggered.current = true
        simulateScenario(scenarioLabel as ScenarioLabel, 3).catch(err => {
          setError(err instanceof Error ? err.message : 'Failed to trigger investigation')
        })
      }
    }
    ws.onclose = () => setConnected(false)

    return () => ws.close()
  }, [scenarioLabel])

  if (!scenarioLabel) {
    return (
      <div className="px-8 py-6 max-w-[1440px] mx-auto">
        <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          No active debate. Trigger a scenario from{' '}
          <button className="underline" style={{ color: 'var(--violet)' }} onClick={() => navigate('new-investigation')}>New Investigation</button>.
        </div>
      </div>
    )
  }

  const currentRound = verdict ? 4 : messages.length > 0 ? Math.max(...messages.map(m => m.round)) : 1
  const latestByAgent: Record<string, RoundUpdate> = {}
  for (const m of messages) latestByAgent[m.agent_id] = m

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Radio size={18} style={{ color: verdict ? 'rgba(255,255,255,0.3)' : 'var(--critical)' }} className={verdict ? '' : 'pulse-dot'} />
            <h1 className="font-display font-bold text-white" style={{ fontSize: '22px' }}>Debate Room</h1>
            {!verdict && (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold pulse-dot" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
                ● LIVE
              </span>
            )}
          </div>
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {scenarioLabel} · {connected ? 'connected' : 'connecting…'} · Round {Math.min(currentRound, 3)} of 3
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(r => (
            <div key={r} className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-all"
                style={{
                  background: r < currentRound ? 'rgba(18,183,106,0.2)' : r === currentRound ? 'var(--violet)' : 'var(--elevated)',
                  color: r < currentRound ? 'var(--safe)' : r === currentRound ? 'white' : 'rgba(255,255,255,0.3)',
                  border: `1px solid ${r < currentRound ? 'rgba(18,183,106,0.3)' : r === currentRound ? 'var(--violet)' : 'var(--border)'}`,
                }}>
                {r < currentRound ? '✓' : `R${r}`}
              </div>
              {r < 3 && <div className="w-6 h-px" style={{ background: r < currentRound ? 'var(--safe)' : 'var(--border)' }} />}
            </div>
          ))}
          <div className="ml-2 px-3 py-1.5 rounded-full text-[11px] font-medium"
            style={{
              background: verdict ? 'rgba(18,183,106,0.1)' : 'rgba(240,180,41,0.1)',
              color: verdict ? 'var(--safe)' : 'var(--gold)',
              border: `1px solid ${verdict ? 'rgba(18,183,106,0.2)' : 'rgba(240,180,41,0.2)'}`,
            }}>
            {verdict ? `Verdict: ${verdict.verdict.verdict_class} (${verdict.verdict.verdict_confidence.toFixed(2)})` : 'Verdict Pending'}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] mb-4 text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Agent Current Positions</div>
          {Object.keys(AGENT_NAMES).map(agentId => {
            const lastMsg = latestByAgent[agentId]
            const color = AGENT_COLORS[agentId]
            return (
              <div key={agentId} className="card-violet-hairline rounded-[10px] p-4" style={{ background: 'var(--surface)', border: `1px solid ${lastMsg ? `${color}30` : 'var(--border)'}` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: color, color: '#0A0A0F' }}>
                      {AGENT_MONOGRAMS[agentId]}
                    </div>
                    <span className="text-[13px] font-semibold" style={{ color }}>{AGENT_NAMES[agentId]}</span>
                  </div>
                  {lastMsg && <span className="font-mono-data text-[12px] font-bold" style={{ color: 'var(--gold)' }}>{lastMsg.confidence.toFixed(2)}</span>}
                </div>
                {lastMsg ? (
                  <>
                    <p className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>{lastMsg.theory.slice(0, 120)}{lastMsg.theory.length > 120 ? '…' : ''}</p>
                    <div className="text-[10px] mt-1.5 font-mono-data" style={{ color: lastMsg.credibility.isolated ? 'var(--critical)' : 'rgba(255,255,255,0.35)' }}>
                      CrS: {lastMsg.credibility.crs_after.toFixed(3)} {lastMsg.credibility.isolated && '(isolated → reset)'}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-3/4" />
                  </div>
                )}
                <div className="mt-3 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: lastMsg ? `${lastMsg.confidence * 100}%` : '0%', background: color }} />
                </div>
              </div>
            )
          })}

          <div className="rounded-[10px] p-4" style={{ background: 'rgba(240,180,41,0.05)', border: '1px solid rgba(240,180,41,0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: '#F0B429', color: '#0A0A0F' }}>WD</div>
              <span className="text-[12px] font-semibold" style={{ color: '#F0B429' }}>Watchdog</span>
              <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(247,144,9,0.1)', color: 'var(--warning)' }}>
                {verdict ? 'Complete' : 'Scoring live'}
              </span>
            </div>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Verifying every cited row against raw_logs after each round, updating credibility in real time.
            </p>
          </div>

          {verdict && verdict.actions_taken.length > 0 && (
            <div className="rounded-[10px] p-4" style={{ background: 'rgba(240,68,56,0.05)', border: '1px solid rgba(240,68,56,0.2)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: '#F04438', color: 'white' }}>SH</div>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--critical)' }}>Self-Healing fired</span>
              </div>
              {verdict.actions_taken.map((a, i) => (
                <div key={i} className="text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <span className="font-mono-data" style={{ color: 'var(--critical)' }}>{a.action_type}</span> → {a.target}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-8">
          <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Live Transcript</div>
          <div className="rounded-[10px] overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '500px' }}>
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--elevated)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: verdict ? 'var(--safe)' : 'var(--critical)' }} />
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {verdict ? 'Debate complete' : 'Messages streaming live'} · {scenarioLabel}
              </span>
            </div>
            <div className="p-4 space-y-3">
              {messages.length === 0 && !error && (
                <div className="flex items-center justify-center h-40 text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Waiting for agents to respond…
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className="stream-in flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5" style={{ background: AGENT_COLORS[msg.agent_id], color: '#0A0A0F' }}>
                    {AGENT_MONOGRAMS[msg.agent_id]}
                  </div>
                  <div className="flex-1 rounded-[10px] p-3" style={{ background: 'var(--elevated)', border: `1px solid ${AGENT_COLORS[msg.agent_id]}20` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[12px] font-semibold" style={{ color: AGENT_COLORS[msg.agent_id] }}>{AGENT_NAMES[msg.agent_id]}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-mono-data font-bold" style={{ background: 'rgba(240,180,41,0.1)', color: 'var(--gold)' }}>
                        {msg.confidence.toFixed(2)}
                      </span>
                      <span className="text-[10px] font-mono-data" style={{ color: 'rgba(255,255,255,0.3)' }}>via {msg.provider}</span>
                      <span className="ml-auto text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Round {msg.round}</span>
                    </div>
                    <p className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>{msg.theory}</p>
                  </div>
                </div>
              ))}
              {!verdict && !error && messages.length > 0 && (
                <div className="flex items-center gap-2 py-2">
                  <div className="skeleton h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-3/4" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
