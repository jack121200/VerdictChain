import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearToasts } from '../ui/toast-store';

/**
 * Node 25 exposes an experimental localStorage global without a file path, and it shadows
 * jsdom's Storage in this test environment. Tests use a working in-memory Storage instead.
 */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });

// Each test starts with an empty DOM, an empty toast store and empty storage.
afterEach(() => {
  cleanup();
  clearToasts();
  window.localStorage.clear();
  vi.restoreAllMocks();
});
