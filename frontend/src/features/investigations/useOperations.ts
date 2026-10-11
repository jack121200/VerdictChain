/** Everything the operations board shows: the automation figures, the debate slots and the cases running or waiting. */
import { getStats, getSystemStatus, listInvestigations } from '../../api/client';
import { usePageData } from '../../app/use-page-data';

/** How many running and waiting cases the board lists (a lane per slot; the queue strip shows the first few). */
const BOARD_LIMIT = 20;

/** withStats false skips GET /stats (the Live page shows only the lanes). */
export function useOperations(withStats = true) {
  const stats = usePageData(() => (withStats ? getStats() : Promise.resolve(undefined)), 5000, ['stats', 'investigations']);
  const system = usePageData(getSystemStatus, 3000, ['investigations', 'live']);
  const running = usePageData(() => listInvestigations({ status: 'investigating', limit: BOARD_LIMIT }), 3000, ['investigations']);
  const queued = usePageData(() => listInvestigations({ status: 'queued', limit: BOARD_LIMIT }), 3000, ['investigations']);
  return { stats, system, running, queued };
}

export type Operations = ReturnType<typeof useOperations>;
