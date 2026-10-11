/** The sections of the case report. Each one is a pure view of the values passed in; the page works them out. */
import type { Citation, InvestigationDetail, InvestigatorId, Stance, VoteSource } from '../../api/types';
import { AGENT_VISUALS, INVESTIGATOR_IDS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { meanSupporterConfidence, verifyVerdictConfidence } from '../../lib/derive/verdict';
import { formatClock, formatCount, formatCountNoun, formatDuration, formatPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';
import { Timestamp } from '../../ui/Timestamp';
import type { ContainmentGate, GateState } from '../debate/gate';
import type { HealingStatus, PlaybookStep } from '../investigations/healing';
import { VERDICT_LABEL } from '../investigations/labels';
import type { Storyline } from '../investigations/storyline';
import type { CaseTimeline, StepKind } from '../investigations/timeline';
import type { CitedRows } from '../investigations/useCitedRows';
import { BAR_TONE, Chip, Fact, Hash, Section, TABLE, TD, TEXT_TONE, TH, type PaperTone } from './paper';
import type { Verification } from './useVerification';

const pct = (value: number | null) => (value === null ? '—' : formatPercent(value, 1));

const STEP_TONE: Record<StepKind, PaperTone> = { queue: 'neutral', round: 'primary', verdict: 'secondary', contain: 'error', failed: 'error' };
const STANCE_TONE: Record<Stance, PaperTone> = { SUPPORT: 'secondary', CHALLENGE: 'tertiary', REVISE: 'primary' };
const SOURCE_WORD: Record<VoteSource, string> = { stated: 'stated', keywords: 'read from text' };
const GATE_ICON: Record<GateState, IconName> = { pass: 'check_circle', fail: 'cancel', unknown: 'schedule' };
const GATE_TONE: Record<GateState, string> = { pass: TEXT_TONE.secondary, fail: TEXT_TONE.error, unknown: TEXT_TONE.neutral };

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-paper-rule bg-paper-tint p-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="font-headline text-lg font-bold leading-tight text-ink">{value}</div>
      <div className="text-[10px] text-ink-muted">{sub}</div>
    </div>
  );
}

// ---- 1. summary -----------------------------------------------------------------------------------------------------

export interface SummarySectionProps {
  sentences: readonly string[];
  detail: InvestigationDetail;
  timeline: CaseTimeline | null;
  rounds: number | null;
  actionCount: number;
}

export function SummarySection({ sentences, detail, timeline, rounds, actionCount }: SummarySectionProps) {
  const verdictStep = timeline?.steps.find((step) => step.kind === 'verdict');
  const { citations } = detail;
  return (
    <Section title="Summary" note="written from the case's own fields, not by a model">
      <div className="space-y-1.5">
        {sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Kpi label="Debate rounds" value={rounds === null ? formatCount(detail.rounds.length) : `${detail.rounds.length} of ${rounds}`} sub="each investigator answers each round" />
        <Kpi label="Citations verified" value={citations.total === 0 ? '—' : `${citations.verified} of ${citations.total}`} sub={`match rate ${pct(citations.match_rate.value)}`} />
        <Kpi label="Acceptance to verdict" value={verdictStep ? formatDuration(verdictStep.endMs) : '—'} sub="queue wait included" />
        <Kpi label="Sandbox actions" value={actionCount === 0 ? 'none' : formatCount(actionCount)} sub="all simulated" />
      </div>
    </Section>
  );
}

// ---- 2. automation ----------------------------------------------------------------------------------------------------

const POINT_SHARE = 0.03;
const MIN_SHARE = 0.06;

export function AutomationSection({ timeline }: { timeline: CaseTimeline | null }) {
  const total = timeline?.totalMs ?? 0;
  return (
    <Section title="How the automation handled it" note="every instant is the created_at of an audit entry">
      {timeline === null || timeline.steps.length === 0 ? (
        <p className="text-ink-muted">No audit entries were available to measure the steps.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {timeline.handsFree ? <Chip tone="secondary">Hands-free · no analyst action</Chip> : timeline.people.length > 0 ? <Chip>{`Analyst: ${timeline.people.join(', ')}`}</Chip> : null}
            <span className="text-[10px] text-ink-muted">{formatDuration(total)} end to end</span>
          </div>
          <div className="mb-2 flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={`Timeline of ${timeline.steps.length} steps over ${formatDuration(total)}`}>
            {timeline.steps.map((step) => (
              <span key={step.id} className={cn('h-full rounded-sm', BAR_TONE[STEP_TONE[step.kind]])} style={{ flexGrow: Math.max(step.durationMs, total * (step.durationMs === 0 ? POINT_SHARE : MIN_SHARE)), flexBasis: 0 }} />
            ))}
          </div>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Step</th>
                <th className={TH}>What</th>
                <th className={TH}>Took</th>
                <th className={TH}>Since acceptance</th>
                <th className={TH}>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {timeline.steps.map((step) => (
                <tr key={step.id} className="break-inside-avoid">
                  <td className={cn(TD, 'font-semibold', TEXT_TONE[STEP_TONE[step.kind]])}>{step.label}</td>
                  <td className={TD}>{step.detail ?? '—'}</td>
                  <td className={cn(TD, 'font-mono')}>{step.durationMs > 0 ? formatDuration(step.durationMs) : 'instant'}</td>
                  <td className={cn(TD, 'font-mono')}>+{formatDuration(step.endMs)}</td>
                  <td className={cn(TD, 'font-mono text-ink-muted')}>{formatClock(step.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

// ---- 3. investigators and rounds ----------------------------------------------------------------------------------------

const THEORY_CHARS = 560;
const clip = (text: string) => (text.length > THEORY_CHARS ? `${text.slice(0, THEORY_CHARS).trimEnd()}…` : text);

export interface InvestigatorsSectionProps {
  detail: InvestigationDetail;
  citations: readonly Citation[];
  name: (agentId: InvestigatorId) => string;
  domain: (agentId: InvestigatorId) => string | null;
}

export function InvestigatorsSection({ detail, citations, name, domain }: InvestigatorsSectionProps) {
  const present = INVESTIGATOR_IDS.filter((id) => detail.rounds.some((round) => round.agents.some((turn) => turn.agent_id === id)));
  return (
    <Section title="The investigators" note="their last position, the vote it counted as, and the Watchdog's record of each">
      {present.length === 0 ? (
        <p className="text-ink-muted">No investigator answered.</p>
      ) : (
        <div className="space-y-2">
          {present.map((id) => {
            const turns = detail.rounds.flatMap((round) => round.agents.filter((turn) => turn.agent_id === id).map((turn) => ({ round: round.round, turn })));
            const last = turns[turns.length - 1];
            const vote = detail.votes.find((entry) => entry.agent_id === id);
            const scores = detail.credibility.filter((row) => row.agent_id === id).sort((a, b) => a.round - b.round);
            const own = citations.filter((citation) => citation.agent_id === id);
            const verified = own.filter((citation) => citation.status === 'VERIFIED').length;
            return (
              <article key={id} className="grid break-inside-avoid grid-cols-[200px_1fr] gap-3 rounded-lg border border-paper-rule p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-primary/10 font-mono text-[12px] text-paper-primary">{AGENT_VISUALS[id].glyph}</span>
                    <div className="min-w-0">
                      <div className="font-headline text-[12px] font-bold leading-tight">{name(id)}</div>
                      <div className="text-[9px] leading-tight text-ink-muted">{domain(id) ?? ''}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Chip tone={last.turn.stance ? STANCE_TONE[last.turn.stance] : 'neutral'}>{last.turn.stance ?? 'stance not stated'}</Chip>
                    {vote?.verdict_class && <Chip tone="primary">{`${VERDICT_LABEL[vote.verdict_class]} · ${SOURCE_WORD[vote.class_source ?? 'keywords']}`}</Chip>}
                    {vote?.counted === false && <Chip tone="error">isolated</Chip>}
                  </div>
                </div>
                <div className="min-w-0">
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[10px]">
                    <div>
                      <dt className="text-ink-muted">Confidence</dt>
                      <dd className="font-mono text-ink">{pct(last.turn.confidence)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Citations verified</dt>
                      <dd className="font-mono text-ink">{own.length > 0 ? `${verified} of ${own.length}` : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Credibility (CrS), first round before to last round after</dt>
                      <dd className="font-mono text-ink">{scores.length > 0 ? `${pct(scores[0].crs_before)} → ${pct(scores[scores.length - 1].crs_after)}` : '—'}</dd>
                    </div>
                  </dl>
                  <p className="mt-1.5 text-[10px] leading-snug text-ink-muted">{clip(last.turn.theory)}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
export function RoundsSection({ detail, name }: { detail: InvestigationDetail; name: (agentId: InvestigatorId) => string }) {
  const rounds = [...detail.rounds].sort((a, b) => a.round - b.round);
  const agents = INVESTIGATOR_IDS.filter((id) => rounds.some((round) => round.agents.some((turn) => turn.agent_id === id)));
  return (
    <Section title="The debate, round by round" note="stance and agent-reported confidence of each answer">
      {rounds.length === 0 ? (
        <p className="text-ink-muted">No round was recorded.</p>
      ) : (
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Investigator</th>
              {rounds.map((round) => (
                <th key={round.round} className={TH}>{`Round ${round.round}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((id) => (
              <tr key={id} className="break-inside-avoid">
                <td className={cn(TD, 'font-semibold')}>{name(id)}</td>
                {rounds.map((round) => {
                  const turn = round.agents.find((entry) => entry.agent_id === id);
                  return (
                    <td key={round.round} className={TD}>
                      {turn ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <Chip tone={turn.stance ? STANCE_TONE[turn.stance] : 'neutral'}>{turn.stance ?? 'not stated'}</Chip>
                          <span className="font-mono">{pct(turn.confidence)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ---- 4. votes ---------------------------------------------------------------------------------------------------------------

export function VotesSection({ detail, name }: { detail: InvestigationDetail; name: (agentId: InvestigatorId) => string }) {
  const verdict = detail.verdict_class;
  const mean = verdict ? meanSupporterConfidence(detail.votes, verdict) : null;
  const check = verdict ? verifyVerdictConfidence(detail.verdict_confidence, detail.votes, verdict) : 'not_checkable';
  return (
    <Section title="Aggregation" note="deterministic code, not a model: the class most agents voted for">
      {detail.votes.length === 0 ? (
        <p className="text-ink-muted">No votes were recorded.</p>
      ) : (
        <>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Investigator</th>
                <th className={TH}>Vote</th>
                <th className={TH}>How it was read</th>
                <th className={TH}>Confidence</th>
                <th className={TH}>Counted</th>
              </tr>
            </thead>
            <tbody>
              {detail.votes.map((vote) => (
                <tr key={vote.agent_id} className="break-inside-avoid">
                  <td className={cn(TD, 'font-semibold')}>{name(vote.agent_id)}</td>
                  <td className={TD}>{vote.verdict_class ? VERDICT_LABEL[vote.verdict_class] : 'no class'}</td>
                  <td className={TD}>{SOURCE_WORD[vote.class_source ?? 'keywords']}</td>
                  <td className={cn(TD, 'font-mono')}>{pct(vote.confidence)}</td>
                  <td className={TD}>{vote.counted === false ? 'no (isolated)' : 'yes'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-ink-muted">
            Verdict confidence is the mean of the supporting agents' self-reported confidence ({mean ? formatCountNoun(mean.n, 'supporter') : 'no supporters'}):{' '}
            <span className="font-mono text-ink">{pct(detail.verdict_confidence)}</span>
            {check === 'match' && <span className={TEXT_TONE.secondary}> · recomputed here from the votes: it matches</span>}
            {check === 'mismatch' && <span className={TEXT_TONE.error}> · recomputed here from the votes: it does NOT match</span>}
          </p>
        </>
      )}
    </Section>
  );
}

// ---- 5. evidence -----------------------------------------------------------------------------------------------------------

const STATUS_TONE: Record<Citation['status'], PaperTone> = { VERIFIED: 'secondary', DISCREPANCY: 'tertiary', INVALID_ROW: 'error' };
const EVIDENCE_ROWS = 20;

export function EvidenceSection({ citations, missing }: { citations: readonly Citation[] | undefined; missing: string | undefined }) {
  const shown = citations?.slice(0, EVIDENCE_ROWS) ?? [];
  return (
    <Section title="Evidence the Watchdog re-checked" note="each cited value compared with the raw row it names">
      {citations === undefined ? (
        <p className="text-ink-muted">The citations could not be read{missing ? `: ${missing}` : ''}.</p>
      ) : citations.length === 0 ? (
        <p className="text-ink-muted">No evidence was cited.</p>
      ) : (
        <>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Row</th>
                <th className={TH}>Field</th>
                <th className={TH}>Cited</th>
                <th className={TH}>Row holds</th>
                <th className={TH}>Result</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((citation, index) => (
                <tr key={`${citation.row_id}|${citation.field}|${index}`} className="break-inside-avoid">
                  <td className={TD}>
                    <Hash value={citation.row_id} className="text-[8px]" />
                  </td>
                  <td className={TD}>{citation.field}</td>
                  <td className={cn(TD, 'font-mono')}>{citation.value ?? '∅'}</td>
                  <td className={cn(TD, 'font-mono')}>{citation.expected ?? '∅'}</td>
                  <td className={TD}>
                    <Chip tone={STATUS_TONE[citation.status]}>{citation.status === 'INVALID_ROW' ? 'invalid row' : citation.status.toLowerCase()}</Chip>
                  </td>
                  <td className={cn(TD, 'text-ink-muted')}>{`${AGENT_VISUALS[citation.agent_id].glyph} · R${citation.round}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {citations.length > shown.length && (
            <p className="mt-1 text-[10px] text-ink-muted">Showing the first {formatCount(shown.length)} of {formatCount(citations.length)} citations; the evidence bundle holds all of them.</p>
          )}
        </>
      )}
    </Section>
  );
}

export function StorylineSection({ story, cited, hasCitations }: { story: Storyline; cited: CitedRows; hasCitations: boolean }) {
  return (
    <Section title="Evidence storyline" note="the cited rows in the order they happened, re-read from raw_logs">
      {!hasCitations ? (
        <p className="text-ink-muted">No row was cited, so there is no storyline.</p>
      ) : story.events.length === 0 ? (
        <p className="text-ink-muted">None of the cited rows could be read from raw_logs.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            {story.users.slice(0, 3).map((user) => (
              <Chip key={`u-${user.value}`} tone="primary">{`user ${user.value} ×${user.count}`}</Chip>
            ))}
            {story.hosts.slice(0, 3).map((host) => (
              <Chip key={`h-${host.value}`} tone="tertiary">{`host ${host.value} ×${host.count}`}</Chip>
            ))}
            {story.spanMs !== null && <span className="text-ink-muted">{formatDuration(story.spanMs)} of activity</span>}
          </div>
          <ol className="border-l border-paper-rule pl-4">
            {story.events.map((event) => (
              <li key={event.rowId} className="relative mb-2 break-inside-avoid last:mb-0">
                <span aria-hidden="true" className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full', BAR_TONE[event.status === null ? 'neutral' : STATUS_TONE[event.status]])} />
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  <Timestamp iso={event.at} mode="absolute" className="font-mono font-semibold" />
                  <Chip>{event.eventType ?? event.source}</Chip>
                  {(event.user ?? event.host) && <span className="text-ink-muted">{`${event.user ?? '—'}${event.host ? ` @ ${event.host}` : ''}`}</span>}
                  <Hash value={event.rowId} className="text-[8px] text-ink-muted" />
                </div>
                {event.citations.length > 0 && (
                  <div className="mt-0.5 font-mono text-[10px] text-ink-muted">
                    {event.citations.slice(0, 3).map((citation) => `${citation.field}=${citation.value ?? '∅'}`).join('  ·  ')}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {cited.failed > 0 && <p className="text-[10px] text-paper-error">{formatCountNoun(cited.failed, 'cited row')} could not be read and {cited.failed === 1 ? 'is' : 'are'} left out.</p>}
        </>
      )}
    </Section>
  );
}

// ---- 6. self-healing ------------------------------------------------------------------------------------------------------

export interface HealingSectionProps {
  gate: ContainmentGate;
  standing: HealingStatus;
  steps: readonly PlaybookStep[];
}

export function HealingSection({ gate, standing, steps }: HealingSectionProps) {
  const simulated = steps.filter((step) => step.simulated).length;
  return (
    <Section title="Self-Healing response" note="sandboxed by construction: no networking code, every action simulated">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chip tone={standing.tone}>{standing.label}</Chip>
        <span className="text-[11px] text-ink-muted">{standing.sentence}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="break-inside-avoid">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">Gate</div>
          <ul className="space-y-1">
            {gate.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-1.5 text-[11px]">
                <Icon name={GATE_ICON[check.state]} size={14} className={cn('mt-px shrink-0', GATE_TONE[check.state])} />
                <span>
                  <span className="font-semibold">{check.title}</span>
                  <span className="block text-ink-muted">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="break-inside-avoid">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">Playbook</div>
          {steps.length === 0 ? (
            <p className="text-[11px] text-ink-muted">No sandbox action was run for this case.</p>
          ) : (
            <ol className="space-y-1.5">
              {steps.map((step, index) => (
                <li key={step.id} className="flex gap-1.5 text-[11px]">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-paper-error/50 font-mono text-[9px] text-paper-error">{index + 1}</span>
                  <span>
                    <span className="font-semibold">{step.label}</span> <span className="font-mono text-ink-muted">→ {step.target}</span>
                    {step.offsetMs !== null && <span className="text-ink-muted"> · +{formatDuration(Math.max(0, step.offsetMs))}</span>}
                    {step.reason && <span className="block text-ink-muted">“{step.reason}”</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[10px] text-ink-muted">
            {steps.length === 0 ? 'Sandbox boundary: nothing was run.' : `Sandbox boundary: ${formatCount(simulated)} of ${formatCount(steps.length)} actions simulated.`}
          </p>
        </div>
      </div>
    </Section>
  );
}
// ---- 7. integrity ------------------------------------------------------------------------------------------------------------

function CheckMark({ ok, children }: { ok: boolean | null; children: string }) {
  const tone = ok === null ? TEXT_TONE.neutral : ok ? TEXT_TONE.secondary : TEXT_TONE.error;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', tone)}>
      <Icon name={ok === null ? 'schedule' : ok ? 'check_circle' : 'cancel'} size={14} />
      {children}
    </span>
  );
}

export interface IntegritySectionProps {
  sha256: string | null;
  verification: Verification;
  caseDigest: string | null;
  entries: number | null;
  chainTotal: number | null;
  chainValid: boolean | null;
}

export function IntegritySection({ sha256, verification, caseDigest, entries, chainTotal, chainValid }: IntegritySectionProps) {
  const bundleOk = verification.bundle === 'match' ? true : verification.bundle === 'mismatch' ? false : null;
  const chain = verification.chain;
  const hashesOk = chain.state === 'done' ? chain.check.mismatched.length === 0 : null;
  const digestOk = chain.state === 'done' ? chain.check.digestMatches : null;
  return (
    <Section title="Integrity" note="what a reader can check again without trusting this document">
      <div className="grid grid-cols-1 gap-3">
        <Fact label="Evidence bundle SHA-256">{sha256 ? <Hash value={sha256} /> : <span className="text-ink-muted">not available</span>}</Fact>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <CheckMark ok={bundleOk}>{bundleOk === null ? 'Bundle hash not recomputed' : bundleOk ? 'Bundle hash recomputed here: it matches' : 'Bundle hash recomputed here: it does NOT match'}</CheckMark>
          <CheckMark ok={hashesOk}>
            {chain.state === 'done' ? `${formatCount(chain.check.matching)} of ${formatCount(chain.check.total)} audit entry hashes recomputed here match` : 'Audit entry hashes not recomputed'}
          </CheckMark>
          <CheckMark ok={digestOk}>{digestOk === null ? 'Case digest not recomputed' : digestOk ? 'Case digest recomputed here: it matches' : 'Case digest recomputed here: it does NOT match'}</CheckMark>
          <CheckMark ok={chainValid}>{chainValid === null ? 'Global chain not verified' : chainValid ? `Global audit chain valid (${formatCount(chainTotal ?? 0)} entries)` : 'Global audit chain broken'}</CheckMark>
        </div>
        {caseDigest && <Fact label={`Case digest (${entries === null ? '—' : formatCountNoun(entries, 'entry', 'entries')})`}><Hash value={caseDigest} /></Fact>}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-ink-muted">
        The audit trail is a SHA-256 hash chain: each entry carries the hash of the one before it, so a changed entry shows up as a mismatch. It is tamper-evident, not a digital signature. The investigators were never told which scenario a case came from; that is checked by a test (backend/tests/agents/test_blind_boundary.py), not only stated.
      </p>
    </Section>
  );
}
