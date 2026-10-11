/** The scenario matrix and the inject control. */
import type { ReactNode } from 'react';
import type { ScenarioSummary } from '../../api/types';
import { Button } from '../../ui/Button';
import { CONTROL_BORDER } from '../../ui/classes';
import { Icon } from '../../ui/Icon';

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
            className={`w-full cursor-pointer appearance-none rounded ${CONTROL_BORDER} bg-background py-2 pl-3 pr-8 font-mono text-xs text-on-surface transition-all focus:border-primary focus:outline-none`}
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
