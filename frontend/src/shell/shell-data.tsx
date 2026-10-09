import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  getHealth,
  getMe,
  getSettings,
  getStats,
  getSystemStatus,
  listAuditTrail,
} from '../api/client';
import { startLiveEvents } from '../api/live-events';
import type { AuditTrailResponse, Me, Settings, StatsResponse, SystemStatus } from '../api/types';
import { useAsync, type AsyncResult } from '../app/use-async';

/** Browser-measured round trip of GET /health (plan 2.1: the design's typed latency becomes a measured value). */
export interface HealthSample {
  latencyMs: number;
}

export interface ShellData {
  me: AsyncResult<Me>;
  status: AsyncResult<SystemStatus>;
  health: AsyncResult<HealthSample>;
  stats: AsyncResult<StatsResponse>;
  settings: AsyncResult<Settings>;
  chain: AsyncResult<AuditTrailResponse>;
}

/** Shell values refresh together every 30 seconds. Nothing here is a constant. */
const REFRESH_MS = 30_000;

async function measureHealth(): Promise<HealthSample> {
  const started = performance.now();
  await getHealth();
  return { latencyMs: performance.now() - started };
}

const ShellDataContext = createContext<ShellData | null>(null);

export function ShellDataProvider({ children }: { children: ReactNode }) {
  // One push connection for the whole signed-in session. Screens subscribe to it through useAsync(topics).
  useEffect(() => {
    const connection = startLiveEvents();
    return () => connection.close();
  }, []);

  const me = useAsync(getMe);
  const status = useAsync(getSystemStatus, REFRESH_MS, ['investigations', 'agents', 'settings', 'actions']);
  const health = useAsync(measureHealth, REFRESH_MS);
  const stats = useAsync(getStats, REFRESH_MS, ['stats', 'investigations', 'actions']);
  const settings = useAsync(getSettings, REFRESH_MS, ['settings']);
  const chain = useAsync(() => listAuditTrail({ limit: 1 }), REFRESH_MS, ['audit']);

  return (
    <ShellDataContext.Provider value={{ me, status, health, stats, settings, chain }}>{children}</ShellDataContext.Provider>
  );
}

export function useShellData(): ShellData {
  const value = useContext(ShellDataContext);
  if (value === null) throw new Error('useShellData must be used inside ShellDataProvider.');
  return value;
}
