import { render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, AuditTrailResponse } from '../../api/types';

vi.mock('../../api/client', () => ({
  describeError: (error: unknown) => String(error),
  listAuditTrail: vi.fn(),
  listResponseActions: vi.fn(),
  verifyAuditTrail: vi.fn(),
}));

import { listAuditTrail, listResponseActions, verifyAuditTrail } from '../../api/client';
import { sha256Hex } from '../../lib/derive/hash';
import AuditPage from './index';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const HASH_INPUT = '7|login|analyst|{"username":"analyst"}|0a0e15deadbeef';

function makeEntry(entryHash: string): AuditEntry {
  return {
    seq: 7,
    prev_hash: '0a0e15deadbeef',
    entry_hash: entryHash,
    hash_input: HASH_INPUT,
    actor: 'analyst',
    action: 'login',
    detail: { username: 'analyst' },
    investigation_id: null,
    created_at: '2026-10-08T12:00:00Z',
  };
}

beforeEach(() => {
  vi.mocked(listResponseActions).mockResolvedValue([]);
  vi.mocked(verifyAuditTrail).mockResolvedValue({ chain_valid: true, entries_checked: 1, first_break_seq: null, reason: null, head_hash: null });
});

describe('AuditPage', () => {
  it('renders real audit entry fields and chain summary', async () => {
    const trail: AuditTrailResponse = { entries: [makeEntry('deadbeef'.repeat(8))], chain: { valid: true, head_seq: 7, total: 42 } };
    vi.mocked(listAuditTrail).mockResolvedValue(trail);
    render(<AuditPage />);
    expect(await screen.findByText('42')).toBeTruthy(); // total entries
    expect(await screen.findByText('#7')).toBeTruthy(); // chain head seq
    expect(await screen.findByText('100% intact')).toBeTruthy();
  });

  it('browser SHA-256 recompute matches a known hash_input -> entry_hash pair', async () => {
    const entryHash = await sha256Hex(HASH_INPUT);
    const trail: AuditTrailResponse = { entries: [makeEntry(entryHash)], chain: { valid: true, head_seq: 7, total: 1 } };
    vi.mocked(listAuditTrail).mockResolvedValue(trail);
    render(<AuditPage />);
    expect(await screen.findByText(/Matches entry_hash/i)).toBeTruthy();
  });

  it('flags a browser recompute that does not match entry_hash', async () => {
    const trail: AuditTrailResponse = { entries: [makeEntry('00'.repeat(32))], chain: { valid: true, head_seq: 7, total: 1 } };
    vi.mocked(listAuditTrail).mockResolvedValue(trail);
    render(<AuditPage />);
    expect(await screen.findByText(/Does not match entry_hash/i)).toBeTruthy();
  });

  it('shows the empty state with no entries', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [], chain: { valid: true, head_seq: null, total: 0 } });
    render(<AuditPage />);
    expect(await screen.findByText(/No audit entries yet/i)).toBeTruthy();
  });
});
