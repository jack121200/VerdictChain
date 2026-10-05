import { useState, type ReactNode } from 'react';
import { buildRoute, type SimpleRouteName } from '../app/router';
import { ROLE_LABEL } from '../lib/labels';
import { cn } from '../lib/cn';
import { formatCount, formatDuration, shortId } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icon-names';
import { Metric } from '../ui/Metric';
import { Proof, type ProofProps } from '../ui/Proof';
import { useShellData } from './shell-data';

export type NavKey = Exclude<SimpleRouteName, 'login'>;

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; label: string; icon: IconName }> = [
  { key: 'overview', label: 'Overview', icon: 'menu_book' },
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'investigations', label: 'Investigations', icon: 'travel_explore' },
  { key: 'trust', label: 'Trust & credibility', icon: 'verified_user' },
  { key: 'fleet', label: 'Agent fleet', icon: 'hub' },
  { key: 'audit', label: 'Audit trail', icon: 'receipt_long' },
  { key: 'access', label: 'Access & system', icon: 'admin_panel_settings' },
];

export interface TopNavProps {
  active: NavKey | null;
  onSignOut: () => void;
}

type ChipTone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'idle';

const CHIP_TEXT: Record<ChipTone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
  idle: 'text-on-surface-variant',
};

/** A status chip with its Proof. Colour always comes with an icon or text, never alone. */
function Chip({ tone, icon, proof, children }: { tone: ChipTone; icon?: IconName; proof?: Omit<ProofProps, 'label'>; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-card px-2 py-1 font-mono text-evidence">
      {icon && <Icon name={icon} size={12} className={CHIP_TEXT[tone]} />}
      <span className={CHIP_TEXT[tone]}>{children}</span>
      {proof && <Proof {...proof} />}
    </span>
  );
}

function ApiChip() {
  const { health, status } = useShellData();
  if (health.error !== null) {
    return (
      <Chip tone="error" icon="warning" proof={{ source: 'GET /health', n: 1, asOf: null, definition: `The last GET /health failed: ${health.error}` }}>
        API unreachable
      </Chip>
    );
  }
  if (status.data) {
    return (
      <Chip
        tone="secondary"
        icon="check"
        proof={{ source: 'GET /system/status.api_version', n: 1, asOf: status.loadedAt, definition: 'API version reported by the backend. Turns to "API unreachable" when GET /health fails.' }}
      >
        API {status.data.api_version}
      </Chip>
    );
  }
  if (status.error !== null) return <Chip tone="error" icon="warning">Status unavailable</Chip>;
  return <Chip tone="idle">API —</Chip>;
}

function LatencyChip() {
  const { health } = useShellData();
  const text = health.data ? formatDuration(health.data.latencyMs) : '—';
  return (
    <Chip
      tone={health.data ? 'primary' : 'idle'}
      proof={{
        source: 'GET /health, timed in the browser',
        n: 1,
        asOf: health.loadedAt,
        definition: 'Round trip of one GET /health: performance.now() before the request minus performance.now() after the response. Refreshed every 30 seconds.',
      }}
    >
      {text}
    </Chip>
  );
}

function DebateChip() {
  const { status } = useShellData();
  if (!status.data) return <Chip tone="idle">Debate engine —</Chip>;
  const slot = status.data.debate_slot;
  if (slot.state === 'running' && slot.investigation_id !== null) {
    return (
      <Chip tone="primary" icon="sync_alt" proof={{ source: 'GET /system/status.debate_slot', n: 1, asOf: status.loadedAt, definition: 'The debate slot is held by one running investigation.' }}>
        Debate running · {shortId(slot.investigation_id)}
      </Chip>
    );
  }
  return (
    <Chip tone="idle" proof={{ source: 'GET /system/status.debate_slot', n: 1, asOf: status.loadedAt, definition: 'No investigation holds the debate slot.' }}>
      Debate engine idle
    </Chip>
  );
}

function SandboxChip() {
  const { status } = useShellData();
  const metric = status.data?.sandbox.is_simulated_violations;
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-card px-2 py-1 font-mono text-evidence">
      <Metric
        metric={metric}
        size="body"
        label="Sandbox enforcement"
        format={(count) => (count === 0 ? 'Sandbox enforced' : `Sandbox violations: ${formatCount(count)}`)}
      />
    </span>
  );
}

function ThreatsChip() {
  const { stats } = useShellData();
  if (!stats.data && stats.error !== null) return <Chip tone="error" icon="warning">Threats unavailable</Chip>;
  return (
    <span className="inline-flex items-center gap-2 text-caption text-on-surface-variant">
      Open threat verdicts (24 h)
      <Metric metric={stats.data?.threats_24h} size="body" label="Open threat verdicts (24 h)" />
    </span>
  );
}

function UserBadge() {
  const { me } = useShellData();
  if (!me.data) {
    return <span className="text-caption text-on-surface-variant">{me.error ?? 'Loading analyst…'}</span>;
  }
  return (
    <span className="flex flex-col text-right leading-tight">
      <span className="text-body font-semibold text-on-surface">{me.data.username}</span>
      <span className="font-mono text-evidence text-on-surface-variant">
        {ROLE_LABEL[me.data.role]} · {shortId(me.data.analyst_id)}
      </span>
    </span>
  );
}

function NavLinks({ active, onNavigate, className }: { active: NavKey | null; onNavigate?: () => void; className?: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const selected = active === item.key;
        return (
          <a
            key={item.key}
            href={buildRoute({ name: item.key })}
            aria-current={selected ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-label font-semibold uppercase transition-all',
              selected ? 'bg-primary-container font-bold text-on-primary shadow-glow-cyan' : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface',
              className,
            )}
          >
            <Icon name={item.icon} size={12} />
            {item.label}
          </a>
        );
      })}
    </>
  );
}

/** Fixed top bar: brand, status chips, primary navigation, analyst badge and sign-out. Every value is loaded, never typed. */
export function TopNav({ active, onSignOut }: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-outline-variant/40 bg-surface-container-lowest/90 shadow-panel backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:h-20 lg:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <a href={buildRoute({ name: 'dashboard' })} className="flex shrink-0 items-center gap-2.5">
            <img src="/assets/logo-emblem.png" alt="VerdictChain logo" className="h-8 w-8 rounded-lg border border-primary-container/40 bg-surface-card p-1" />
            <span className="flex flex-col leading-none">
              <span className="font-headline text-base font-bold uppercase tracking-tight text-primary lg:text-lg">
                Verdict<span className="text-on-surface">Chain</span>
              </span>
              <span className="mt-0.5 text-label uppercase text-on-surface-variant">Multi-agent console</span>
            </span>
          </a>
          <div className="hidden items-center gap-1.5 border-l border-outline-variant/40 pl-3 2xl:flex">
            <ApiChip />
            <LatencyChip />
            <DebateChip />
            <SandboxChip />
          </div>
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 rounded-lg border border-outline-variant/40 bg-background p-1 xl:flex">
          <NavLinks active={active} />
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 md:flex">
            <ThreatsChip />
          </div>
          <div className="hidden items-center gap-2 border-l border-outline-variant/40 pl-3 md:flex">
            <UserBadge />
          </div>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon="logout" onClick={onSignOut} aria-label="Sign out">
              <span className="hidden sm:inline">Sign out</span>
            </Button>
            <Proof
              source="browser: api/client.ts clearToken()"
              n={1}
              asOf={null}
              definition="Clears the stored session token and returns to sign-in. Nothing is sent to the server."
              label="Sign out"
            />
          </span>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="cursor-pointer rounded-lg bg-surface-card p-1.5 text-on-surface-variant hover:text-on-surface xl:hidden"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="primary-menu" aria-label="Primary (menu)" className="grid grid-cols-2 gap-1.5 border-t border-outline-variant/40 bg-surface-container-lowest px-4 py-3 xl:hidden">
          <NavLinks active={active} onNavigate={() => setMenuOpen(false)} className="w-full" />
        </nav>
      )}
    </header>
  );
}
