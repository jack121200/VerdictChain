import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_ID, bundle, detail, serveCase } from '../../test/case-document';

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

import ReportPage from './index';

const region = (name: string) => screen.getByRole('region', { name });

beforeEach(async () => {
  vi.clearAllMocks();
  await serveCase(client);
});

describe('ReportPage', () => {
  it('builds the report from the case’s own fields, section by section', async () => {
    render(<ReportPage id={CASE_ID} />);

    const cover = await screen.findByLabelText('Report cover');
    expect(cover.textContent).toContain('DDoS');
    expect(cover.textContent).toContain(CASE_ID);
    expect(cover.textContent).toContain('90.0%');
    expect(cover.textContent).toContain('by soc_lead');

    const summary = region('Summary');
    expect(within(summary).getByText(/^The live monitor opened this investigation at 2026-10-11 10:00:00 UTC on the CICIDS2017 data\./)).toBeTruthy();
    expect(within(summary).getByText(/The Self-Healing agent ran 2 sandboxed actions \(lock account, open an audit\), the first 1\.2 s after the verdict\./)).toBeTruthy();
    for (const title of ['How the automation handled it', 'The investigators', 'The debate, round by round', 'Aggregation', 'Evidence the Watchdog re-checked', 'Evidence storyline', 'Self-Healing response', 'Integrity']) {
      expect(region(title), title).toBeTruthy();
    }
    expect(within(region('How the automation handled it')).getByText('Hands-free · no analyst action')).toBeTruthy();
    expect(within(region('The investigators')).getAllByText('Network-Traffic Investigator').length).toBeGreaterThanOrEqual(1);
    expect(within(region('Self-Healing response')).getByText('Contained in the sandbox')).toBeTruthy();
    expect(within(region('Self-Healing response')).getByText('Lock account')).toBeTruthy();
  });

  it('offers the PDF only after it has recomputed the digests, and says what matched', async () => {
    render(<ReportPage id={CASE_ID} />);

    const button = await screen.findByRole('button', { name: 'Download PDF' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const integrity = region('Integrity');
    expect(integrity.textContent).toContain('Bundle hash recomputed here: it matches');
    expect(integrity.textContent).toContain('4 of 4 audit entry hashes recomputed here match');
    expect(integrity.textContent).toContain('Case digest recomputed here: it matches');
    expect(integrity.textContent).toContain('Global audit chain valid (90 entries)');
    expect(integrity.textContent).toContain('not a digital signature');
  });

  it('opens the print dialog with the file name as the page title, then puts the title back', async () => {
    const before = document.title;
    let titleWhilePrinting = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      titleWhilePrinting = document.title;
    });
    render(<ReportPage id={CASE_ID} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(titleWhilePrinting).toBe('VerdictChain-report-aaaaaaaa');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe(before);
    print.mockRestore();
  });

  it('says which part could not be read and does not pretend to have checked it', async () => {
    client.getEvidenceBundle.mockRejectedValue(new Error('bundle down'));
    render(<ReportPage id={CASE_ID} />);

    expect((await screen.findByRole('note')).textContent).toContain('evidence bundle (bundle down)');
    const integrity = region('Integrity');
    expect(integrity.textContent).toContain('not available');
    expect(integrity.textContent).toContain('Bundle hash not recomputed');
    expect(integrity.textContent).not.toContain('it matches'.repeat(2));
  });

  it('shows a debate that stopped with its reason instead of a verdict', async () => {
    client.getInvestigation.mockResolvedValue(detail({ status: 'error', verdict_class: null, verdict_confidence: null, error_reason: 'OpenAI refused the request.', actions: [], votes: [] }));
    client.getEvidenceBundle.mockResolvedValue(await bundle(detail({ status: 'error', verdict_class: null, verdict_confidence: null, actions: [], votes: [] })));
    render(<ReportPage id={CASE_ID} />);

    const cover = await screen.findByLabelText('Report cover');
    expect(cover.textContent).toContain('No verdict');
    expect(within(region('Summary')).getByText(/The debate stopped before a verdict: OpenAI refused the request\./)).toBeTruthy();
  });

  it('says the report could not be built when the investigation itself cannot be read', async () => {
    client.getInvestigation.mockRejectedValue(new Error('no such investigation'));
    render(<ReportPage id={CASE_ID} />);

    expect(await screen.findByText('The report could not be built')).toBeTruthy();
    expect(screen.getByText('no such investigation')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: /Preparing/ }) as HTMLButtonElement).disabled).toBe(true));
  });
});
