import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_ID, bundle, chain, serveCase } from '../../test/case-document';

const client = vi.hoisted(() => ({
  getInvestigation: vi.fn(),
  getEvidenceBundle: vi.fn(),
  getInvestigationCitations: vi.fn(),
  listAuditTrail: vi.fn(),
  getCaseAuditChain: vi.fn(),
  getSettings: vi.fn(),
  getAgentFleet: vi.fn(),
  getMe: vi.fn(),
  getRawLog: vi.fn(),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../../api/client', () => client);

import CustodyPage from './index';

const region = (name: string) => screen.getByRole('region', { name });

beforeEach(async () => {
  vi.clearAllMocks();
  await serveCase(client);
});

describe('CustodyPage', () => {
  it('lists every entry of the case with its full hash and says each was recomputed here', async () => {
    const fixture = await chain();
    render(<CustodyPage id={CASE_ID} />);

    const events = await screen.findByRole('region', { name: 'Custody events' });
    expect(await within(events).findAllByText('yes, matches')).toHaveLength(fixture.entries.length);
    for (const entry of fixture.entries) expect(events.textContent).toContain(entry.entry_hash); // 64 characters each, never a short form
    expect(within(events).getByText('investigation_started')).toBeTruthy();
    expect(within(events).getByText('verdict_reached')).toBeTruthy();
  });

  it('states the digests and that they were recomputed in the browser', async () => {
    const fixture = await chain();
    render(<CustodyPage id={CASE_ID} />);

    const summary = await screen.findByRole('region', { name: 'Custody summary' });
    expect(await within(summary).findByText('Case digest recomputed here: it matches')).toBeTruthy();
    expect(within(summary).getByText('Bundle hash recomputed here: it matches')).toBeTruthy();
    expect(within(summary).getByText('4 of 4 entry hashes recomputed here match')).toBeTruthy();
    expect(summary.textContent).toContain(fixture.case_digest ?? 'x');
    expect(summary.textContent).toContain('4 of the 90 entries of the global chain');
  });

  it('says when the server’s case digest is not the one recomputed here, instead of passing it', async () => {
    client.getCaseAuditChain.mockResolvedValue({ ...(await chain()), case_digest: 'e'.repeat(64) });
    render(<CustodyPage id={CASE_ID} />);

    expect(await screen.findByText('Case digest recomputed here: it does NOT match')).toBeTruthy();
  });

  it('marks the entry whose text was changed after it was written', async () => {
    const tampered = await chain();
    tampered.entries[1] = { ...tampered.entries[1], hash_input: `${tampered.entries[1].hash_input} changed` };
    client.getCaseAuditChain.mockResolvedValue(tampered);
    render(<CustodyPage id={CASE_ID} />);

    const events = await screen.findByRole('region', { name: 'Custody events' });
    expect(await within(events).findAllByText('yes, matches')).toHaveLength(3);
    expect(within(events).getByText('no, differs')).toBeTruthy();
    expect(await screen.findByText('3 of 4 entry hashes recomputed here match')).toBeTruthy();
  });

  it('prints a blank hand-over block for a person to sign, and the honest note about signatures', async () => {
    render(<CustodyPage id={CASE_ID} />);

    const block = await screen.findByRole('region', { name: 'Hand-over record' });
    for (const label of ['Handed over by', 'Received by', 'Role', 'Signature', 'Date and time (UTC)']) expect(within(block).getByText(label)).toBeTruthy();
    expect(screen.getByText(/not a cryptographic signature/)).toBeTruthy();
  });

  it('lists the sign-offs recorded in the console, and whether the bundle is still the one they covered', async () => {
    const withSignature = await bundle();
    withSignature.signatures = [{ signed_by: 'soc_lead', signed_at: '2026-10-11T10:05:00Z', bundle_sha256: withSignature.bundle_sha256, still_matches: true }];
    client.getEvidenceBundle.mockResolvedValue(withSignature);
    render(<CustodyPage id={CASE_ID} />);

    const acknowledgements = await screen.findByRole('region', { name: 'Recorded acknowledgements' });
    expect(within(acknowledgements).getByText('soc_lead')).toBeTruthy();
    expect(within(acknowledgements).getByText('yes')).toBeTruthy();
  });

  it('says the audit entries could not be read, and keeps the rest of the record', async () => {
    client.getCaseAuditChain.mockRejectedValue(new Error('chain down'));
    render(<CustodyPage id={CASE_ID} />);

    expect(await screen.findByText(/The audit entries could not be read: chain down/)).toBeTruthy();
    expect(region('Hand-over record')).toBeTruthy();
  });
});
