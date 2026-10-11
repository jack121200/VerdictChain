/** The Investigations screen header: title, the inject and replay buttons, and the first-visit hint. */
import { buildRoute } from '../../app/router';
import { cn } from '../../lib/cn';
import { FOCUS_RING } from '../../ui/classes';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { HINT } from './shared';
import type { useInvestigations } from './useInvestigations';

type Props = Pick<ReturnType<typeof useInvestigations>, 'scenario' | 'selectedId'>;

export function Header({ scenario, selectedId }: Props) {
  return (
    <>
        {/* Screen Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-6 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              <span>Forensic Dossiers &amp; Cases • Deterministic Consensus Registry</span>
            </div>
            <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
              Active &amp; Closed <span className="text-primary">Investigations</span>
            </h1>
            <p className="mt-1 max-w-2xl font-body text-sm text-on-surface-variant">
              Forensic dossiers from the multi-agent debate, each verified by the Watchdog against the raw logs in
              PostgreSQL. Every value below is an API field or a Proof-documented derivation — no case ids, hashes or
              hosts are typed in.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {scenario !== null && (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={scenario.canInject === false}
                  title={scenario.canInject === false ? 'Your role does not hold the inject_scenario capability' : undefined}
                  onClick={() => scenario.open()}
                  className={cn(
                    'flex items-center gap-2 rounded bg-primary-container px-3 py-2 font-mono text-xs font-bold uppercase text-on-primary shadow-glow-cyan transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
                    FOCUS_RING,
                  )}
                >
                  <Icon name="admin_panel_settings" size={16} />
                  <span>Inject Scenario</span>
                </button>
                <Proof
                  source="shell: scenario modal · POST /investigations/simulate (wait=false)"
                  n={1}
                  asOf={null}
                  label="Inject scenario"
                  definition="Opens the scenario modal. Authorizing there starts a simulated investigation from a real scenario and opens its debate room. It needs the inject_scenario capability from GET /auth/me."
                />
              </span>
            )}
            <button
              type="button"
              disabled={selectedId === null}
              onClick={() => {
                if (selectedId !== null) window.location.hash = buildRoute({ name: 'debate', id: selectedId });
              }}
              className="flex items-center gap-2 rounded border border-primary/40 bg-surface-card px-3 py-2 font-mono text-xs uppercase text-primary transition-all hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="sync_alt" size={16} />
              <span>Open Replay</span>
            </button>
          </div>
        </div>

        <HintStrip pageId="investigations" sentences={HINT} className="mt-4" />
    </>
  );
}
