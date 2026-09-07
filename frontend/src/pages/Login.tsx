import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle } from 'lucide-react'
import type { NavigateFn } from '../types'
import { login, register, setToken, ApiError } from '../api/client'

export default function Login({ navigate }: { navigate: NavigateFn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (username.length < 3) {
      setError('Username must be at least 3 characters.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const { access_token } = mode === 'login' ? await login(username, password) : await register(username, password)
      setToken(access_token)
      navigate('dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the VerdictChain API.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--obsidian)' }}>
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 relative overflow-hidden px-14 py-12" style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
        {/* Node graph background */}
        <svg className="absolute inset-0 w-full h-full opacity-20" style={{ pointerEvents: 'none' }}>
          <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Nodes */}
          {[
            [120, 180], [320, 120], [480, 260], [200, 380], [400, 480],
            [560, 160], [80, 500], [300, 560], [540, 420], [160, 320],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 5 : 3} fill="#8B5CF6" />
          ))}
          {/* Edges */}
          {[
            [120,180,320,120],[320,120,480,260],[480,260,400,480],
            [200,380,320,120],[200,380,400,480],[560,160,480,260],
            [80,500,200,380],[300,560,400,480],[540,420,480,260],
            [160,320,120,180],[160,320,200,380],[540,420,300,560],
          ].map(([x1,y1,x2,y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8B5CF6" strokeWidth="0.8" />
          ))}
          <circle cx="320" cy="320" r="180" fill="url(#glow)" />
        </svg>

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--violet)' }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="3.5" fill="white" />
              <path d="M11 3L11 7M11 15L11 19M3 11L7 11M15 11L19 11" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M5.5 5.5L8.5 8.5M13.5 13.5L16.5 16.5M16.5 5.5L13.5 8.5M8.5 13.5L5.5 16.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
            </svg>
          </div>
          <div>
            <div className="font-display font-bold text-white text-[18px] leading-none">VerdictChain</div>
            <div className="text-[10px] mt-0.5 font-medium tracking-[0.5px] uppercase" style={{ color: 'var(--violet)' }}>Multi-Agent Forensics</div>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative z-10">
          <h1 className="font-display font-bold text-white leading-snug mb-4" style={{ fontSize: '32px', lineHeight: '40px' }}>
            Multi-Agent Debate and Trust-Verification for Insider-Threat Forensics
          </h1>
          <p className="text-[14px] leading-[20px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Five specialized AI agents debate evidence across three rounds. A Watchdog scores their credibility in real time. Confirmed threats are auto-contained. Every decision is logged, auditable, and explainable.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 mt-8">
            {['Debate-based reasoning', 'Live credibility scoring', 'MITRE ATT&CK mapping', 'Auto-containment', 'Immutable audit trail'].map(f => (
              <span key={f} className="px-3 py-1 rounded-full text-[11px] font-medium" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.25)' }}>
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="relative z-10 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          APSIT BE IT · Group C18 · Academic Research Project
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <h2 className="font-display font-semibold text-white mb-1" style={{ fontSize: '22px', lineHeight: '30px' }}>Welcome back</h2>
            <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Sign in to your forensics console</p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-[0.4px] mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="analyst"
                className="w-full px-4 py-3 rounded-[10px] text-[14px] text-white outline-none transition-all placeholder:text-white/25"
                style={{
                  background: 'var(--elevated)',
                  border: '1px solid var(--border)',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--violet)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-[0.4px] mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-[10px] text-[14px] text-white outline-none transition-all placeholder:text-white/25"
                  style={{
                    background: 'var(--elevated)',
                    border: '1px solid var(--border)',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--violet)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Inline error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px]" style={{ background: 'rgba(240,68,56,0.1)', border: '1px solid rgba(240,68,56,0.3)', color: 'var(--critical)' }}>
                <AlertTriangle size={14} />
                {error}
              </div>
            )}

            {/* Login / register toggle */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMode(m => (m === 'login' ? 'register' : 'login'))}
                className="text-[13px] transition-colors"
                style={{ color: 'var(--violet)' }}
              >
                {mode === 'login' ? 'New analyst? Create an account' : 'Already have an account? Sign in'}
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-[10px] text-[14px] font-semibold text-white transition-all mt-2"
              style={{
                background: loading ? 'rgba(139,92,246,0.5)' : 'var(--violet)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Protected system — authorized personnel only
          </p>
        </div>
      </div>
    </div>
  )
}
