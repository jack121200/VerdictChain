import { useState, useRef, useEffect } from 'react'
import {
  LayoutDashboard, FolderSearch, PlusCircle, MessagesSquare, ShieldCheck,
  Zap, Bot, ScrollText, Settings, Bell, ChevronRight, Search,
  LogOut, ChevronLeft, CheckCircle, AlertCircle, Info, X, Menu
} from 'lucide-react'
import type { PageName, Toast, NavigateFn, AddToastFn } from '../types'

interface LayoutProps {
  children: React.ReactNode
  navigate: NavigateFn
  currentPage: PageName
  toasts: Toast[]
  addToast: AddToastFn
}

const NAV_ITEMS: { page: PageName; label: string; icon: React.ElementType; badge?: number }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'investigations', label: 'Investigations', icon: FolderSearch, badge: 3 },
  { page: 'new-investigation', label: 'New Investigation', icon: PlusCircle },
  { page: 'debate-room', label: 'Debate Room', icon: MessagesSquare },
  { page: 'trust-credibility', label: 'Trust & Credibility', icon: ShieldCheck },
  { page: 'response-actions', label: 'Response Actions', icon: Zap },
  { page: 'agent-fleet', label: 'Agent Fleet', icon: Bot },
  { page: 'audit-trail', label: 'Audit Trail', icon: ScrollText },
  { page: 'settings', label: 'Settings', icon: Settings },
]

const PAGE_LABELS: Record<PageName, string[]> = {
  login: ['Login'],
  dashboard: ['Dashboard'],
  investigations: ['Investigations'],
  'new-investigation': ['Investigations', 'New Investigation'],
  'investigation-detail': ['Investigations', 'INV-0231', 'Detail'],
  'debate-room': ['Debate Room'],
  'trust-credibility': ['Trust & Credibility'],
  'response-actions': ['Response Actions'],
  'agent-fleet': ['Agent Fleet'],
  'audit-trail': ['Audit Trail'],
  settings: ['Settings'],
}

const NOTIFICATIONS = [
  { id: 1, text: 'INV-0231 verdict reached — INSIDER THREAT (0.85)', time: '3 min ago', unread: true },
  { id: 2, text: 'EB Agent credibility dropped below isolation threshold', time: '4 min ago', unread: true },
  { id: 3, text: 'INV-0229 investigation initiated — Round 1 in progress', time: '48 min ago', unread: true },
  { id: 4, text: 'INV-0230 contained — External Recon (0.91)', time: '14 hr ago', unread: false },
]

export default function Layout({ children, navigate, currentPage, toasts, addToast }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAvatar, setShowAvatar] = useState(false)
  const [unreadCount, setUnreadCount] = useState(3)
  const bellRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowNotifications(false)
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setShowAvatar(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const breadcrumb = PAGE_LABELS[currentPage] || [currentPage]
  const sidebarWidth = collapsed ? '64px' : '248px'

  return (
    <div className="flex h-full" style={{ background: 'var(--obsidian)' }}>
      {/* Sidebar */}
      <aside
        className="fixed left-0 top-0 bottom-0 flex flex-col z-30 transition-all duration-200"
        style={{ width: sidebarWidth, background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5" style={{ borderBottom: '1px solid var(--border)', minHeight: '64px' }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-[8px] flex items-center justify-center" style={{ background: 'var(--violet)' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="3" fill="white" />
              <path d="M9 2L9 6M9 12L9 16M2 9L6 9M12 9L16 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M4.5 4.5L7 7M11 11L13.5 13.5M13.5 4.5L11 7M7 11L4.5 13.5" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
            </svg>
          </div>
          {!collapsed && (
            <div>
              <div className="font-display font-bold text-white text-[15px] leading-none tracking-tight">VerdictChain</div>
              <div className="text-[10px] mt-0.5 font-medium tracking-[0.5px] uppercase" style={{ color: 'var(--violet)' }}>Forensics Console</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto p-1 rounded-[6px] transition-colors hover:bg-white/5"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_ITEMS.map(({ page, label, icon: Icon, badge }) => {
            const active = currentPage === page
            return (
              <button
                key={page}
                onClick={() => navigate(page)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 relative group"
                style={{
                  color: active ? 'white' : 'rgba(255,255,255,0.55)',
                  background: active ? 'rgba(139,92,246,0.12)' : 'transparent',
                }}
              >
                {active && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full" style={{ background: 'var(--violet)' }} />
                )}
                <Icon size={16} style={{ color: active ? 'var(--violet)' : 'inherit', flexShrink: 0 }} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-[13px] font-medium">{label}</span>
                    {badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--violet)', color: 'white', lineHeight: 1.4 }}>
                        {badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </nav>

        {/* Analyst profile */}
        {!collapsed && (
          <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: 'var(--violet)', color: 'white' }}>
                SA
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-white truncate">SOC Analyst</div>
                <div className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>analyst@verdictchain.local</div>
              </div>
              <button className="p-1.5 rounded-[6px] hover:bg-white/5 transition-colors" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <LogOut size={13} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex flex-col min-h-full flex-1" style={{ marginLeft: sidebarWidth, transition: 'margin-left 0.2s' }}>
        {/* Topbar */}
        <header
          className="fixed top-0 right-0 flex items-center px-6 gap-4 z-20"
          style={{
            left: sidebarWidth,
            height: '56px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            transition: 'left 0.2s',
          }}
        >
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {breadcrumb.map((seg, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={11} />}
                <span className={i === breadcrumb.length - 1 ? 'text-white' : ''}>{seg}</span>
              </span>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 max-w-sm relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
            <input
              type="text"
              placeholder="Search investigations, hosts, evidence IDs..."
              className="w-full pl-8 pr-4 py-1.5 text-[12px] outline-none rounded-[8px] placeholder:text-white/30 text-white/80"
              style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
            />
          </div>

          <div className="flex-1" />

          {/* Pipeline status */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium" style={{ background: 'rgba(18,183,106,0.1)', color: 'var(--safe)', border: '1px solid rgba(18,183,106,0.2)' }}>
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--safe)' }} />
            Monitoring — 3/3 agents online
          </div>

          {/* Bell */}
          <div ref={bellRef} className="relative">
            <button
              onClick={() => { setShowNotifications(n => !n); setUnreadCount(0) }}
              className="relative p-2 rounded-[8px] hover:bg-white/5 transition-colors"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: 'var(--critical)', color: 'white' }}>
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 rounded-[10px] overflow-hidden z-50" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                <div className="px-4 py-3 text-[12px] font-semibold text-white/70 uppercase tracking-[0.4px]" style={{ borderBottom: '1px solid var(--border)' }}>
                  Notifications
                </div>
                {NOTIFICATIONS.map(n => (
                  <div key={n.id} className="px-4 py-3 hover:bg-white/3 cursor-pointer" style={{ borderBottom: '1px solid var(--border)', background: n.unread ? 'rgba(139,92,246,0.04)' : 'transparent' }}>
                    <div className="text-[12px] text-white/80 leading-snug">{n.text}</div>
                    <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{n.time}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Avatar */}
          <div ref={avatarRef} className="relative">
            <button
              onClick={() => setShowAvatar(a => !a)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold hover:ring-2 transition-all"
              style={{ background: 'var(--violet)', color: 'white' }}
            >
              SA
            </button>
            {showAvatar && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-[10px] overflow-hidden z-50" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="text-[13px] font-medium text-white">SOC Analyst</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>analyst@verdictchain.local</div>
                </div>
                <button className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-white/5 transition-colors" style={{ color: 'rgba(255,255,255,0.6)' }}
                  onClick={() => navigate('settings')}
                >
                  <Settings size={14} /> Settings
                </button>
                <button className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-white/5 transition-colors" style={{ color: 'var(--critical)' }}>
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto" style={{ marginTop: '56px', marginBottom: '40px' }}>
          {children}
        </main>

        {/* Footer */}
        <footer
          className="fixed bottom-0 right-0 flex items-center justify-between px-6 z-20"
          style={{
            left: sidebarWidth,
            height: '40px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            transition: 'left 0.2s',
          }}
        >
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)', fontFamily: "'JetBrains Mono', monospace" }}>
            VerdictChain v1.0 — APSIT BE IT · Group C18
          </span>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Last log ingest: <span style={{ color: 'var(--safe)' }}>2s ago</span> · Queue: 0 pending
          </span>
          <span className="flex items-center gap-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <span className="hover:text-white/60 cursor-pointer transition-colors">Docs</span>
            <span className="hover:text-white/60 cursor-pointer transition-colors">Support</span>
            <span>© 2026</span>
          </span>
        </footer>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-12 right-6 flex flex-col gap-2 z-50">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="flex items-center gap-3 px-4 py-3 rounded-[10px] text-[13px] font-medium fade-slide-up"
            style={{
              background: 'var(--elevated)',
              border: `1px solid ${toast.type === 'success' ? 'var(--safe)' : toast.type === 'error' ? 'var(--critical)' : 'var(--info)'}`,
              color: 'white',
              minWidth: '280px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {toast.type === 'success' && <CheckCircle size={16} style={{ color: 'var(--safe)', flexShrink: 0 }} />}
            {toast.type === 'error' && <AlertCircle size={16} style={{ color: 'var(--critical)', flexShrink: 0 }} />}
            {toast.type === 'info' && <Info size={16} style={{ color: 'var(--info)', flexShrink: 0 }} />}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
