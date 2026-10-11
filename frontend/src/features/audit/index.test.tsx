import { fireEvent, render, screen } from '@testing-library/react';
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
import { evidenceOutsideMono } from '../../test/evidence';
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
  vi.mocked(verifyAuditTrail).mockResolvedValue({
    chain_valid: true,
    entries_checked: 1,
    first_break_seq: null,
    reason: null,
    head_hash: null,
    mode: 'full',
    verified_from_seq: 7,
  });
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
    expect(screen.getByText('Hash verified in browser')).toBeTruthy();
  });

  it('flags a browser recompute that does not match entry_hash', async () => {
    const trail: AuditTrailResponse = { entries: [makeEntry('00'.repeat(32))], chain: { valid: true, head_seq: 7, total: 1 } };
    vi.mocked(listAuditTrail).mockResolvedValue(trail);
    render(<AuditPage />);
    expect(await screen.findByText(/Does not match entry_hash/i)).toBeTruthy();
    // The header badge follows the recompute: a failed check never shows a green "verified" tag.
    expect(screen.getByText('Hash mismatch')).toBeTruthy();
    expect(screen.queryByText('Hash verified in browser')).toBeNull();
    expect(screen.queryByText('Verified proof')).toBeNull();
  });

  it('runs a full server pass from the verify button and says which pass ran', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [makeEntry('deadbeef'.repeat(8))], chain: { valid: true, head_seq: 7, total: 42 } });
    render(<AuditPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Verify cryptographic proof/i }));
    expect(await screen.findByText(/1 entries checked by server \(full pass\)/)).toBeTruthy();
    expect(vi.mocked(verifyAuditTrail)).toHaveBeenCalledWith({ full: true });
  });

  it('never lets a verify result hide a break the list already reported', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [makeEntry('deadbeef'.repeat(8))], chain: { valid: false, head_seq: 7, total: 42 } });
    render(<AuditPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Verify cryptographic proof/i }));
    await screen.findByText(/entries checked by server/);
    expect(screen.getByText('Broken')).toBeTruthy();
    expect(screen.queryByText('100% intact')).toBeNull();
  });

  it('shows the empty state with no entries', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [], chain: { valid: true, head_seq: null, total: 0 } });
    render(<AuditPage />);
    expect(await screen.findByText(/No audit entries yet/i)).toBeTruthy();
  });

  it('puts a copy button on every shortened hash and id, without nesting buttons', async () => {
    const entry = { ...makeEntry('deadbeef'.repeat(8)), investigation_id: 'abcdef12-0000-4000-8000-000000000001' };
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [entry], chain: { valid: true, head_seq: 7, total: 1 } });
    const { container } = render(<AuditPage />);
    await screen.findByText('#7');
    expect(screen.getAllByRole('button', { name: 'Copy entry hash' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy previous entry hash' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Copy investigation id' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy head entry hash' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy current entry hash' })).toBeTruthy();
    expect(screen.getByText('abcdef12').getAttribute('title')).toBe('abcdef12-0000-4000-8000-000000000001');
    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });

  it('shows every id and hash in the evidence font', async () => {
    const entry = { ...makeEntry('deadbeef'.repeat(8)), investigation_id: 'abcdef12-0000-4000-8000-000000000001' };
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [entry], chain: { valid: true, head_seq: 7, total: 1 } });
    const { container } = render(<AuditPage />);
    await screen.findByText('#7');
    await screen.findByText(/Matches entry_hash|Does not match entry_hash/i);

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it('shows entry times as relative text with the exact time in the tooltip, and the inspector time in full', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [makeEntry('deadbeef'.repeat(8))], chain: { valid: true, head_seq: 7, total: 1 } });
    const { container } = render(<AuditPage />);
    await screen.findByText('#7');
    const times = Array.from(container.querySelectorAll('time[datetime="2026-10-08T12:00:00Z"]'));
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.some((time) => time.textContent === '2026-10-08 12:00:00 UTC')).toBe(true);
    expect(times.every((time) => time.getAttribute('title') !== null)).toBe(true);
  });

  it('selects an entry from its card', async () => {
    const second = { ...makeEntry('11'.repeat(32)), seq: 8, prev_hash: 'deadbeef'.repeat(8) };
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [second, makeEntry('deadbeef'.repeat(8))], chain: { valid: true, head_seq: 8, total: 2 } });
    render(<AuditPage />);
    const older = await screen.findByRole('button', { name: 'Select audit entry #7' });
    expect(older.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(older);
    expect(older.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a dismissible how-to-read hint', async () => {
    vi.mocked(listAuditTrail).mockResolvedValue({ entries: [], chain: { valid: true, head_seq: null, total: 0 } });
    render(<AuditPage />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
    expect(window.localStorage.getItem('vc-hint-dismissed:audit')).toBe('1');
  });
});
