/** Re-reads the rows a case cited from raw_logs, so the storyline shows what actually happened and when. */
import { useEffect, useState } from 'react';
import { getRawLog } from '../../api/client';
import type { RawLogRow } from '../../api/types';

/** Rows read for one storyline. More than this are cited in a big case; the Proof says how many were skipped. */
export const MAX_STORY_ROWS = 12;

export interface CitedRows {
  status: 'idle' | 'loading' | 'ready';
  rows: RawLogRow[];
  /** Distinct row ids asked for (at most MAX_STORY_ROWS). */
  requested: number;
  /** Rows that could not be read. */
  failed: number;
  loadedAt: string | null;
}

const IDLE: CitedRows = { status: 'idle', rows: [], requested: 0, failed: 0, loadedAt: null };

export function useCitedRows(rowIds: readonly string[]): CitedRows {
  const key = [...new Set(rowIds)].slice(0, MAX_STORY_ROWS).join('|');
  const [state, setState] = useState<CitedRows>(IDLE);

  useEffect(() => {
    const ids = key === '' ? [] : key.split('|');
    if (ids.length === 0) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading', rows: [], requested: ids.length, failed: 0, loadedAt: null });
    void Promise.allSettled(ids.map((id) => getRawLog(id))).then((results) => {
      if (cancelled) return;
      const rows = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      setState({ status: 'ready', rows, requested: ids.length, failed: results.length - rows.length, loadedAt: new Date().toISOString() });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
