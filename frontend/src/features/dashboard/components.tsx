import type { ReactNode } from 'react';
import type {
  AuditChain,
  Citation,
  DebateRound,
  FleetEntry,
  InvestigationDetail,
  InvestigationSummary,
  InvestigatorId,
  Metric as MetricEnvelope,
  ScenarioSummary,
  StatsResponse,
} from '../../api/types';
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { formatCount, formatPercent, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import type { Tone } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof, type ProofInput } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { Skeleton } from '../../ui/Skeleton';
import { Sparkline } from '../../ui/Sparkline';
import { citationStatusMeta, verdictClassTone } from './derive';

/** Chart tone per investigator (matches the agent chip colours, SKILL section 5). */
const AGENT_TONE: Record<InvestigatorId, Tone> = {
  network_traffic: 'primary',
  access_log: 'secondary',
  endpoint_behavior: 'tertiary',
};

const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

const TONE_GLYPH_BOX: Record<Tone, string> = {
  primary: 'bg-primary/10 border-primary/30 text-primary',
  secondary: 'bg-secondary/10 border-secondary/30 text-secondary',
  tertiary: 'bg-tertiary/10 border-tertiary/30 text-tertiary',
  error: 'bg-error-container/30 border-error/40 text-error',
};

const TONE_HOVER: Record<Tone, string> = {
  primary: 'hover:border-primary/50',
  secondary: 'hover:border-secondary/50',
  tertiary: 'hover:border-tertiary/50',
  error: 'hover:border-error/50',
};

const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  tertiary: 'bg-tertiary',
  error: 'bg-error',
};

const AGENT_GLYPH: Record<InvestigatorId, string> = {
  network_traffic: 'α',
  access_log: 'β',
  endpoint_behavior: 'γ',
};

const PERCENT0 = (value: number) => formatPercent(value, 0);
const PERCENT1 = (value: number) => formatPercent(value, 1);

/**
 * A live value rendered in the reference's exact typography, backed by a Metric envelope: it
 * shows "—" with no fabricated number when value is null, and always carries a Proof (no-bluff R1/R2).
 */
function Stat({
  metric,
  className,
  format = formatCount,
  label,
  proofInputs,
}: {
  metric: MetricEnvelope<number> | undefined;
  className?: string;
  format?: (value: number) => string;
  label: string;
  proofInputs?: readonly ProofInput[];
}) {
  const text = !metric || metric.value === null ? '—' : format(metric.value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={className}>{text}</span>
      {metric && (
        <Proof
          source={metric.source}
          n={metric.n}
          asOf={metric.as_of}
          definition={metric.definition}
          reason={metric.reason}
          inputs={proofInputs}
          label={label}
        />
      )}
    </span>
  );
}

// ---- 1. Tactical status banner + telemetry cards ----------------------------------

export interface TacticalBannerProps {
  threat: InvestigationSummary | null;
  loading: boolean;
  subject: string | null;
  host: string | null;
  primaryAgentName: string | null;
  chain: AuditChain | undefined;
  chainLoadedAt: string | null;
  stats: StatsResponse | undefined;
}

export function TacticalBanner({
  threat,
  loading,
  subject,
  host,
  primaryAgentName,
  chain,
  chainLoadedAt,
  stats,
}: TacticalBannerProps) {
  return (
    <section className="relative flex flex-col gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl">
      {/* Incident strip */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-outline-variant/30 bg-background p-3 lg:flex-row lg:items-center">
        {threat === null ? (
          loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <span className="font-body text-[13px] text-on-surface-variant">
              No threat verdict yet — the incident banner tracks the most recent investigation with a threat-class verdict.
            </span>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded border border-error/40 bg-error-container/30 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-error">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-error opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-error" />
              </span>
              Active incident
            </span>
            <span className="font-headline text-base font-semibold tracking-tight text-on-surface sm:text-lg">
              {threat.dataset ?? 'Investigation'} ·{' '}
              <strong className="font-mono text-primary">{shortId(threat.id)}</strong>
            </span>
            <span className="hidden text-outline-variant sm:inline">•</span>
            <span className="inline-flex items-center gap-1">
              <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase', verdictPillClass(threat.verdict_class))}>
                {threat.verdict_class ?? 'no class'}
              </span>
            </span>
            <div className="flex items-center gap-2 font-mono text-xs text-on-surface-variant">
              <span>SUBJECT</span>
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 font-semibold text-tertiary">
                {subject ?? '—'}
              </span>
              <span>HOST</span>
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 font-semibold text-primary">
                {host ?? '—'}
              </span>
              {primaryAgentName && threat.primary_agent && (
                <span className="text-outline">· domain {primaryAgentName}</span>
              )}
              <Proof
                source="GET /investigations/{id}/citations"
                n={1}
                asOf={null}
                label="Incident subject and host"
                definition="The most-cited user_id and host_id across this investigation's citations. '—' when no citation names that field. No identifiers are typed in."
              />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
          {chain ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1',
                chain.valid ? 'border-secondary/30 bg-surface-card text-secondary' : 'border-error/40 bg-surface-card text-error',
              )}
            >
              <Icon name={chain.valid ? 'verified_user' : 'warning'} size={12} />
              <span>Log integrity: {chain.valid ? 'chain valid' : 'chain broken'}</span>
              <Proof
                source="GET /audit-trail (chain.valid)"
                n={chain.total}
                asOf={chainLoadedAt}
                label="Log integrity"
                definition="chain.valid over the SHA-256 hash-chained audit entries. n is the total number of entries."
              />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-card px-2.5 py-1 text-on-surface-variant">
              Log integrity: not verified
            </span>
          )}
        </div>
      </div>

      {/* Telemetry cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <TelemetryCard
          label="Investigating now"
          icon="hub"
          tone="primary"
          metric={stats?.active}
          sub={<span className="text-on-surface-variant">Live debate slots</span>}
        />
        <TelemetryCard
          label="Insider verdicts"
          icon="warning"
          tone="tertiary"
          metric={stats?.insider_count}
          sub={
            <span className="inline-flex items-center gap-1 text-on-surface-variant">
              agent-reported conf.
              <Stat
                metric={stats?.mean_agent_confidence}
                className="font-semibold text-tertiary"
                format={PERCENT1}
                label="Mean agent-reported confidence (insider)"
              />
            </span>
          }
        />
        <TelemetryCard
          label="Fleet credibility"
          icon="verified_user"
          tone="secondary"
          metric={stats?.mean_crs}
          format={PERCENT1}
          sub={<span className="text-on-surface-variant">Mean CrS · n = 3</span>}
        />
        <TelemetryCard
          label="Containment actions"
          icon="admin_panel_settings"
          tone="primary"
          metric={stats?.self_healing?.actions_total}
          sub={
            <span className="inline-flex items-center gap-1 text-on-surface-variant">
              non-simulated
              <Stat metric={stats?.self_healing?.non_simulated} className="font-semibold text-secondary" label="Non-simulated containment actions" />
            </span>
          }
        />
      </div>
    </section>
  );
}

function TelemetryCard({
  label,
  icon,
  tone,
  metric,
  format = formatCount,
  sub,
}: {
  label: string;
  icon: 'hub' | 'warning' | 'verified_user' | 'admin_panel_settings';
  tone: Tone;
  metric: MetricEnvelope<number> | undefined;
  format?: (value: number) => string;
  sub: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-card p-4 shadow-md transition-all',
        TONE_HOVER[tone],
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</span>
        <Icon name={icon} size={20} className={TONE_TEXT[tone]} />
      </div>
      <Stat metric={metric} className={cn('font-headline text-3xl font-bold', TONE_TEXT[tone])} format={format} label={label} />
      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pt-2 font-mono text-[10px]">{sub}</div>
      <div aria-hidden="true" className="absolute bottom-0 left-0 h-0.5 w-full bg-surface-container-highest">
        <div className={cn('h-full w-full', TONE_BAR[tone])} />
      </div>
    </div>
  );
}

function verdictPillClass(verdictClass: InvestigationSummary['verdict_class']): string {
  const tone = verdictClassTone(verdictClass);
  switch (tone) {
    case 'error':
      return 'border border-error/30 bg-error-container/40 text-error';
    case 'secondary':
      return 'border border-secondary/30 bg-secondary/20 text-secondary';
    case 'tertiary':
      return 'border border-tertiary/30 bg-tertiary/20 text-tertiary';
    default:
      return 'border border-outline-variant/40 bg-surface-container-high text-on-surface-variant';
  }
}

// ---- 2. Scenario control bar ------------------------------------------------------

export interface ScenarioBarProps {
  scenarios: readonly ScenarioSummary[] | undefined;
  selected: string | null;
  onSelect: (label: string) => void;
  canInject: boolean;
  onInject: () => void;
  onConfigure: () => void;
  blindProof: ReactNode;
}

export function ScenarioBar({ scenarios, selected, onSelect, canInject, onInject, onConfigure, blindProof }: ScenarioBarProps) {
  return (
    <section className="flex flex-col justify-between gap-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-lg md:flex-row md:items-center">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs font-semibold uppercase text-on-surface-variant">
          <Icon name="dashboard" size={16} className="text-primary" />
          <span>Attack dataset matrix:</span>
        </div>

        <div className="relative min-w-[260px] max-w-md flex-1">
          <select
            value={selected ?? ''}
            onChange={(event) => onSelect(event.target.value)}
            aria-label="Attack dataset scenario"
            className="w-full cursor-pointer appearance-none rounded border border-outline-variant/60 bg-background py-2 pl-3 pr-8 font-mono text-xs text-on-surface transition-all focus:border-primary focus:outline-none"
          >
            {scenarios === undefined ? (
              <option value="">Loading scenarios…</option>
            ) : (
              scenarios.map((scenario) => (
                <option key={scenario.label} value={scenario.label}>
                  {scenario.dataset} · {scenario.label} — {scenario.description}
                </option>
              ))
            )}
          </select>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-outline">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 bg-surface-container-high px-3 py-1.5 font-mono text-xs text-on-surface-variant">
          <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
          <span>
            Ground-truth: <strong className="text-on-surface">masked from pod swarm</strong>
          </span>
          {blindProof}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Button variant="primary" icon="sync_alt" onClick={onInject} disabled={!canInject}>
          Inject simulation stream
        </Button>
        <button
          type="button"
          onClick={onConfigure}
          title="Configure scenario"
          aria-label="Configure scenario"
          disabled={!canInject}
          className="cursor-pointer rounded border border-outline-variant/40 bg-surface-container-high p-2 text-primary transition-colors hover:bg-surface-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="admin_panel_settings" size={16} />
        </button>
      </div>
    </section>
  );
}

// ---- 3. Investigator pod triad ----------------------------------------------------

function agentTurnsAcrossRounds(rounds: readonly DebateRound[], agentId: InvestigatorId) {
  return [...rounds]
    .sort((a, b) => a.round - b.round)
    .map((round) => ({ round: round.round, turn: round.agents.find((turn) => turn.agent_id === agentId) }))
    .filter((entry): entry is { round: number; turn: NonNullable<(typeof entry)['turn']> } => entry.turn !== undefined);
}

function stanceLabel(stance: string | null): string {
  return stance ?? 'stance not stated';
}

function stanceToneText(stance: string | null): string {
  if (stance === 'SUPPORT') return 'text-secondary';
  if (stance === 'CHALLENGE') return 'text-tertiary';
  if (stance === 'REVISE') return 'text-primary';
  return 'text-on-surface-variant';
}

function Pod({ entry, detail }: { entry: FleetEntry; detail: InvestigationDetail | undefined }) {
  const agentId = entry.agent_id;
  const tone = AGENT_TONE[agentId];
  const turns = detail ? agentTurnsAcrossRounds(detail.rounds, agentId) : [];
  const latest = turns.length > 0 ? turns[turns.length - 1] : null;
  const confidences = turns.map((entry) => entry.turn.confidence);

  return (
    <div className={cn('flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-card p-4 shadow-xl transition-all', TONE_HOVER[tone])}>
      <div>
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant/30 pb-3">
          <div className="flex items-center gap-2.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg border font-mono text-base font-bold', TONE_GLYPH_BOX[tone])}>
              {AGENT_GLYPH[agentId]}
            </span>
            <div>
              <div className="font-headline text-base font-bold text-on-surface">{entry.display_name}</div>
              <div className="font-mono text-[10px] text-on-surface-variant">{entry.domain}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-right">
            <Ring value={entry.crs.value} tone={tone} size={44} strokeWidth={4} label={`Credibility, ${entry.display_name}`}>
              <span className={cn('font-mono text-[10px] font-bold', TONE_TEXT[tone])}>
                {entry.crs.value === null ? '—' : PERCENT0(entry.crs.value)}
              </span>
            </Ring>
            <div>
              <Stat metric={entry.crs} className={cn('font-headline text-lg font-bold', TONE_TEXT[tone])} format={PERCENT1} label={`Credibility, ${entry.display_name}`} />
              <div className="font-mono text-[9px] uppercase text-on-surface-variant">Credibility</div>
            </div>
          </div>
        </div>

        <div className="mb-3 rounded-lg border border-outline-variant/30 bg-background p-3">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-on-surface-variant">FORMAL STANCE</span>
            <span className={cn('font-semibold', stanceToneText(latest?.turn.stance ?? null))}>{stanceLabel(latest?.turn.stance ?? null)}</span>
          </div>
          {latest === null ? (
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">No debate yet for this agent.</p>
          ) : (
            <p className="line-clamp-4 font-body text-xs leading-relaxed text-on-surface">{latest.turn.theory}</p>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-outline-variant/20 pt-1.5 font-mono text-[9px] text-on-surface-variant">
            <span>
              Last vote: <span className="text-on-surface">{entry.last_vote ?? 'no vote'}</span>
            </span>
            <Proof
              source="GET /agents/fleet (last_vote) · GET /investigations/{id} (rounds)"
              n={turns.length}
              asOf={null}
              label="Formal stance"
              definition="The verdict class this agent voted in its latest scored debate (server classify_theory), plus the server-parsed stance prefix (SUPPORT / CHALLENGE / REVISE) of its latest theory."
            />
          </div>
        </div>

        <div className="space-y-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-2.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
            <span>Agent-reported confidence by round</span>
            <span className={cn('font-semibold', TONE_TEXT[tone])}>{latest === null ? '—' : PERCENT1(latest.turn.confidence)}</span>
          </div>
          {confidences.length === 0 ? (
            <p className="font-mono text-[10px] text-on-surface-variant">no rounds yet</p>
          ) : (
            <Sparkline values={confidences} min={0} max={1} tone={tone} width={240} height={40} className="w-full" label="Confidence by round" />
          )}
          <div className="flex items-center justify-end">
            <Proof
              source="GET /investigations/{id} (rounds[].agents[].confidence)"
              n={confidences.length}
              asOf={null}
              label="Confidence trajectory"
              definition="Self-reported confidence per round in this agent's latest investigation. Self-reported, not calibrated accuracy (R4)."
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-outline-variant/20 pt-2 font-mono text-[10px] text-on-surface-variant">
        <span>
          Rounds scored: <Stat metric={entry.rounds_scored} className="text-on-surface" label="Rounds scored" />
        </span>
        {entry.isolated ? (
          <span className="flex items-center gap-1 font-semibold text-error">
            <Icon name="warning" size={12} /> Isolated
          </span>
        ) : (
          <span className="flex items-center gap-1 font-semibold text-secondary">
            <Icon name="verified_user" size={12} /> Active
          </span>
        )}
      </div>
    </div>
  );
}

export interface PodTriadProps {
  fleet: FleetEntry[] | undefined;
  detail: InvestigationDetail | undefined;
  meanCrs: MetricEnvelope<number> | undefined;
}

export function PodTriad({ fleet, detail, meanCrs }: PodTriadProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Investigator pod triad</span>
          <span className="text-outline-variant">•</span>
          <span className="font-mono text-xs text-on-surface-variant">3 rounds of dialectical scrutiny</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded border border-secondary/30 bg-surface-card px-2.5 py-0.5 font-mono text-xs font-semibold text-secondary">
          Mean credibility <Stat metric={meanCrs} className="font-semibold text-secondary" format={PERCENT1} label="Mean fleet credibility" />
        </span>
      </div>

      {fleet === undefined ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : fleet.length === 0 ? (
        <EmptyState title="No investigators reported" description="GET /agents/fleet returned no investigators." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {fleet.map((entry) => (
            <Pod key={entry.agent_id} entry={entry} detail={detail} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---- 4. Verdict ledger + terminal -------------------------------------------------

export interface VerdictLedgerProps {
  rows: readonly InvestigationSummary[];
  loading: boolean;
  hashFor: (investigationId: string) => string | null;
  debateRounds: number | undefined;
  headSeq: number | null;
  chainLoadedAt: string | null;
}

export function VerdictLedger({ rows, loading, hashFor, debateRounds, headSeq, chainLoadedAt }: VerdictLedgerProps) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 shadow-xl lg:col-span-7">
      <div>
        <div className="mb-3 flex items-center justify-between border-b border-outline-variant/30 pb-2">
          <div className="flex items-center gap-2">
            <Icon name="receipt_long" size={20} className="text-primary" />
            <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Verdict ledger</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-secondary">
            Deterministic aggregation
            <Proof
              source="GET /investigations · GET /audit-trail (verdict_reached)"
              n={rows.length}
              asOf={chainLoadedAt}
              label="Verdict ledger"
              definition="The most recent investigations. The audit hash is the entry_hash of each investigation's verdict_reached audit entry. Aggregation of votes is deterministic code."
            />
          </span>
        </div>

        {rows.length === 0 ? (
          loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <EmptyState title="No investigations yet" description="Inject a scenario to start the first debate." />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <caption className="sr-only">Recent investigations and their verdicts</caption>
              <thead>
                <tr className="border-b border-outline-variant/40 bg-background text-[10px] uppercase text-on-surface-variant">
                  {['Incident ref', 'Vector / ingestion', 'Debate', 'Final verdict', 'Agent-reported conf.', 'Audit hash'].map((header, index) => (
                    <th key={header} scope="col" className={cn('px-3 py-2 font-semibold', index === 5 && 'text-right')}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {rows.map((row) => {
                  const hash = hashFor(row.id);
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-surface-card">
                      <td className="px-3 py-2.5">
                        <a href={buildRoute({ name: 'debate', id: row.id })} className="font-semibold text-primary hover:underline">
                          {shortId(row.id)}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-on-surface">{row.dataset ?? '—'}</td>
                      <td className="px-3 py-2.5 font-semibold text-secondary">
                        {row.rounds_complete}
                        {debateRounds !== undefined ? `/${debateRounds}` : ''}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', verdictPillClass(row.verdict_class))}>
                          {row.verdict_class ?? row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-on-surface">
                        {row.verdict_confidence === null ? '—' : PERCENT1(row.verdict_confidence)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {hash ? <CopyHash value={hash} label={`verdict audit hash for ${shortId(row.id)}`} /> : <span className="text-on-surface-variant">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between rounded border-t border-outline-variant/30 bg-background p-2 font-mono text-[10px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="receipt_long" size={12} className="text-secondary" />
          Audit head seq <span className="text-secondary">{headSeq ?? '—'}</span>
          <Proof source="GET /audit-trail (chain.head_seq)" n={1} asOf={chainLoadedAt} label="Audit head seq" definition="The sequence number of the latest audit entry." />
        </span>
        <a href={buildRoute({ name: 'audit' })} className="text-primary hover:underline">
          Open audit trail →
        </a>
      </div>
    </div>
  );
}

// ---- terminal stream --------------------------------------------------------------

export interface TerminalLine {
  key: string;
  time: string;
  body: string;
  tone: Tone | 'neutral';
}

const TERMINAL_TEXT: Record<Tone | 'neutral', string> = {
  neutral: 'text-on-surface-variant',
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export function TerminalStream({ lines, onClear, loadedAt }: { lines: readonly TerminalLine[]; onClear: () => void; loadedAt: string | null }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-outline-variant/40 bg-background p-4 shadow-2xl lg:col-span-5">
      <div>
        <div className="mb-2 flex items-center justify-between border-b border-outline-variant/30 pb-2">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <span className="font-mono text-xs font-semibold uppercase text-on-surface">Audit event stream</span>
            <Proof
              source="GET /audit-trail (tail)"
              n={lines.length}
              asOf={loadedAt}
              label="Audit stream"
              definition="The most recent audit-trail entries, newest last. Clear hides the view only; a refresh restores it. Live WebSocket events appear on the debate room."
            />
          </div>
          <button type="button" onClick={onClear} className="cursor-pointer font-mono text-[10px] text-on-surface-variant hover:text-on-surface">
            CLEAR
          </button>
        </div>

        <div className="h-64 space-y-1.5 overflow-y-auto rounded border border-outline-variant/20 bg-surface-container-lowest p-2 font-mono text-[10px]">
          {lines.length === 0 ? (
            <p className="text-on-surface-variant">No audit entries to show.</p>
          ) : (
            lines.map((line) => (
              <div key={line.key} className="leading-relaxed">
                <span className="text-primary">[{line.time}]</span> <span className={TERMINAL_TEXT[line.tone]}>{line.body}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 5. Forensic evidence traces --------------------------------------------------

/** Decorative reference images, kept per user directive 0b. Captions are driven by real citations only. */
const EVIDENCE_IMAGES: readonly { src: string; alt: string }[] = [
  { src: '/assets/usb-chip-macro.jpg', alt: 'Abstract macro photograph of a circuit board, decorative' },
  { src: '/assets/datacenter-racks.jpg', alt: 'Abstract server racks with fibre cabling, decorative' },
  { src: '/assets/turnstile-badge-desk.jpg', alt: 'Abstract security operations desk, decorative' },
];

export function EvidenceTraces({ citations, loading }: { citations: readonly Citation[] | undefined; loading: boolean }) {
  const shown = (citations ?? []).slice(0, 3);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="font-headline text-base font-semibold uppercase tracking-wider text-on-surface">Cited forensic evidence</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase text-on-surface-variant">
          Latest cited rows, checked against raw_logs
          <Proof
            source="GET /investigations/{id}/citations"
            n={citations?.length ?? 0}
            asOf={null}
            label="Evidence traces"
            definition="The latest investigation's cited raw_logs rows: row id, field, value and the Watchdog's per-citation status. The images are decorative; every caption is a real cited value."
          />
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {EVIDENCE_IMAGES.map((image, index) => {
            const citation = shown[index];
            const meta = citation ? citationStatusMeta(citation.status) : null;
            return (
              <div
                key={image.src}
                className={cn(
                  'group flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-card shadow-lg transition-all',
                  meta ? TONE_HOVER[meta.tone] : 'hover:border-outline-variant',
                )}
              >
                <div className="relative h-44 w-full overflow-hidden">
                  <img src={image.src} alt={image.alt} className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
                  <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-surface-card via-transparent to-transparent" />
                  {citation ? (
                    <>
                      <div className="absolute left-2 top-2 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary backdrop-blur">
                        row {citation.row_id}
                      </div>
                      <div className={cn('absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold backdrop-blur', TONE_TEXT[meta!.tone])}>
                        <Icon name={meta!.icon} size={12} /> {meta!.label}
                      </div>
                    </>
                  ) : (
                    <div className="absolute left-2 top-2 rounded bg-surface-container-lowest/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-on-surface-variant backdrop-blur">
                      Forensic console
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-3.5">
                  {citation ? (
                    <>
                      <div className="font-mono text-xs font-semibold text-on-surface">
                        {citation.field}: <span className="text-on-surface-variant">{citation.value ?? '—'}</span>
                      </div>
                      {citation.status === 'DISCREPANCY' && citation.expected !== null && (
                        <div className="font-mono text-[10px] text-tertiary">expected: {citation.expected}</div>
                      )}
                      <div className="flex items-center justify-between border-t border-outline-variant/20 pt-2 font-mono text-[10px] text-on-surface-variant">
                        <span>
                          cited by <span className="text-on-surface">{AGENT_GLYPH[citation.agent_id]} {citation.agent_id}</span>
                        </span>
                        <span>round {citation.round}</span>
                      </div>
                      {citation.row_fingerprint && <CopyHash value={citation.row_fingerprint} label={`row fingerprint for row ${citation.row_id}`} />}
                    </>
                  ) : (
                    <>
                      <div className="font-headline text-base font-semibold text-on-surface">Awaiting cited evidence</div>
                      <p className="font-body text-xs leading-relaxed text-on-surface-variant">
                        This panel fills with a real cited raw_logs row once the latest investigation cites more evidence.
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
