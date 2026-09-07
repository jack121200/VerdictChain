import { useState } from 'react'
import { Info, Play, Cpu, CheckCircle2, Loader } from 'lucide-react'
import type { NavigateFn, AddToastFn } from '../types'
import { AGENTS } from '../data/mock'

const INTERNAL_SCENARIOS = [
  {
    id: 'off-hours-access',
    icon: '🕑',
    title: 'Off-Hours Cross-Department File Access',
    description: 'Detects users accessing files outside their department boundary during non-business hours using valid credentials.',
    dataset: 'auth.log + Windows Event Log',
  },
  {
    id: 'privileged-misuse',
    icon: '🔑',
    title: 'Privileged Account Misuse',
    description: 'Flags anomalous privilege escalation or lateral use of admin/service accounts outside expected scope.',
    dataset: 'Active Directory + EDR',
  },
  {
    id: 'data-exfiltration',
    icon: '📤',
    title: 'Unusual Data Exfiltration',
    description: 'Volume-based and destination-based anomaly detection for large-scale data staging or transfer.',
    dataset: 'NetFlow + DLP logs',
  },
]

const EXTERNAL_SCENARIOS = [
  {
    id: 'ddos',
    icon: '🌊',
    title: 'DDoS / Traffic Flood',
    description: 'High-volume inbound traffic analysis to detect volumetric denial-of-service patterns.',
    dataset: 'NetFlow + pcap (Zeek)',
  },
  {
    id: 'port-scan',
    icon: '🔭',
    title: 'Port Scan & Reconnaissance',
    description: 'Sequential port probing and service fingerprinting attempts from external or internal sources.',
    dataset: 'Zeek conn.log + firewall',
  },
  {
    id: 'brute-force',
    icon: '🔨',
    title: 'Brute-Force Login Attempts',
    description: 'Rapid sequential authentication failures against SSH, RDP, or web login endpoints.',
    dataset: 'auth.log + fail2ban',
  },
  {
    id: 'c2-traffic',
    icon: '🕷️',
    title: 'Botnet C2 Traffic',
    description: 'Beaconing detection, domain generation algorithm (DGA) patterns, and C2 infrastructure IOCs.',
    dataset: 'DNS logs + Threat Intel feeds',
  },
]

type RunStage = 'idle' | 'igniting' | 'running' | 'complete'

const PIPELINE_STEPS = [
  { label: 'Parsing raw logs', agent: 'NT', duration: 600 },
  { label: 'Authenticating access events', agent: 'AL', duration: 800 },
  { label: 'Indexing endpoint telemetry', agent: 'EB', duration: 700 },
  { label: 'Starting Round 1 debate', agent: null, duration: 500 },
  { label: 'Watchdog calibrating credibility', agent: 'WD', duration: 600 },
  { label: 'Verdict computed', agent: 'WD', duration: 400 },
]

export default function NewInvestigation({ navigate, addToast }: { navigate: NavigateFn; addToast: AddToastFn }) {
  const [activeTab, setActiveTab] = useState<'internal' | 'external'>('internal')
  const [stage, setStage] = useState<RunStage>('idle')
  const [runningScenario, setRunningScenario] = useState<string | null>(null)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [currentStep, setCurrentStep] = useState<number>(-1)

  const runScenario = (scenarioId: string, title: string) => {
    setRunningScenario(title)
    setStage('igniting')
    setCompletedSteps([])
    setCurrentStep(0)

    PIPELINE_STEPS.forEach((step, i) => {
      const delay = PIPELINE_STEPS.slice(0, i).reduce((s, st) => s + st.duration, 400)
      setTimeout(() => {
        setCurrentStep(i)
        if (i === 0) setStage('running')
      }, delay)
      setTimeout(() => {
        setCompletedSteps(prev => [...prev, i])
        if (i === PIPELINE_STEPS.length - 1) {
          setStage('complete')
        }
      }, delay + step.duration)
    })
  }

  const viewResult = () => {
    navigate('investigation-detail', 'INV-0231')
  }

  const ScenarioCard = ({ s, onClick }: { s: typeof INTERNAL_SCENARIOS[0]; onClick: () => void }) => (
    <div
      className="rounded-[10px] p-5 flex flex-col gap-3 hover:border-opacity-60 transition-all"
      style={{ background: 'var(--elevated)', border: '1px solid var(--border)', cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div className="text-2xl">{s.icon}</div>
      <div>
        <div className="font-display font-semibold text-white mb-1" style={{ fontSize: '15px' }}>{s.title}</div>
        <p className="text-[13px] leading-[20px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{s.description}</p>
      </div>
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--info)' }}>
        <span className="font-mono-data">Dataset:</span>
        <span className="font-mono-data">{s.dataset}</span>
      </div>
      <button
        onClick={onClick}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-semibold text-white transition-all hover:opacity-90 mt-auto"
        style={{ background: 'var(--violet)' }}
      >
        <Play size={13} fill="white" />
        Run Investigation
      </button>
    </div>
  )

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px', lineHeight: '30px' }}>New Investigation</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Manually trigger a scenario or let continuous monitoring handle it</p>
      </div>

      {/* Continuous monitoring banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(18,183,106,0.06)', border: '1px solid rgba(18,183,106,0.2)' }}>
        <span className="w-2 h-2 rounded-full pulse-dot flex-shrink-0" style={{ background: 'var(--safe)' }} />
        <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
          <strong style={{ color: 'var(--safe)' }}>Continuous monitoring is active</strong> — all 5 agents are watching live log streams. You can also trigger a scenario manually for testing or training purposes.
        </span>
      </div>

      {/* Blind test notice */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
        <Info size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--violet)' }} />
        <div className="text-[13px]">
          <span className="font-semibold text-white">Blind test design: </span>
          <span style={{ color: 'rgba(255,255,255,0.65)' }}>Agents are never told which scenario was selected. Each agent independently analyzes the raw log evidence and forms its own position. This is a core scientific property of the VerdictChain system — the debate is unbiased and evidence-driven.</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-[10px] w-fit" style={{ background: 'var(--elevated)' }}>
        {(['internal', 'external'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 rounded-[8px] text-[13px] font-medium capitalize transition-all"
            style={{
              background: activeTab === tab ? 'var(--violet)' : 'transparent',
              color: activeTab === tab ? 'white' : 'rgba(255,255,255,0.5)',
            }}
          >
            {tab === 'internal' ? '🏢 Internal (Insider)' : '🌐 External (Network)'}
          </button>
        ))}
      </div>

      {/* Scenario cards */}
      <div className={`grid gap-4 ${activeTab === 'internal' ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {(activeTab === 'internal' ? INTERNAL_SCENARIOS : EXTERNAL_SCENARIOS).map(s => (
          <ScenarioCard key={s.id} s={s} onClick={() => runScenario(s.id, s.title)} />
        ))}
      </div>

      {/* Pipeline Running Overlay */}
      {stage !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(10,10,15,0.85)', backdropFilter: 'blur(4px)' }}>
          <div className="w-[520px] rounded-[10px] overflow-hidden card-violet-hairline" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 mb-1">
                <Cpu size={18} style={{ color: 'var(--violet)' }} />
                <span className="font-display font-semibold text-white" style={{ fontSize: '17px' }}>
                  {stage === 'complete' ? 'Investigation Complete' : 'Pipeline Igniting...'}
                </span>
              </div>
              <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{runningScenario}</div>
            </div>

            <div className="px-6 py-5 space-y-3">
              {PIPELINE_STEPS.map((step, i) => {
                const done = completedSteps.includes(i)
                const active = currentStep === i && !done
                const pending = i > currentStep

                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        background: done ? 'rgba(18,183,106,0.2)' : active ? 'rgba(139,92,246,0.2)' : 'var(--elevated)',
                        border: `1px solid ${done ? 'var(--safe)' : active ? 'var(--violet)' : 'var(--border)'}`,
                      }}>
                      {done ? <CheckCircle2 size={14} style={{ color: 'var(--safe)' }} /> :
                        active ? <Loader size={14} style={{ color: 'var(--violet)', animation: 'spin 1s linear infinite' }} /> :
                        <span className="font-mono-data text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>}
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px]" style={{ color: pending ? 'rgba(255,255,255,0.35)' : done ? 'rgba(255,255,255,0.75)' : 'white' }}>
                        {step.label}
                      </div>
                    </div>
                    {step.agent && (
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const agent = AGENTS.find(a => a.id === step.agent)!
                          return (
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: agent.color, color: '#0A0A0F' }}>
                              {agent.monogram}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Round counter */}
            <div className="px-6 pb-5">
              <div className="flex gap-1.5 mb-4">
                {[1, 2, 3].map(r => (
                  <div key={r} className="flex-1 h-0.5 rounded-full transition-all" style={{
                    background: stage === 'complete' ? 'var(--safe)' : currentStep >= (r - 1) * 2 ? 'var(--violet)' : 'var(--border)'
                  }} />
                ))}
              </div>
              {stage === 'complete' ? (
                <button onClick={viewResult}
                  className="w-full py-3 rounded-[10px] text-[14px] font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: 'var(--violet)' }}>
                  View Investigation Report →
                </button>
              ) : (
                <div className="text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Debate in progress — agents reasoning independently...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
