/** The left column of the Investigations screen: the filtered, paged list of cases. */
import { AGENT_VISUALS } from '../../lib/agents';
import { cn } from '../../lib/cn';
import { formatCount, formatCountNoun, formatPercent, formatPercentPoints, shortId } from '../../lib/format';
import { RunScenarioAction } from '../../shell/RunScenarioAction';
import { Button } from '../../ui/Button';
import { FOCUS_RING } from '../../ui/classes';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { StubBadge } from '../../ui/StubBadge';
import { Timestamp } from '../../ui/Timestamp';
import { STATUS_LABEL, VERDICT_LABEL, statusIcon, statusTone, verdictIcon, verdictTone } from './labels';
import { casePipeline } from './pipeline';
import { PipelineStrip } from './PipelineStrip';
import { ACCENT, BADGE, PAGE_SIZE } from './shared';
import type { useInvestigations } from './useInvestigations';

type Props = Pick<ReturnType<typeof useInvestigations>, 'items' | 'narrowed' | 'activeSummary' | 'list' | 'offset' | 'clearAll' | 'selectedId' | 'setSelectedId' | 'agentName' | 'canPrev' | 'canNext' | 'setOffset' | 'settings'>;

export function CaseList({ items, narrowed, activeSummary, list, offset, clearAll, selectedId, setSelectedId, agentName, canPrev, canNext, setOffset, settings }: Props) {
  const rounds = settings?.debate_rounds ?? null;
  return (
    <>
          <div className="min-w-0 space-y-3 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 font-mono text-xs text-on-surface-variant">
              <span className="inline-flex flex-wrap items-center gap-2">
                Showing {formatCountNoun(items.length, 'dossier')}
                {narrowed && <span className="text-outline">· filtered by {activeSummary.join(', ')}</span>}
                <Proof
                  source="GET /investigations"
                  n={items.length}
                  asOf={list.loadedAt}
                  label="Dossiers shown"
                  definition={`Rows returned for the current search, filters and page (limit ${formatCount(PAGE_SIZE)}, offset ${formatCount(offset)}). The list endpoint reports no total count, so none is shown; Next is offered when a full page came back.`}
                />
              </span>
              {narrowed && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear search and filters
                </Button>
              )}
              {list.error !== null && <span className="text-error">{list.error}</span>}
            </div>

            {list.status === 'loading' && (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            )}

            {list.status === 'ready' && items.length === 0 &&
              (narrowed || offset > 0 ? (
                <EmptyState
                  icon="travel_explore"
                  title="No investigations match"
                  description="No case matches the current search and filters on this page."
                  action={
                    <Button variant="secondary" onClick={clearAll}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="travel_explore"
                  title="No investigations yet"
                  description="Cases appear here once a scenario has been run through the three investigators."
                  action={<RunScenarioAction />}
                />
              ))}

            {items.map((item) => {
              const selected = item.id === selectedId;
              const tone = item.verdict_class === null ? statusTone(item.status) : verdictTone(item.verdict_class);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'relative overflow-hidden rounded-xl border p-4 text-left transition-all',
                    selected
                      ? 'border-primary bg-surface-card shadow-glow-cyan ring-1 ring-primary/50'
                      : 'border-outline-variant/40 bg-surface-container-low/70 hover:border-outline-variant hover:bg-surface-card/60',
                  )}
                >
                  {/*
                    The select button comes first and covers the card. The copy and Proof buttons are positioned
                    and later in the DOM, so they paint above it and stay clickable (no button inside a button).
                  */}
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Open dossier ${shortId(item.id)}`}
                    onClick={() => setSelectedId(item.id)}
                    className={cn('absolute inset-0 cursor-pointer rounded-xl', FOCUS_RING)}
                  />
                  <span aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', ACCENT[tone])} />
                  <div className="flex flex-col gap-3 pl-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyHash
                          value={item.id}
                          display={shortId(item.id)}
                          label="investigation id"
                          size="inherit"
                          className="text-sm"
                          textClassName="font-bold text-primary"
                        />
                        {item.dataset && (
                          <span className="rounded border border-outline-variant/40 bg-background px-2 py-0.5 font-mono text-[10px] text-on-surface-variant">
                            {item.dataset}
                          </span>
                        )}
                        <StubBadge source={item.data_source} />
                        <Timestamp iso={item.created_at} className="font-mono text-[10px] text-outline" />
                      </div>
                      <h3 className="mt-1 break-words font-headline text-base font-semibold text-on-surface">{item.trigger_type}</h3>
                      {item.status === 'error' && (
                        <p className="mt-0.5 break-words text-xs text-error">
                          Stopped: {item.error_reason ?? 'no reason was recorded (it failed before reasons were stored)'}
                        </p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-body text-xs text-on-surface-variant">
                        {item.primary_agent && (
                          <span>
                            Agent:{' '}
                            <code className="text-primary">
                              {AGENT_VISUALS[item.primary_agent].glyph} {agentName(item.primary_agent)}
                            </code>
                          </span>
                        )}
                        <span aria-hidden="true">•</span>
                        <span>
                          Noise: <code className="text-on-surface">{formatPercentPoints(item.noise_pct)}</code>
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-col sm:items-end">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
                          BADGE[tone],
                        )}
                      >
                        <Icon
                          name={item.verdict_class === null ? statusIcon(item.status) : verdictIcon(item.verdict_class)}
                          size={12}
                        />
                        {item.verdict_class === null ? STATUS_LABEL[item.status] : VERDICT_LABEL[item.verdict_class]}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-on-surface">
                        {item.verdict_confidence === null ? '—' : formatPercent(item.verdict_confidence)} conf.
                        <Proof
                          source="GET /investigations.verdict_confidence"
                          n={item.verdict_confidence === null ? 0 : 1}
                          asOf={item.created_at}
                          definition="Agent-reported verdict confidence (mean of the supporting agents' self-reported confidence). This is agent-reported confidence, not accuracy; accuracy comes only from /evaluation."
                          reason={item.verdict_confidence === null ? 'no verdict confidence yet' : null}
                          label="Agent-reported confidence"
                        />
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-outline-variant/30 pl-2 pt-2.5">
                    <PipelineStrip stages={casePipeline(item, rounds)} asOf={list.loadedAt ?? item.created_at} />
                  </div>
                </div>
              );
            })}

            {(canPrev || canNext) && (
              <div className="flex items-center justify-between px-1 pt-1 font-mono text-[11px] text-on-surface-variant">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                  className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                >
                  Previous
                </button>
                <span>
                  rows {formatCount(offset + 1)}–{formatCount(offset + items.length)}
                </span>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  className="rounded bg-surface-card px-2 py-1 uppercase text-on-surface hover:bg-surface-container-high disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>

    </>
  );
}
