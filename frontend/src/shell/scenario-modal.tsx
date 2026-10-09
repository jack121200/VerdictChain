import { createContext, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ScenarioLabel } from '../api/types';
import { SCENARIO } from '../features';

/** What a page can do with the one scenario modal the shell owns. */
export interface ScenarioModalControl {
  /** The analyst's inject_scenario capability: true or false once /auth/me has loaded, null until then. */
  canInject: boolean | null;
  /** Opens the modal, optionally with a scenario already chosen. */
  open: (initialScenario?: ScenarioLabel | null) => void;
}

export const ScenarioModalContext = createContext<ScenarioModalControl | null>(null);

/**
 * The scenario control, or null outside the signed-in shell (a page rendered on its own, as in unit tests).
 * A page offers "Run a scenario" only when this is not null, so the action is never a dead button.
 */
export function useScenarioModal(): ScenarioModalControl | null {
  return useContext(ScenarioModalContext);
}

interface ModalState {
  /** Counts openings. It is the modal's key, so each opening starts from fresh choices and a fresh scenario list. */
  openings: number;
  open: boolean;
  initial: ScenarioLabel | null;
}

/**
 * Owns the single scenario modal for the whole shell, so the dashboard, an empty state and the command palette
 * all open the same one. The modal's code loads on the first opening.
 */
export function ScenarioModalProvider({ canInject, children }: { canInject: boolean | null; children: ReactNode }) {
  const [state, setState] = useState<ModalState>({ openings: 0, open: false, initial: null });

  const open = useCallback((initialScenario: ScenarioLabel | null = null) => {
    setState((current) => ({ openings: current.openings + 1, open: true, initial: initialScenario }));
  }, []);
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  const value = useMemo<ScenarioModalControl>(() => ({ canInject, open }), [canInject, open]);

  return (
    <ScenarioModalContext.Provider value={value}>
      {children}
      {state.openings > 0 && (
        <Suspense fallback={null}>
          <SCENARIO key={state.openings} open={state.open} onClose={close} canInject={canInject === true} initialScenario={state.initial} />
        </Suspense>
      )}
    </ScenarioModalContext.Provider>
  );
}
