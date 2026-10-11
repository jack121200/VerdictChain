/** The two explanation cards of the Trust screen: how credibility is scored and how isolation works. */
import type { InvestigatorId } from '../../api/types';
import { cssPercent, formatPercent, formatSignedPercent } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { isolationGauge } from './derive';

// ---- Section 3: mechanism + isolation ------------------------------------------

export function MechanismCard() {
  return (
    <div className="flex flex-col justify-between space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md lg:col-span-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="rounded border border-primary-container/40 bg-primary-container/20 px-2 py-0.5 font-bold uppercase text-primary">
            How it works
          </span>
          <span className="uppercase text-on-surface-variant">Watchdog credibility scoring · deterministic, no LLM</span>
        </div>
        <h3 className="font-headline text-xl font-bold text-on-surface">Credibility scoring, end to end</h3>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant sm:text-sm">
          Every claim an investigator makes must cite a specific raw-log row. An out-of-band Watchdog re-queries each cited
          row against raw_logs in PostgreSQL and compares the cited value with the stored one (the text the agent was shown, or
          the same number). The match rate feeds the credibility score
          with the formula CrS = clamp(c · (1 + η · (2·rate − 1)), 0, 1). Agents cannot raise each other's credibility by
          agreeing — only verified evidence moves it.
        </p>
        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-outline-variant/40 bg-surface-card p-3">
            <div className="flex items-center gap-1.5 text-primary">
              <Icon name="receipt_long" size={16} />
              <span className="font-mono text-xs font-semibold uppercase">What the Watchdog checks</span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              Each citation is re-queried by row id. A field whose stored value matches is VERIFIED; a different value, or a field the row does not have, is a DISCREPANCY; a
              missing or malformed row is INVALID_ROW. The check is plain SQL, never another model.
            </p>
          </div>
          <div className="space-y-1 rounded-lg border border-outline-variant/40 bg-surface-card p-3">
            <div className="flex items-center gap-1.5 text-secondary">
              <Icon name="verified_user" size={16} />
              <span className="font-mono text-xs font-semibold uppercase">What agents can and cannot see</span>
            </div>
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              In rounds 2 and 3 agents see each other's theories and self-reported confidence, but never each other's raw
              rows, and never the scenario's ground-truth label. The blind property is checked in code.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/30 pt-3 font-mono text-[10px] text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <Icon name="check_circle" size={16} className="text-secondary" /> Citations re-checked against raw_logs
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="check_circle" size={16} className="text-secondary" /> Ground-truth blinded during debate
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-primary">
          Blind-test proof
          <Proof
            source="backend/tests/agents/test_blind_boundary.py"
            n={1}
            asOf={null}
            definition="The blind property is a checked test: an AST scan, a seeded-secret test and a prompt test prove the scenario ground-truth label never reaches any investigator's inputs."
            label="Blind-test proof location"
          />
        </span>
      </div>
    </div>
  );
}

export function IsolationProtocol({
  gauge,
  nameOf,
  asOf,
  settingsLoaded,
}: {
  gauge: ReturnType<typeof isolationGauge> | null;
  nameOf: (agentId: InvestigatorId) => string;
  asOf: string | null;
  settingsLoaded: boolean;
}) {
  return (
    <div className="flex flex-col justify-between space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md lg:col-span-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-headline text-base font-bold text-on-surface">Isolation protocol</span>
          <span className="rounded border border-error/30 bg-error-container/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-error">
            Auto-quarantine
          </span>
        </div>
        <p className="font-body text-xs text-on-surface-variant">
          An investigator whose CrS falls below the isolation threshold after a round is quarantined: excluded from the
          rest of that debate, from its verdict and from later debates until an analyst restores it.
        </p>
      </div>

      <div className="space-y-2 py-2">
        <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase">
          <span className="text-error">Quarantine &lt; {settingsLoaded && gauge ? formatPercent(gauge.threshold, 0) : '—'}</span>
          <span className="text-secondary">Active ≥ {settingsLoaded && gauge ? formatPercent(gauge.threshold, 0) : '—'}</span>
        </div>
        <div className="relative flex h-4 w-full overflow-hidden rounded-full border border-outline-variant/40 bg-surface-container-high">
          <div className="h-full bg-error-container/50" style={{ width: cssPercent(gauge?.threshold ?? 0) }}>
            <span className="flex h-full items-center justify-center font-mono text-[9px] font-bold tracking-widest text-on-error-container">
              QUARANTINE
            </span>
          </div>
          <div className="h-full flex-1 bg-secondary-container/40" />
          {gauge?.minCrs != null && (
            <span
              className="absolute top-0 h-full w-0.5 bg-on-surface"
              style={{ left: cssPercent(gauge.minCrs) }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="space-y-0.5 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-on-surface-variant">Lowest current agent</span>
            <span className="font-bold text-tertiary">
              {gauge?.minAgent ? `${nameOf(gauge.minAgent)}: ${formatPercent(gauge.minCrs ?? 0, 1)}` : '—'}
            </span>
          </div>
          <p className="flex items-center gap-1 font-body text-xs text-on-surface-variant">
            Safety margin:{' '}
            <span className={gauge?.margin == null ? 'text-on-surface-variant' : gauge.margin >= 0 ? 'font-semibold text-secondary' : 'font-semibold text-error'}>
              {gauge?.margin == null ? '—' : formatSignedPercent(gauge.margin)}
            </span>{' '}
            vs quarantine threshold
            <Proof
              source="browser: GET /agents/fleet.crs · GET /settings.isolation_threshold"
              n={1}
              asOf={asOf}
              definition="Lowest investigator CrS and its margin above the isolation threshold (minCrs − threshold). Below the threshold the agent is quarantined."
              label="Isolation margin"
            />
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-outline-variant/30 bg-surface-card p-3">
        <Icon name="verified_user" size={20} className="text-secondary" />
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold uppercase text-on-surface">Per-agent context isolation</span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            Each investigator reasons over its own log slice; raw rows stay private to that agent.
          </span>
        </div>
      </div>
    </div>
  );
}
