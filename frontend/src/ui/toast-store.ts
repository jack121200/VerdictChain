import { useSyncExternalStore } from 'react';
import type { Tone } from './classes';

export interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

export interface PushToastOptions {
  tone?: Tone;
  /** Milliseconds before the toast dismisses itself. Default 4000. */
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 4000;

let nextId = 1;
let items: ToastItem[] = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(next: ToastItem[]): void {
  items = next;
  for (const listener of listeners) listener();
}

/** Shows a toast. Returns its id. Ids come from a counter, so the store is deterministic. */
export function pushToast(message: string, options: PushToastOptions = {}): number {
  const id = nextId;
  nextId += 1;
  emit([...items, { id, message, tone: options.tone ?? 'primary' }]);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), options.durationMs ?? DEFAULT_DURATION_MS),
  );
  return id;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (items.some((item) => item.id === id)) emit(items.filter((item) => item.id !== id));
}

/** Removes every toast and cancels their timers. Used between tests. */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  emit([]);
}

export function getToasts(): ToastItem[] {
  return items;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribeToasts, getToasts);
}
