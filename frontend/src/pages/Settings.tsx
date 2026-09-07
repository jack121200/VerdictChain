import { useState } from 'react'
import { Save, X } from 'lucide-react'

const SETTINGS_TABS = ['General', 'Agents & Models', 'Trust Thresholds', 'Notifications', 'Integrations', 'API Keys']

export default function Settings() {
  const [activeTab, setActiveTab] = useState(0)
  const [isolationThreshold, setIsolationThreshold] = useState(0.30)
  const [debateRounds, setDebateRounds] = useState(3)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="px-8 py-6 max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-white mb-1" style={{ fontSize: '22px' }}>Settings</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Configure VerdictChain behavior, agent models, and thresholds</p>
      </div>

      <div className="flex gap-6">
        {/* Left mini-tabs */}
        <div className="w-48 flex-shrink-0">
          <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            {SETTINGS_TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className="w-full px-4 py-3 text-left text-[13px] font-medium transition-all relative"
                style={{
                  color: activeTab === i ? 'white' : 'rgba(255,255,255,0.5)',
                  background: activeTab === i ? 'rgba(139,92,246,0.12)' : 'transparent',
                  borderBottom: i < SETTINGS_TABS.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                {activeTab === i && (
                  <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: 'var(--violet)' }} />
                )}
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          {/* General */}
          {activeTab === 0 && (
            <div className="space-y-4">
              <SettingsCard title="Console Identity">
                <FieldRow label="Organization Name" defaultValue="APSIT BE IT — Group C18" />
                <FieldRow label="Console Hostname" defaultValue="verdictchain.local" mono />
                <FieldRow label="Timezone" defaultValue="UTC+0 (Coordinated Universal Time)" />
              </SettingsCard>
              <SettingsCard title="Session & Security">
                <ToggleRow label="Require MFA on login" defaultChecked />
                <ToggleRow label="Session timeout (30 min inactivity)" defaultChecked />
                <ToggleRow label="Log all analyst interactions to audit trail" defaultChecked />
              </SettingsCard>
            </div>
          )}

          {/* Agents & Models */}
          {activeTab === 1 && (
            <div className="space-y-4">
              <SettingsCard title="Model Backend">
                <div className="text-[13px] mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  All five agents share the same model backend. Configure the Ollama endpoint and model ID below.
                </div>
                <FieldRow label="Ollama Endpoint" defaultValue="http://localhost:11434" mono />
                <FieldRow label="Model ID" defaultValue="llama3.1:8b" mono />
                <FieldRow label="Context Window" defaultValue="8192 tokens" mono />
              </SettingsCard>
              <SettingsCard title="Per-Agent Configuration">
                {['NT', 'AL', 'EB', 'WD', 'SH'].map((id, i) => (
                  <div key={id} className="flex items-center justify-between py-2.5" style={{ borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: ['#36BFFA','#8B5CF6','#12B76A','#F0B429','#F04438'][i], color: '#0A0A0F' }}>{id}</div>
                      <span className="text-[13px] text-white">{['Network-Traffic', 'Access-Log', 'Endpoint-Behavior', 'Watchdog', 'Self-Healing'][i]} Agent</span>
                    </div>
                    <span className="font-mono-data text-[11px]" style={{ color: 'var(--info)' }}>llama3.1:8b</span>
                  </div>
                ))}
              </SettingsCard>
            </div>
          )}

          {/* Trust Thresholds */}
          {activeTab === 2 && (
            <div className="space-y-4">
              <SettingsCard title="Isolation Threshold">
                <div className="text-[13px] mb-5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Agents whose credibility score falls below this threshold are automatically isolated and replaced with a backup agent for ongoing investigations.
                </div>
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-medium text-white">Isolation Threshold</span>
                    <span className="font-mono-data text-[16px] font-bold" style={{ color: isolationThreshold < 0.35 ? 'var(--critical)' : 'var(--gold)' }}>
                      {isolationThreshold.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={0.6}
                    step={0.01}
                    value={isolationThreshold}
                    onChange={e => setIsolationThreshold(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, var(--violet) 0%, var(--violet) ${((isolationThreshold - 0.1) / 0.5) * 100}%, var(--border) ${((isolationThreshold - 0.1) / 0.5) * 100}%, var(--border) 100%)`,
                      accentColor: 'var(--violet)',
                    }}
                  />
                  <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <span>0.10 (Lenient)</span>
                    <span>0.30 (Default)</span>
                    <span>0.60 (Strict)</span>
                  </div>
                </div>
                {isolationThreshold !== 0.30 && (
                  <div className="flex items-center gap-2 text-[12px] px-3 py-2 rounded-[8px]" style={{ background: 'rgba(247,144,9,0.08)', border: '1px solid rgba(247,144,9,0.2)', color: 'var(--warning)' }}>
                    ⚠ Threshold deviates from default (0.30). Consider impact on debate quality.
                  </div>
                )}
              </SettingsCard>

              <SettingsCard title="Debate Rounds">
                <div className="text-[13px] mb-5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Number of debate rounds before the Watchdog issues a verdict. More rounds allow deeper consensus but increase investigation latency.
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-medium text-white">Debate Round Count</span>
                  <span className="font-mono-data text-[16px] font-bold" style={{ color: 'var(--violet)' }}>{debateRounds}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={debateRounds}
                  onChange={e => setDebateRounds(parseInt(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--violet) 0%, var(--violet) ${((debateRounds - 1) / 4) * 100}%, var(--border) ${((debateRounds - 1) / 4) * 100}%, var(--border) 100%)`,
                  }}
                />
                <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {[1,2,3,4,5].map(n => <span key={n}>{n}{n === 3 ? ' (Default)' : ''}</span>)}
                </div>
              </SettingsCard>

              <SettingsCard title="Confidence Thresholds">
                <FieldRow label="Minimum confidence to trigger containment" defaultValue="0.70" mono />
                <FieldRow label="Minimum confidence to flag for analyst review" defaultValue="0.45" mono />
                <FieldRow label="Auto-close as false positive below" defaultValue="0.15" mono />
              </SettingsCard>
            </div>
          )}

          {/* Notifications */}
          {activeTab === 3 && (
            <SettingsCard title="Alert Preferences">
              <ToggleRow label="Alert on INSIDER_THREAT verdict" defaultChecked />
              <ToggleRow label="Alert on agent isolation event" defaultChecked />
              <ToggleRow label="Alert on confidence > 0.85" defaultChecked />
              <ToggleRow label="Alert on failed log ingest pipeline" defaultChecked />
              <ToggleRow label="Daily digest email" />
              <ToggleRow label="Slack webhook integration" />
            </SettingsCard>
          )}

          {/* Integrations */}
          {activeTab === 4 && (
            <div className="space-y-4">
              {['SIEM (Splunk / Elastic)', 'SOAR Platform', 'Slack Webhook', 'PagerDuty', 'ServiceNow'].map((name, i) => (
                <div key={name} className="flex items-center justify-between px-4 py-4 rounded-[10px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div>
                    <div className="text-[13px] font-medium text-white">{name}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Not configured</div>
                  </div>
                  <button className="px-4 py-2 rounded-[8px] text-[12px] font-medium transition-all hover:opacity-80" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.6)', border: '1px solid var(--border)' }}>
                    Configure
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* API Keys */}
          {activeTab === 5 && (
            <div className="space-y-4">
              <SettingsCard title="API Keys">
                <div className="text-[13px] mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  API keys grant programmatic access to the VerdictChain API. Keep them secret.
                </div>
                {[
                  { name: 'Production Key', key: 'vc_prod_••••••••••••••••3f9a', created: 'Sep 1, 2026', last: '5 min ago' },
                  { name: 'CI/CD Key', key: 'vc_ci_••••••••••••••••7d2c', created: 'Aug 15, 2026', last: '2 days ago' },
                ].map(k => (
                  <div key={k.name} className="py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[13px] font-medium text-white">{k.name}</div>
                        <div className="font-mono-data text-[11px] mt-0.5" style={{ color: 'var(--info)' }}>{k.key}</div>
                        <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Created {k.created} · Last used {k.last}</div>
                      </div>
                      <button className="px-3 py-1.5 rounded-[6px] text-[12px] transition-colors hover:bg-red-900/20" style={{ color: 'var(--critical)', border: '1px solid rgba(240,68,56,0.2)' }}>
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
                <button className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium transition-all hover:opacity-80" style={{ background: 'var(--elevated)', color: 'rgba(255,255,255,0.65)', border: '1px solid var(--border)' }}>
                  + Generate New Key
                </button>
              </SettingsCard>
            </div>
          )}
        </div>
      </div>

      {/* Sticky save/cancel */}
      <div className="fixed bottom-10 right-8 flex items-center gap-3">
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-medium transition-all hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid var(--border)' }}>
          <X size={14} /> Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] text-[13px] font-semibold text-white transition-all hover:opacity-90"
          style={{ background: saved ? 'var(--safe)' : 'var(--violet)' }}
        >
          <Save size={14} />
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

const SettingsCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-[10px] p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
    <div className="font-display font-semibold text-white mb-4" style={{ fontSize: '15px' }}>{title}</div>
    {children}
  </div>
)

const FieldRow = ({ label, defaultValue, mono }: { label: string; defaultValue: string; mono?: boolean }) => (
  <div className="flex items-center gap-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
    <label className="text-[13px] text-white/70 w-56 flex-shrink-0">{label}</label>
    <input
      type="text"
      defaultValue={defaultValue}
      className="flex-1 px-3 py-2 rounded-[8px] text-[13px] outline-none"
      style={{
        background: 'var(--elevated)',
        border: '1px solid var(--border)',
        color: mono ? 'var(--info)' : 'white',
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
        fontSize: mono ? '12px' : '13px',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--violet)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    />
  </div>
)

const ToggleRow = ({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) => {
  const [checked, setChecked] = useState(defaultChecked || false)
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-[13px] text-white/70">{label}</span>
      <div
        className="w-9 h-5 rounded-full relative cursor-pointer transition-all"
        style={{ background: checked ? 'var(--violet)' : 'var(--border)' }}
        onClick={() => setChecked(c => !c)}
      >
        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: checked ? '17px' : '2px' }} />
      </div>
    </div>
  )
}
