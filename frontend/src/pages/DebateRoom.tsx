import { useState, useEffect } from 'react'
import { Radio } from 'lucide-react'
import type { NavigateFn } from '../types'
import { AGENTS, DEBATE_MESSAGES } from '../data/mock'

export default function DebateRoom({ navigate }: { navigate: NavigateFn }) {
  const [visibleMessages, setVisibleMessages] = useState<number[]>([])
  const [currentRound, setCurrentRound] = useState(1)

  useEffect(() => {
    const msgs = DEBATE_MESSAGES.filter(m => m.round <= 2)
    msgs.forEach((_, i) => {
      setTimeout(() => {
        setVisibleMessages(prev => prev.includes(i) ? prev : [...prev, i])
        if (i === 2) setCurrentRound(2)
      }, i * 1200 + 400)
    })
  }, [])

  const investigatorAgents = AGENTS.filter(a => ['NT', 'AL', 'EB'].includes(a.id))

  const lastMessages: Record<string, typeof DEBATE_MESSAGES[0] | undefined> = {}
  DEBATE_MESSAGES.filter((_, i) => visibleMessages.includes(i)).forEach(m => {
    lastMessages[m.agentId] = m
  })

  const shownMessages = DEBATE_MESSAGES.filter((_, i) => visibleMessages.includes(i))

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Radio size={18} style={{ color: 'var(--critical)' }} className="pulse-dot" />
            <h1 className="font-display font-bold text-white" style={{ fontSize: '22px' }}>Debate Room</h1>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold pulse-dot" style={{ background: 'rgba(240,68,56,0.12)', color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
              ● LIVE
            </span>
          </div>
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>INV-0229 · Unusual Data Exfiltration Volume · Round {currentRound} of 3</p>
        </div>
        {/* Round indicator */}
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
          <div className="ml-2 px-3 py-1.5 rounded-full text-[11px] font-medium" style={{ background: 'rgba(240,180,41,0.1)', color: 'var(--gold)', border: '1px solid rgba(240,180,41,0.2)' }}>
            Verdict Pending
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: Agent columns */}
        <div className="col-span-4 space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Agent Current Positions</div>
          {investigatorAgents.map(agent => {
            const lastMsg = lastMessages[agent.id]
            return (
              <div key={agent.id} className="card-violet-hairline rounded-[10px] p-4" style={{ background: 'var(--surface)', border: `1px solid ${lastMsg ? `${agent.color}30` : 'var(--border)'}` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                      {agent.monogram}
                    </div>
                    <span className="text-[13px] font-semibold" style={{ color: agent.color }}>{agent.name.split(' ')[0]}</span>
                  </div>
                  {lastMsg && (
                    <span className="font-mono-data text-[12px] font-bold" style={{ color: 'var(--gold)' }}>{lastMsg.confidence.toFixed(2)}</span>
                  )}
                </div>
                {lastMsg ? (
                  <p className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {lastMsg.claim.slice(0, 120)}...
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-3/4" />
                    <div className="skeleton h-3 w-1/2" />
                  </div>
                )}
                <div className="mt-3 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: lastMsg ? `${lastMsg.confidence * 100}%` : '0%', background: agent.color }} />
                </div>
              </div>
            )
          })}

          {/* WD Status */}
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(240,180,41,0.05)', border: '1px solid rgba(240,180,41,0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: '#F0B429', color: '#0A0A0F' }}>WD</div>
              <span className="text-[12px] font-semibold" style={{ color: '#F0B429' }}>Watchdog</span>
              <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(247,144,9,0.1)', color: 'var(--warning)' }}>Monitoring</span>
            </div>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Scoring credibility in real time. Watching for contradictions and unverified claims.
            </p>
          </div>
        </div>

        {/* Right: Live transcript */}
        <div className="col-span-8">
          <div className="text-[11px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Live Transcript</div>
          <div className="rounded-[10px] overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '500px' }}>
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--elevated)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--critical)' }} />
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Messages streaming live · INV-0229</span>
            </div>
            <div className="p-4 space-y-3">
              {shownMessages.length === 0 && (
                <div className="flex items-center justify-center h-40 text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Waiting for agents to initialize...
                </div>
              )}
              {shownMessages.map((msg, i) => {
                const agent = AGENTS.find(a => a.id === msg.agentId)!
                return (
                  <div key={i} className="stream-in flex gap-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5" style={{ background: agent.color, color: '#0A0A0F' }}>
                      {agent.monogram}
                    </div>
                    <div className="flex-1 rounded-[10px] p-3" style={{ background: 'var(--elevated)', border: `1px solid ${agent.color}20` }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-semibold" style={{ color: agent.color }}>{agent.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono-data font-bold" style={{ background: 'rgba(240,180,41,0.1)', color: 'var(--gold)' }}>
                          {msg.confidence.toFixed(2)}
                        </span>
                        <span className="ml-auto text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Round {msg.round}</span>
                      </div>
                      <p className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {msg.claim.slice(0, 200)}{msg.claim.length > 200 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
              {shownMessages.length > 0 && shownMessages.length < DEBATE_MESSAGES.filter(m => m.round <= 2).length && (
                <div className="flex items-center gap-2 py-2">
                  <div className="skeleton h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-3/4" />
                    <div className="skeleton h-3 w-1/2" />
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
