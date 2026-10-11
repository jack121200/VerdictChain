import { useEffect, useState, type ReactNode } from 'react';
import { getLiveStatus } from '../api/client';
import { useAsync } from '../app/use-async';
import { ROLE_LABEL } from '../lib/labels';
import { formatCount, formatDuration, shortId } from '../lib/format';
import { Button } from '../ui/Button';
import { CopyHash } from '../ui/CopyHash';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icon-names';
import { Metric } from '../ui/Metric';
import { Proof, type ProofProps } from '../ui/Proof';
import { CommandPalette } from './CommandPalette';
import { useShellData } from './shell-data';

export interface TopNavProps {
  /** Opens the sidebar drawer on small screens. */
  onMenuToggle: () => void;
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
  const { status, stats } = useShellData();
  if (!status.data) return <Chip tone="idle">Debate engine —</Chip>;
  const slot = status.data.debate_slot;
  const queued = stats.data?.by_status?.queued?.value ?? null;
  const waiting = queued !== null && queued > 0 ? ` · ${formatCount(queued)} queued` : '';
  const queueNote = ' The number of queued investigations is GET /stats.by_status.queued: accepted debates waiting for a free slot.';
  const running = slot.running.value;
  const capacity = slot.capacity.value;
  const slots = capacity === null ? '' : ` Up to ${formatCount(capacity)} debates run at once (DEBATE_MAX_CONCURRENT).`;
  if (slot.status === 'running' && running !== null && running > 1) {
    return (
      <Chip
        tone="primary"
        icon="sync_alt"
        proof={{ source: 'GET /system/status.debate_slot', n: running, asOf: status.loadedAt, definition: `${formatCount(running)} investigations hold a debate slot and run side by side.${slots}${queueNote}` }}
      >
        {formatCount(running)} debates running{capacity === null ? '' : ` of ${formatCount(capacity)}`}
        {waiting}
      </Chip>
    );
  }
  if (slot.status === 'running' && slot.investigation_id !== null) {
    return (
      <Chip tone="primary" icon="sync_alt" proof={{ source: 'GET /system/status.debate_slot', n: 1, asOf: status.loadedAt, definition: `One investigation holds a debate slot.${slots}${queueNote}` }}>
        Debate running ·{' '}
        <CopyHash value={slot.investigation_id} display={shortId(slot.investigation_id)} label="running investigation id" size="inherit" textClassName="text-primary" />
        {waiting}
      </Chip>
    );
  }
  return (
    <Chip tone="idle" proof={{ source: 'GET /system/status.debate_slot', n: 1, asOf: status.loadedAt, definition: `No investigation holds a debate slot.${slots}${queueNote}` }}>
      Debate engine idle{waiting}
    </Chip>
  );
}

/** The simulated live feed on every page: running or off, rows streamed, and where the OpenAI switch-on stands. */
function LiveChip() {
  const live = useAsync(getLiveStatus, 2000, ['live']);
  const data = live.data;
  if (data === undefined) return <Chip tone="idle">Live feed —</Chip>;
  if (data.state !== 'running') {
    return (
      <Chip
        tone="idle"
        proof={{
          source: 'GET /live/status',
          n: 1,
          asOf: live.loadedAt,
          definition: 'The simulated live feed is stopped. A lead or a supervisor starts it on the Live feed page; no model is called while it is off.',
        }}
      >
        Live feed off
      </Chip>
    );
  }
  const seen = data.consumed.value ?? 0;
  const needed = data.llm.activation_rows.value;
  const note =
    data.llm.state === 'warming_up'
      ? ` · OpenAI after ${formatCount(needed ?? 0)}`
      : data.llm.state === 'active'
        ? ' · OpenAI on'
        : data.llm.state === 'budget_reached'
          ? ' · OpenAI budget used'
          : data.llm.state === 'allowance_reached'
            ? ' · OpenAI key limit'
            : data.llm.state === 'not_configured'
              ? ' · OpenAI not set'
              : '';
  return (
    <Chip
      tone="secondary"
      icon="sensors"
      proof={{
        source: 'GET /live/status',
        n: data.consumed.n,
        asOf: live.loadedAt,
        definition:
          'The simulated live feed is running: dataset rows are replayed through RabbitMQ and scored by the monitor from the first row. OpenAI is called only after the number of rows chosen at start has streamed (state: ' +
          data.llm.state +
          ').',
      }}
    >
      Live · {formatCount(seen)} rows{note}
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
        {ROLE_LABEL[me.data.role]} ·{' '}
        <CopyHash value={me.data.analyst_id} display={shortId(me.data.analyst_id)} label="analyst id" size="inherit" textClassName="text-on-surface-variant" />
      </span>
    </span>
  );
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. Read from the browser, so the hint matches the real shortcut. */
function shortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(window.navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

/** Ctrl or Cmd + K toggles the palette, unless another dialog is open (two stacked dialogs would fight for focus). */
function usePaletteShortcut(toggle: (open: (current: boolean) => boolean) => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      toggle((current) => (current ? false : document.querySelector('[aria-modal="true"]') === null));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
}

/**
 * Slim top bar beside the sidebar: a menu button (mobile), live status chips,
 * the open-threats count, the analyst badge and sign-out. Every value is loaded, never typed.
 */
export function TopNav({ onMenuToggle, onSignOut }: TopNavProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  usePaletteShortcut(setPaletteOpen);

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/40 bg-surface-container-lowest/90 shadow-panel backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:h-20 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Open menu"
            onClick={onMenuToggle}
            className="cursor-pointer rounded-lg bg-surface-card p-1.5 text-on-surface-variant hover:text-on-surface lg:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="hidden items-center gap-1.5 md:flex">
            <ApiChip />
            <LatencyChip />
            <DebateChip />
            <SandboxChip />
            <LiveChip />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 md:flex">
            <ThreatsChip />
          </div>
          <div className="hidden items-center gap-2 border-l border-outline-variant/40 pl-3 md:flex">
            <UserBadge />
          </div>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon="search" onClick={() => setPaletteOpen(true)} aria-label={`Search (${shortcutLabel()})`} aria-keyshortcuts="Control+K Meta+K">
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-outline-variant/40 px-1 font-mono text-label md:inline">{shortcutLabel()}</kbd>
            </Button>
            <Proof
              source="browser: command palette · GET /investigations?q="
              n={1}
              asOf={null}
              definition="Jump to any page, open the scenario dialog, or search investigations. Typing asks the server (GET /investigations?q=, matching the start of the case id, the verdict class and the trigger type); nothing is stored."
              label="Search"
            />
          </span>
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
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
