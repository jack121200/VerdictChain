import { useSyncExternalStore, type ReactNode } from 'react';
import { formatDuration, formatNumber } from '../lib/format';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icon-names';
import { Metric } from '../ui/Metric';
import { Proof, type ProofProps } from '../ui/Proof';
import { getLiveStatus, subscribeLiveStatus, type LiveStatus } from '../api/live-status';
import { useShellData } from './shell-data';

type Tone = 'secondary' | 'error' | 'tertiary' | 'primary' | 'idle';

const TEXT: Record<Tone, string> = {
  secondary: 'text-secondary',
  error: 'text-error',
  tertiary: 'text-tertiary',
  primary: 'text-primary',
  idle: 'text-on-surface-variant',
};

/** One footer item: an optional glyph, the text, and its Proof. Shape and colour both carry the state. */
function Item({ tone, icon, proof, children }: { tone: Tone; icon?: IconName; proof?: Omit<ProofProps, 'label'>; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 uppercase ${TEXT[tone]}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
      {proof && <Proof {...proof} />}
    </span>
  );
}

const Separator = () => <span aria-hidden="true" className="shrink-0 text-outline-variant">|</span>;

function ChainItem() {
  const { chain } = useShellData();
  const proofBase = { source: 'GET /audit-trail, chain', n: chain.data?.chain.total ?? 0, asOf: chain.loadedAt };
  if (chain.data) {
    if (chain.data.chain.valid) {
      return (
        <Item tone="secondary" icon="verified_user" proof={{ ...proofBase, definition: 'chain.valid from GET /audit-trail: the hash-chained audit entries check out.' }}>
          Audit chain valid
        </Item>
      );
    }
    return (
      <Item tone="error" icon="warning" proof={{ ...proofBase, definition: 'chain.valid from GET /audit-trail is false: at least one audit entry does not match its hash.' }}>
        Audit chain broken
      </Item>
    );
  }
  if (chain.error !== null) {
    return (
      <Item tone="idle" icon="info" proof={{ source: 'GET /audit-trail', n: 0, asOf: null, definition: `Not verified: ${chain.error}` }}>
        Audit chain not verified
      </Item>
    );
  }
  return <Item tone="idle">Audit chain —</Item>;
}

function ThresholdItems() {
  const { settings } = useShellData();
  if (!settings.data) {
    return <span className="text-on-surface-variant">{settings.error !== null ? 'Thresholds unavailable' : 'Thresholds —'}</span>;
  }
  const values = settings.data;
  const proof = (definition: string): Omit<ProofProps, 'label'> => ({ source: 'GET /settings', n: 1, asOf: settings.loadedAt, definition });
  return (
    <>
      <span className="shrink-0 text-on-surface-variant">
        η <span className="font-bold text-primary">{formatNumber(values.eta, 2)}</span>
        <Proof {...proof('eta (η): the live value GET /settings returns, the one the credibility update uses.')} />
      </span>
      <Separator />
      <span className="shrink-0 text-on-surface-variant">
        Isolation <span className="font-bold text-primary">{formatNumber(values.isolation_threshold, 2)}</span>
        <Proof {...proof('isolation_threshold from GET /settings.')} />
      </span>
      <Separator />
      <span className="shrink-0 text-on-surface-variant">
        Verdict <span className="font-bold text-primary">{formatNumber(values.verdict_confidence_threshold, 2)}</span>
        <Proof {...proof('verdict_confidence_threshold from GET /settings.')} />
      </span>
    </>
  );
}

const LIVE_TEXT: Record<LiveStatus['state'], { text: string; tone: Tone }> = {
  connecting: { text: 'Live feed connecting', tone: 'tertiary' },
  open: { text: 'Live feed open', tone: 'secondary' },
  reconnecting: { text: 'Live feed reconnecting', tone: 'tertiary' },
  closed: { text: 'Live feed closed', tone: 'idle' },
};

function LiveItem() {
  const live = useSyncExternalStore(subscribeLiveStatus, getLiveStatus, getLiveStatus);
  const proof: Omit<ProofProps, 'label'> = {
    source: 'browser WebSocket state (api/socket.ts)',
    n: 1,
    asOf: null,
    definition: 'State of the investigation socket on this page. No socket open reads as "no socket open".',
    inputs: live ? [{ label: 'reconnect attempt', value: String(live.attempt) }] : [],
  };
  if (!live) return <Item tone="idle" proof={proof}>No socket open</Item>;
  const { text, tone } = LIVE_TEXT[live.state];
  return <Item tone={tone} proof={proof}>{text}</Item>;
}

function RedisItem() {
  const { status } = useShellData();
  if (!status.data && status.error !== null) return <Item tone="error" icon="warning">Redis unavailable</Item>;
  return (
    <span className="inline-flex shrink-0 items-center gap-2 uppercase text-on-surface-variant">
      Redis
      <Metric metric={status.data?.redis.latency_ms} size="body" format={formatDuration} label="Redis latency" />
    </span>
  );
}

/** Fixed footer strip (h-9): chain status, thresholds, live feed and Redis latency. */
export function Footer() {
  return (
    <footer className="shrink-0 border-t border-outline-variant/40 bg-surface-container-lowest/90 backdrop-blur-md">
      <div className="flex h-9 items-center justify-between gap-4 overflow-x-auto whitespace-nowrap px-4 font-mono text-label lg:px-6">
        <div className="flex items-center gap-3">
          <ChainItem />
          <Separator />
          <ThresholdItems />
          <Separator />
          <LiveItem />
          <Separator />
          <RedisItem />
        </div>
        <span className="hidden shrink-0 uppercase text-on-surface-variant md:inline">Multi-agent forensic console</span>
      </div>
    </footer>
  );
}
