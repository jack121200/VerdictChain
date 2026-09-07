import { Info, Play } from 'lucide-react'
import { useState } from 'react'
import type { NavigateFn, AddToastFn } from '../types'
import type { ScenarioLabel } from '../api/client'

// Scenario catalog matches exactly what's ingested into raw_logs (backend/pipeline/
// ingestion.py + cert_ingestion.py) - selecting one triggers a REAL manual
// investigation via POST /investigations/simulate, not a fabricated result.
const INTERNAL_SCENARIOS: { id: ScenarioLabel; icon: string; title: string; description: string; dataset: string }[] = [
  { id: 'insider_scenario_1', icon: '🕑', title: 'Insider Scenario 1', description: 'CERT r4.2 red-team scenario 1 - 30 users with confirmed malicious logon/device/file activity.', dataset: 'CERT r4.2 logon.csv + device.csv + file.csv' },
  { id: 'insider_scenario_2', icon: '🔑', title: 'Insider Scenario 2', description: 'CERT r4.2 red-team scenario 2 - 30 users, predominantly device-connect anomalies.', dataset: 'CERT r4.2 device.csv' },
  { id: 'insider_scenario_3', icon: '📤', title: 'Insider Scenario 3', description: 'CERT r4.2 red-team scenario 3 - 10 users, spans logon/device/file activity.', dataset: 'CERT r4.2 logon.csv + device.csv + file.csv' },
]

const EXTERNAL_SCENARIOS: { id: ScenarioLabel; icon: string; title: string; description: string; dataset: string }[] = [
  { id: 'DDoS', icon: '🌊', title: 'DDoS / Traffic Flood', description: 'High-volume inbound traffic analysis to detect volumetric denial-of-service patterns.', dataset: 'CICIDS2017 (1,500 flows)' },
  { id: 'Portscan', icon: '🔭', title: 'Port Scan & Reconnaissance', description: 'Sequential port probing and service fingerprinting attempts.', dataset: 'CICIDS2017 (1,500 flows)' },
  { id: 'FTP-Patator', icon: '🔨', title: 'FTP Brute-Force', description: 'Rapid sequential authentication failures against an FTP endpoint.', dataset: 'CICIDS2017 (1,500 flows)' },
  { id: 'SSH-Patator', icon: '🔨', title: 'SSH Brute-Force', description: 'Rapid sequential authentication failures against an SSH endpoint.', dataset: 'CICIDS2017 (1,500 flows)' },
  { id: 'Botnet', icon: '🕷️', title: 'Botnet C2 Traffic', description: 'Beaconing detection and command-and-control infrastructure indicators.', dataset: 'CICIDS2017 (736 flows)' },
]

export default function NewInvestigation({ navigate, addToast, onScenarioSelected }: { navigate: NavigateFn; addToast: AddToastFn; onScenarioSelected: (label: string) => void }) {
  const [activeTab, setActiveTab] = useState<'internal' | 'external'>('internal')

  const runScenario = (scenarioId: ScenarioLabel, title: string) => {
    onScenarioSelected(scenarioId)
    addToast(`Triggering ${title} — agents are blind to the selected scenario.`, 'info')
    navigate('debate-room')
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
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Manually trigger a real scenario against the ingested VerdictChain dataset</p>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] mb-6" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
        <Info size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--violet)' }} />
        <div className="text-[13px]">
          <span className="font-semibold text-white">Blind test design: </span>
          <span style={{ color: 'rgba(255,255,255,0.65)' }}>Agents are never told which scenario was selected. Each agent independently analyzes its own real log slice and forms its own position over a live 3-round debate.</span>
        </div>
      </div>

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

      <div className={`grid gap-4 ${activeTab === 'internal' ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {(activeTab === 'internal' ? INTERNAL_SCENARIOS : EXTERNAL_SCENARIOS).map(s => (
          <ScenarioCard key={s.id} s={s} onClick={() => runScenario(s.id, s.title)} />
        ))}
      </div>
    </div>
  )
}
