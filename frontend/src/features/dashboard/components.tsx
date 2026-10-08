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
  StatsResponse,
} from '../../api/types';
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { formatCount, formatNumber, formatPercent, shortId } from '../../lib/format';
import { AgentChip } from '../../ui/AgentChip';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import type { Tone } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof, type ProofInput } from '../../ui/Proof';
import { Ring } from '../../ui/Ring';
import { SectionHeader } from '../../ui/Headings';
import { Skeleton } from '../../ui/Skeleton';
import { Sparkline } from '../../ui/Sparkline';
import { StatusDot } from '../../ui/StatusDot';
import { citationStatusMeta, investigationStatusMeta, verdictClassTone } from './derive';

/** Chart tone per investigator (matches the agent chip colours, SKILL section 5). */
const AGENT_TONE: Record<InvestigatorId, Tone> = {
  network_traffic: 'primary',
  access_log: 'secondary',
  endpoint_behavior: 'tertiary',
};

const PERCENT0 = (value: number) => formatPercent(value, 0);
const PERCENT1 = (value: number) => formatPercent(value, 1);

// ---- incident banner ---------------------------------------------------------------

export interface IncidentBannerProps {
  threat: InvestigationSummary | null;
  loading: boolean;
  subject: string | null;
  host: string | null;
  primaryAgentName: string | null;
  chain: AuditChain | undefined;
  chainLoadedAt: string | null;
}

export function IncidentBanner({ threat, loading, subject, host, primaryAgentName, chain, chainLoadedAt }: IncidentBannerProps) {
  return (
    <Card variant="panel" hairline className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/30 bg-background p-3 lg:flex-row lg:items-center lg:justify-between">
        {threat === null ? (
          loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <EmptyState
              title="No threat verdict yet"
              description="The incident banner shows the most recent investigation whose verdict is a threat class."
            />
          )
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="error" icon="warning">
              Active incident
            </Pill>
            <span className="font-mono text-evidence text-primary">{shortId(threat.id)}</span>
            <Pill tone={verdictClassTone(threat.verdict_class)}>{threat.verdict_class ?? 'no class'}</Pill>
            {threat.dataset && <span className="text-caption text-on-surface-variant">{threat.dataset}</span>}
            {primaryAgentName && threat.primary_agent && (
              <span className="inline-flex items-center gap-1.5 text-caption text-on-surface-variant">
                domain
                <AgentChip agentId={threat.primary_agent} name={primaryAgentName} />
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 font-mono text-evidence text-on-surface-variant">
              subject
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 text-tertiary">
                {subject ?? '—'}
              </span>
              host
              <span className="rounded border border-outline-variant/30 bg-surface-card px-1.5 py-0.5 text-primary">
                {host ?? '—'}
              </span>
              <Proof
                source="GET /investigations/{id}/citations"
                n={1}
                asOf={null}
                label="Incident subject and host"
                definition="The most-cited user_id and host_id values across this investigation's citations. '—' when no citation names that field."
              />
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 font-mono text-evidence">
          {chain ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1',
                chain.valid ? 'border-secondary/30 text-secondary' : 'border-error/40 text-error',
              )}
            >
              <Icon name={chain.valid ? 'verified_user' : 'warning'} size={12} />
              {chain.valid ? 'Log integrity: chain valid' : 'Log integrity: chain broken'}
              <Proof
                source="GET /audit-trail (chain.valid)"
                n={chain.total}
                asOf={chainLoadedAt}
                label="Log integrity"
                definition="chain.valid over the hash-chained audit entries. n is the total number of entries."
              />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-outline-variant/40 px-2.5 py-1 text-on-surface-variant">
              Log integrity: not verified
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---- KPI tiles ---------------------------------------------------------------------

interface KpiTileProps {
  label: string;
  metric: MetricEnvelope<number> | undefined;
  proofLabel: string;
  tone: Tone;
  sub?: ReactNode;
  format?: (value: number) => string;
  proofInputs?: readonly ProofInput[];
}

function KpiTile({ label, metric, proofLabel, tone, sub, format, proofInputs }: KpiTileProps) {
  const TONE_BAR: Record<Tone, string> = {
    primary: 'bg-primary',
    secondary: 'bg-secondary',
    tertiary: 'bg-tertiary',
    error: 'bg-error',
  };
  return (
    <Card className="flex flex-col justify-between gap-3">
      <span className="text-label uppercase text-on-surface-variant">{label}</span>
      <Metric metric={metric} label={proofLabel} size="kpi" format={format} proofInputs={proofInputs} />
      <div className="flex items-center justify-between text-caption text-on-surface-variant">{sub}</div>
      <div aria-hidden="true" className="h-0.5 w-full rounded-full bg-surface-container-highest">
        <div className={cn('h-full w-full rounded-full', TONE_BAR[tone])} />
      </div>
    </Card>
  );
}

export function KpiTiles({ stats, loadedAt }: { stats: StatsResponse | undefined; loadedAt: string | null }) {
  const confidence = stats?.mean_agent_confidence;
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile label="Investigating now" metric={stats?.active} proofLabel="Investigations running now" tone="primary" sub={<span>Live debate slots</span>} />
      <KpiTile
        label="Insider verdicts"
        metric={stats?.insider_count}
        proofLabel="Insider verdicts"
        tone="tertiary"
        sub={
          <span className="inline-flex items-center gap-1.5">
            agent-reported conf.
            <Metric metric={confidence} size="body" label="Mean agent-reported confidence (insider)" format={PERCENT1} />
          </span>
        }
      />
      <KpiTile
        label="Fleet credibility"
        metric={stats?.mean_crs}
        proofLabel="Mean credibility across the 3 investigators"
        tone="secondary"
        format={PERCENT1}
        proofInputs={loadedAt ? [{ label: 'as of', value: loadedAt }] : undefined}
        sub={<span>Mean CrS · n = 3</span>}
      />
      <KpiTile
        label="Containment actions"
        metric={stats?.self_healing.actions_total}
        proofLabel="Containment actions (all simulated)"
        tone="primary"
        sub={
          <span className="inline-flex items-center gap-1.5">
            non-simulated
            <Metric metric={stats?.self_healing.non_simulated} size="body" label="Non-simulated containment actions" />
          </span>
        }
      />
    </div>
  );
}

// ---- scenario control bar ----------------------------------------------------------

export interface ScenarioControlProps {
  canInject: boolean;
  onInject: () => void;
  blindTestNote: ReactNode;
}

export function ScenarioControl({ canInject, onInject, blindTestNote }: ScenarioControlProps) {
  return (
    <Card variant="panel" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-label uppercase text-on-surface-variant">Scenario injection</span>
        <span className="inline-flex items-center gap-1.5 rounded border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-caption text-secondary">
          <StatusDot tone="ok" />
          Ground-truth masked from the pod swarm
          {blindTestNote}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="primary" onClick={onInject} disabled={!canInject}>
          Inject simulation
        </Button>
        <Proof
          source="POST /investigations/simulate (opened via the modal)"
          n={1}
          asOf={null}
          label="Inject simulation"
          definition="Opens the scenario modal. The modal starts a real simulated investigation (wait=false) and opens its debate room. Disabled without the inject_scenario capability."
        />
      </div>
    </Card>
  );
}

// ---- pod triad ---------------------------------------------------------------------

function agentTurnsAcrossRounds(rounds: readonly DebateRound[], agentId: InvestigatorId) {
  return [...rounds]
    .sort((a, b) => a.round - b.round)
    .map((round) => ({ round: round.round, turn: round.agents.find((turn) => turn.agent_id === agentId) }))
    .filter((entry): entry is { round: number; turn: NonNullable<(typeof entry)['turn']> } => entry.turn !== undefined);
}

function StanceBadge({ stance }: { stance: string | null }) {
  if (stance === null) return <Pill tone="neutral">stance not stated</Pill>;
  const tone: Tone = stance === 'SUPPORT' ? 'secondary' : stance === 'CHALLENGE' ? 'tertiary' : 'primary';
  return <Pill tone={tone}>{stance}</Pill>;
}

function CitationsPerRound({ counts, tone }: { counts: readonly number[]; tone: Tone }) {
  const max = counts.reduce((top, value) => Math.max(top, value), 0);
  const BAR: Record<Tone, string> = {
    primary: 'bg-primary-container',
    secondary: 'bg-secondary',
    tertiary: 'bg-tertiary',
    error: 'bg-error',
  };
  if (counts.length === 0 || max === 0) {
    return <span className="text-caption text-on-surface-variant">no citations yet</span>;
  }
  return (
    <div className="flex h-8 items-end gap-1" role="img" aria-label={`Citations per round: ${counts.join(', ')}`}>
      {counts.map((count, index) => (
        <div key={index} className="flex flex-1 flex-col items-center justify-end">
          <div
            className={cn('w-full rounded-t', BAR[tone])}
            style={{ height: `${Math.max(8, (count / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

interface PodProps {
  entry: FleetEntry;
  detail: InvestigationDetail | undefined;
}

function Pod({ entry, detail }: PodProps) {
  const agentId = entry.agent_id;
  const tone = AGENT_TONE[agentId];
  const turns = detail ? agentTurnsAcrossRounds(detail.rounds, agentId) : [];
  const latest = turns.length > 0 ? turns[turns.length - 1] : null;
  const confidences = turns.map((entry) => entry.turn.confidence);
  const citationCounts = turns.map((entry) => entry.turn.cited_evidence.length);

  return (
    <Card hoverTone={tone} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant/30 pb-3">
        <div className="flex flex-col gap-1">
          <AgentChip agentId={agentId} name={entry.display_name} />
          <span className="text-caption text-on-surface-variant">{entry.domain}</span>
        </div>
        <Ring value={entry.crs.value} tone={tone} label={`Credibility, ${entry.display_name}`}>
          <span className="font-mono text-evidence text-on-surface">
            {entry.crs.value === null ? '—' : PERCENT0(entry.crs.value)}
          </span>
        </Ring>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-caption text-on-surface-variant">
          Credibility
          <Metric metric={entry.crs} size="body" label={`Credibility, ${entry.display_name}`} format={PERCENT1} />
        </span>
        {entry.isolated && <Pill tone="error" icon="warning">Isolated</Pill>}
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-outline-variant/30 bg-background p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label uppercase text-on-surface-variant">Formal stance</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-evidence text-on-surface">{entry.last_vote ?? 'no vote'}</span>
            <Proof
              source="GET /agents/fleet (last_vote)"
              n={1}
              asOf={null}
              label="Formal stance class"
              definition="The verdict class this agent voted in its latest scored debate (server classify_theory). 'no vote' until a debate is scored."
            />
          </span>
        </div>
        {latest === null ? (
          <p className="text-caption text-on-surface-variant">no debate yet</p>
        ) : (
          <>
            <StanceBadge stance={latest.turn.stance} />
            <p className="line-clamp-4 text-caption text-on-surface">{latest.turn.theory}</p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/20 bg-background p-2.5">
        <span className="inline-flex items-center gap-1.5 text-caption text-on-surface-variant">
          Agent-reported confidence
          <Proof
            source="GET /investigations/{id} (rounds[].agents[].confidence)"
            n={confidences.length}
            asOf={null}
            label="Confidence trajectory"
            definition="Self-reported confidence per round in this agent's latest investigation. Self-reported, not calibrated accuracy (R4)."
          />
        </span>
        {latest === null ? (
          <span className="text-caption text-on-surface-variant">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <Sparkline values={confidences} min={0} max={1} tone={tone} label="Confidence by round" />
            <span className="font-mono text-evidence" style={undefined}>
              <span className={`text-${tone === 'primary' ? 'primary' : tone}`}>{PERCENT0(latest.turn.confidence)}</span>
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-caption text-on-surface-variant">
            Verified citations
            <Proof
              source="GET /agents/fleet (citations_verified / citations_total)"
              n={entry.citations_total.value ?? 0}
              asOf={null}
              label="Verified citations"
              definition="Citations by this agent that the Watchdog verified against raw_logs, over its total citations."
            />
          </span>
          <span className="font-mono text-evidence text-on-surface">
            <Metric metric={entry.citations_verified} size="body" label="Verified citations" /> /{' '}
            <Metric metric={entry.citations_total} size="body" label="Total citations" />
          </span>
        </div>
        <CitationsPerRound counts={citationCounts} tone={tone} />
      </div>
    </Card>
  );
}

export function PodTriad({ fleet, detail }: { fleet: FleetEntry[] | undefined; detail: InvestigationDetail | undefined }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader eyebrow="3 rounds of dialectical scrutiny" title="Investigator pod triad" />
      {fleet === undefined ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
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

// ---- verdict ledger ----------------------------------------------------------------

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
    <Card variant="panel" className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Recent investigations"
        title="Verdict ledger"
        action={
          <Proof
            source="GET /investigations · GET /audit-trail (verdict_reached)"
            n={rows.length}
            asOf={chainLoadedAt}
            label="Verdict ledger"
            definition="The most recent investigations. The audit hash is the entry_hash of each investigation's verdict_reached audit entry."
          />
        }
      />
      {rows.length === 0 ? (
        loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <EmptyState title="No investigations yet" description="Inject a scenario to start the first debate." />
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface-card">
          <table className="w-full min-w-max border-collapse text-left text-body">
            <caption className="sr-only">Recent investigations and their verdicts</caption>
            <thead className="bg-surface-container-low">
              <tr>
                {['Investigation', 'Dataset', 'Debate', 'Verdict', 'Agent-reported conf.', 'Verdict hash'].map((header) => (
                  <th key={header} scope="col" className="px-3 py-2 text-label uppercase text-on-surface-variant">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const hash = hashFor(row.id);
                const status = investigationStatusMeta(row.status);
                return (
                  <tr key={row.id} className="border-t border-outline-variant/40 transition-colors hover:bg-surface-container-high/50">
                    <td className="px-3 py-2">
                      <a href={buildRoute({ name: 'debate', id: row.id })} className="font-mono text-evidence text-primary hover:underline">
                        {shortId(row.id)}
                      </a>
                    </td>
                    <td className="px-3 py-2 font-mono text-evidence text-on-surface-variant">{row.dataset ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-evidence text-on-surface">
                      {row.rounds_complete}
                      {debateRounds !== undefined ? `/${debateRounds}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Pill tone={verdictClassTone(row.verdict_class)}>{row.verdict_class ?? status.label}</Pill>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-evidence text-on-surface">
                      {row.verdict_confidence === null ? '—' : formatPercent(row.verdict_confidence, 1)}
                    </td>
                    <td className="px-3 py-2">
                      {hash ? <CopyHash value={hash} label={`verdict audit hash for ${shortId(row.id)}`} /> : <span className="text-on-surface-variant">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg bg-background p-2 text-caption text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          Audit head seq
          <span className="font-mono text-evidence text-secondary">{headSeq ?? '—'}</span>
          <Proof source="GET /audit-trail (chain.head_seq)" n={1} asOf={chainLoadedAt} label="Audit head seq" definition="The sequence number of the latest audit entry." />
        </span>
        <a href={buildRoute({ name: 'audit' })} className="text-primary hover:underline">
          Open audit trail →
        </a>
      </div>
    </Card>
  );
}

// ---- terminal stream ---------------------------------------------------------------

export interface TerminalLine {
  key: string;
  seq: number;
  time: string;
  body: string;
  tone: Tone | 'neutral';
}

const TONE_TEXT: Record<Tone | 'neutral', string> = {
  neutral: 'text-on-surface',
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export function TerminalStream({ lines, onClear, loadedAt }: { lines: readonly TerminalLine[]; onClear: () => void; loadedAt: string | null }) {
  return (
    <Card className="flex flex-col gap-2 bg-surface-container-lowest">
      <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2">
        <span className="inline-flex items-center gap-2">
          <StatusDot tone="live" label="Live audit stream" />
          <span className="text-label uppercase text-on-surface">Audit stream</span>
          <Proof
            source="GET /audit-trail (tail) + live WS events"
            n={lines.length}
            asOf={loadedAt}
            label="Audit stream"
            definition="The last audit entries, plus live WebSocket events while a debate is running. Clear hides the view only; a refresh restores it."
          />
        </span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="h-64 overflow-y-auto rounded border border-outline-variant/20 bg-surface-container-lowest p-2 font-mono text-evidence-dense">
        {lines.length === 0 ? (
          <p className="text-on-surface-variant">No audit entries to show.</p>
        ) : (
          lines.map((line) => (
            <div key={line.key} className="leading-relaxed">
              <span className="text-primary">[{line.time}]</span> <span className={TONE_TEXT[line.tone]}>{line.body}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ---- evidence traces ---------------------------------------------------------------

export function EvidenceTraces({ citations, loading }: { citations: readonly Citation[] | undefined; loading: boolean }) {
  const shown = (citations ?? []).slice(0, 6);
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        eyebrow="Latest cited rows, checked against raw_logs"
        title="Forensic evidence traces"
        action={
          <Proof
            source="GET /investigations/{id}/citations"
            n={citations?.length ?? 0}
            asOf={null}
            label="Evidence traces"
            definition="The latest investigation's cited raw_logs rows, with the Watchdog's per-citation status and the canonical row fingerprint."
          />
        }
      />
      {shown.length === 0 ? (
        loading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <EmptyState title="No citations yet" description="Citations appear once an investigation cites raw_logs rows." />
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((citation, index) => {
            const meta = citationStatusMeta(citation.status);
            return (
              <Card key={`${citation.row_id}-${citation.field}-${index}`} hoverTone={meta.tone} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-evidence text-primary">row {citation.row_id}</span>
                  <Pill tone={meta.tone} icon={meta.icon}>
                    {meta.label}
                  </Pill>
                </div>
                <div className="font-mono text-evidence text-on-surface">
                  {citation.field}: <span className="text-on-surface-variant">{citation.value ?? '—'}</span>
                </div>
                {citation.status === 'DISCREPANCY' && citation.expected !== null && (
                  <div className="font-mono text-evidence-dense text-tertiary">expected: {citation.expected}</div>
                )}
                <div className="flex items-center justify-between gap-2 pt-1 text-caption text-on-surface-variant">
                  <AgentChip agentId={citation.agent_id} name={citation.agent_id} />
                  <span>round {citation.round}</span>
                </div>
                {citation.row_fingerprint && (
                  <CopyHash value={citation.row_fingerprint} label={`row fingerprint for row ${citation.row_id}`} />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

export { formatCount, formatNumber };
