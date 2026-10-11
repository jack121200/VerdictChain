import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caseChainFixture } from '../../test/case-chain';

const h = vi.hoisted(() => ({ getCaseAuditChain: vi.fn() }));

vi.mock('../../api/client', () => ({
  getCaseAuditChain: h.getCaseAuditChain,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

import { CaseAuditChainPanel } from './CaseAuditChain';

const SPECS = [
  { seq: 11, action: 'investigation_started', links_to: 'genesis' },
  { seq: 14, action: 'round_completed', links_to: 'other' },
  { seq: 15, action: 'verdict_reached', links_to: 'case' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CaseAuditChainPanel', () => {
  it('shows how many of the global chain’s entries belong to the case and says it is not a second chain', async () => {
    h.getCaseAuditChain.mockResolvedValue(await caseChainFixture(SPECS, 'inv-1', 40));
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByText(/of the 40 entries of the global/)).toBeTruthy();
    expect(screen.getByText(/They are not a separate chain/)).toBeTruthy();
  });

  it('recomputes every entry and the digest in the browser, and reports that they match the server', async () => {
    h.getCaseAuditChain.mockResolvedValue(await caseChainFixture(SPECS));
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    const checks = within(await screen.findByRole('group', { name: 'Case audit chain checks' }));
    expect(await checks.findByText('3 of 3 match')).toBeTruthy();
    expect(checks.getByText(/Case digest recomputed here equals the server’s/)).toBeTruthy();
    expect(checks.getByText(/Global chain valid \(3 entries, checked by the server\)/)).toBeTruthy();
    expect(screen.queryByText(/does not match/)).toBeNull();
    expect(screen.queryByText(/does not equal/)).toBeNull();
  });

  it('names the entry that does not match when its text was changed', async () => {
    const chain = await caseChainFixture(SPECS);
    chain.entries[1] = { ...chain.entries[1], hash_input: `${chain.entries[1].hash_input} tampered` };
    h.getCaseAuditChain.mockResolvedValue(chain);
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    const checks = within(await screen.findByRole('group', { name: 'Case audit chain checks' }));
    expect(await checks.findByText('2 of 3 match')).toBeTruthy();
    expect(checks.getByText(/does not match: entry #14/)).toBeTruthy();
  });

  it('says the digest does not equal the server’s when it was altered, instead of passing it', async () => {
    const chain = await caseChainFixture(SPECS);
    h.getCaseAuditChain.mockResolvedValue({ ...chain, case_digest: 'e'.repeat(64) });
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByText(/Case digest recomputed here does not equal the server’s/)).toBeTruthy();
  });

  it('says a broken global chain is broken', async () => {
    const chain = await caseChainFixture(SPECS);
    h.getCaseAuditChain.mockResolvedValue({ ...chain, chain: { ...chain.chain, valid: false } });
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByText(/Global chain broken/)).toBeTruthy();
  });

  it('lists the entries oldest first with how each one joins the chain', async () => {
    h.getCaseAuditChain.mockResolvedValue(await caseChainFixture(SPECS));
    const { container } = render(<CaseAuditChainPanel investigationId="inv-1" />);
    await screen.findByRole('group', { name: 'Case audit chain checks' });

    const items = Array.from(container.querySelectorAll('li')).map((item) => item.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('investigation_started');
    expect(items[0]).toContain('first entry of the whole chain');
    expect(items[1]).toContain('follows an entry of another case or of the system');
    expect(items[2]).toContain('follows this case’s previous entry');
  });

  it('says so when the case has no entries yet, with no digest and no check', async () => {
    h.getCaseAuditChain.mockResolvedValue(await caseChainFixture([]));
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByText('No audit entries have been written for this case yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Case audit chain checks' })).toBeNull();
  });

  it('shows the plain-words error and nothing else when the API fails', async () => {
    h.getCaseAuditChain.mockRejectedValue(new Error('The audit chain could not be read.'));
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByText(/The audit chain could not be read\./)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Case audit chain checks' })).toBeNull();
  });

  it('never draws the entries of another case while the new one loads', async () => {
    const first = await caseChainFixture(SPECS, 'inv-1');
    let release: (value: unknown) => void = () => undefined;
    h.getCaseAuditChain.mockImplementation((id: string) =>
      id === 'inv-1'
        ? Promise.resolve(first)
        : new Promise((resolve) => {
            release = resolve;
          }),
    );
    const view = render(<CaseAuditChainPanel investigationId="inv-1" />);
    await screen.findByText('3 of 3 match');

    view.rerender(<CaseAuditChainPanel investigationId="inv-2" />);

    await waitFor(() => expect(h.getCaseAuditChain).toHaveBeenCalledWith('inv-2'));
    expect(screen.queryByText('3 of 3 match')).toBeNull(); // inv-1's numbers are gone until inv-2's arrive
    release(await caseChainFixture(SPECS.slice(0, 1), 'inv-2'));
    expect(await screen.findByText('1 of 1 match')).toBeTruthy();
  });

  it('gives the panel a Proof that states the digest rule', async () => {
    h.getCaseAuditChain.mockResolvedValue(await caseChainFixture(SPECS));
    render(<CaseAuditChainPanel investigationId="inv-1" />);

    expect(await screen.findByRole('button', { name: 'Proof: Case audit chain' })).toBeTruthy();
  });
});
