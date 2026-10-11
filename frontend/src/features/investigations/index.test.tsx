import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toInvestigationDetail } from '../../api/adapters';
import type { FleetEntry, InvestigationDetailWire, InvestigationSummary, Metric } from '../../api/types';
import realDetail from '../../test/real/investigation-detail.json';
import { evidenceOutsideMono } from '../../test/evidence';
import { glyphBeside } from '../../test/status';

const client = vi.hoisted(() => ({
  getAgentFleet: vi.fn(),
  getEvidenceBundle: vi.fn(),
  getCaseAuditChain: vi.fn(),
  getInvestigation: vi.fn(),
  getInvestigationCitations: vi.fn(),
  getRawLog: vi.fn(),
  getRbacMatrix: vi.fn(),
  getSettings: vi.fn(),
  listAuditTrail: vi.fn(),
  listInvestigations: vi.fn(),
  releaseContainment: vi.fn(),
  submitFeedback: vi.fn(),
  describeError: (error: unknown) => String(error),
}));

vi.mock('../../api/client', () => client);
// The operations board reads the list endpoint too (running and waiting cases); it has its own test file, so
// the page tests below stay about the list and the dossier.
vi.mock('./OperationsBoard', () => ({ OperationsBoard: () => null }));

import { ScenarioModalContext } from '../../shell/scenario-modal';
import InvestigationsPage from './index';

function metric(value: number | null): Metric<number> {
  return { value, n: value === null ? 0 : 1, as_of: '2026-10-05T00:00:00Z', source: '/investigations', definition: 'd', reason: value === null ? 'none' : null };
}

function summary(overrides: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    id: 'inv12345-aaaa-bbbb',
    status: 'verdict_reached',
    verdict_class: 'ddos',
    verdict_confidence: 0.9,
    primary_agent: 'network_traffic',
    dataset: 'CICIDS2017',
    noise_pct: 0,
    rounds_complete: 3,
    containment_count: 1,
    data_source: 'model',
    error_reason: null,
    trigger_type: 'traffic_spike',
    created_at: '2026-10-05T12:00:00Z',
    ...overrides,
  };
}

function page(items: InvestigationSummary[], total = items.length) {
  return { items, total: metric(total), limit: 20, offset: 0 };
}

function fleetEntry(agentId: FleetEntry['agent_id'], name: string, domain: string): FleetEntry {
  return {
    agent_id: agentId,
    display_name: name,
    domain,
    signals: [],
    provider_chain: ['openai'],
    model: 'm',
    temperature: metric(0.2),
    crs: metric(0.9),
    isolated: false,
    rounds_scored: metric(3),
    citations_verified: metric(3),
    citations_total: metric(3),
    invalid_rate: metric(0),
    last_vote: null,
  };
}

const FLEET = [
  fleetEntry('network_traffic', 'Network-Traffic', 'External network traffic (CICIDS2017 flows)'),
  fleetEntry('access_log', 'Access-Log', 'File access (CERT r4.2 file.csv)'),
];

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

beforeEach(() => {
  vi.clearAllMocks();
  client.getAgentFleet.mockResolvedValue([]);
  client.getSettings.mockResolvedValue({
    eta: 0.15,
    isolation_threshold: 0.3,
    verdict_confidence_threshold: 0.8,
    intake_paused: false,
    debate_rounds: 3,
    starting_crs: 0.5,
  });
  // The storyline re-reads each cited row; one plain logon row serves every id.
  client.getRawLog.mockResolvedValue({
    row_id: '574a5ec4-b50a-4be0-bb55-d96a032d8f92',
    timestamp: '2026-10-05T11:58:00Z',
    source: 'cert_r4.2_logon',
    source_file: 'logon.csv',
    event_type: 'logon',
    user_id: 'U001',
    host_id: 'PC-1',
    severity: null,
    raw_fields: {},
  });
  // The dossier's case audit chain panel reads its own endpoint: a case with no entries is enough here.
  client.getCaseAuditChain.mockResolvedValue({
    investigation_id: 'inv12345-aaaa-bbbb',
    entries: [],
    count: metric(0),
    case_digest: null,
    digest_rule: 'rule',
    chain: { valid: true, head_seq: null, total: 0 },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvestigationsPage', () => {
  it('renders real case fields: short id, verdict label and agent-reported confidence', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    render(<InvestigationsPage />);
    expect(await screen.findByText('inv12345')).toBeTruthy();
    expect(screen.getAllByText('DDoS').length).toBeGreaterThanOrEqual(1);
    const conf = screen.getByText(/conf\./);
    expect(conf.textContent).toContain('90.0%');
  });

  it('shows an em dash for confidence when none is recorded (never 0)', async () => {
    client.listInvestigations.mockResolvedValue(page([summary({ verdict_class: null, verdict_confidence: null, status: 'investigating' })]));
    render(<InvestigationsPage />);
    expect(await screen.findByText('inv12345')).toBeTruthy();
    const conf = screen.getByText(/conf\./);
    expect(conf.textContent).toContain('—');
  });

  it('shows every id and hash in the evidence font, in the list and in the open dossier', async () => {
    const detail = toInvestigationDetail(realDetail as unknown as InvestigationDetailWire);
    client.listInvestigations.mockResolvedValue(page([summary({ id: detail.id })]));
    client.getInvestigation.mockResolvedValue(detail);
    client.getInvestigationCitations.mockResolvedValue({
      summary: detail.citations,
      citations: [
        { row_id: '574a5ec4-b50a-4be0-bb55-d96a032d8f92', field: 'Destination Port', value: '443', expected: '443', status: 'VERIFIED', reason: 'ok', agent_id: 'network_traffic', round: 1, row_fingerprint: 'd'.repeat(64) },
      ],
    });
    client.getEvidenceBundle.mockResolvedValue({ bundle: {}, bundle_sha256: 'c'.repeat(64), signatures: [] });
    client.listAuditTrail.mockResolvedValue({ entries: [], chain: { valid: true, head_seq: null, total: 0 } });
    const { container } = render(<InvestigationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: `Open dossier ${detail.id.slice(0, 8)}` }));
    await screen.findByText('SHA-256 digest');
    await waitFor(() => expect(client.getEvidenceBundle).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Copy Evidence bundle SHA-256' });

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it('puts a glyph beside the status word of a case that has no verdict, and a different one for each status', async () => {
    client.listInvestigations.mockResolvedValue(
      page([
        summary({ id: 'a1111111-aaaa-bbbb', status: 'investigating', verdict_class: null, verdict_confidence: null }),
        summary({ id: 'b2222222-aaaa-bbbb', status: 'error', verdict_class: null, verdict_confidence: null }),
        summary({ id: 'c3333333-aaaa-bbbb', status: 'queued', verdict_class: null, verdict_confidence: null }),
      ]),
    );
    render(<InvestigationsPage />);
    await screen.findByText('a1111111');

    const glyphs = [
      glyphBeside(screen.getAllByText('Investigating')[0]),
      glyphBeside(screen.getAllByText('Failed')[0]),
      glyphBeside(screen.getAllByText('Queued')[0]),
    ];
    expect(glyphs).toEqual(['sync', 'cancel', 'schedule']);
  });

  it('says on the card why a failed case stopped, and does not guess a cause when none was stored', async () => {
    client.listInvestigations.mockResolvedValue(
      page([
        summary({ id: 'inv-failed-aaaa-bbbb', status: 'error', verdict_class: null, verdict_confidence: null, error_reason: 'An investigator failed validation twice.' }),
        summary({ id: 'inv-old-aaaa-bbbb', status: 'error', verdict_class: null, verdict_confidence: null, error_reason: null }),
        summary({ id: 'inv-fine-aaaa-bbbb' }),
      ]),
    );
    render(<InvestigationsPage />);

    expect(await screen.findByText('Stopped: An investigator failed validation twice.')).toBeTruthy();
    expect(screen.getByText(/Stopped: no reason was recorded/)).toBeTruthy();
    expect(screen.getAllByText(/^Stopped:/)).toHaveLength(2); // the healthy case has no such line
  });

  it('shows the case id with a copy button for the full id, the noise as a percentage and a relative time', async () => {
    client.listInvestigations.mockResolvedValue(page([summary({ noise_pct: 30 })]));
    const { container } = render(<InvestigationsPage />);
    await screen.findByText('inv12345');
    expect(screen.getByRole('button', { name: 'Copy investigation id' })).toBeTruthy();
    expect(screen.getByText('inv12345').getAttribute('title')).toBe('inv12345-aaaa-bbbb');
    expect(screen.getByText('30%')).toBeTruthy();
    expect(container.querySelector('time[datetime="2026-10-05T12:00:00Z"]')?.getAttribute('title')).toBe('2026-10-05 12:00:00 UTC');
    // A card is a select button plus sibling buttons, never a button inside a button.
    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });

  it('selects a case from its card', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    client.getInvestigation.mockRejectedValue(new Error('x'));
    client.getEvidenceBundle.mockRejectedValue(new Error('x'));
    client.getInvestigationCitations.mockRejectedValue(new Error('x'));
    client.listAuditTrail.mockRejectedValue(new Error('x'));
    render(<InvestigationsPage />);
    const card = await screen.findByRole('button', { name: 'Open dossier inv12345' });
    expect(card.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(client.getInvestigation).toHaveBeenCalledWith('inv12345-aaaa-bbbb'));
  });

  describe('filters', () => {
    it('keeps every filter inside one Filters menu with no always-visible chip row', async () => {
      client.getAgentFleet.mockResolvedValue(FLEET);
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      expect(screen.queryByLabelText('Verdict class')).toBeNull();
      openFilters();
      expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
      expect(screen.getByLabelText('Status')).toBeTruthy();
      expect(screen.getByLabelText('Verdict class')).toBeTruthy();
      expect(screen.getByLabelText('Primary agent')).toBeTruthy();
    });

    it('refetches the list with the chosen verdict class and resets to the first page', async () => {
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      openFilters();
      fireEvent.change(screen.getByLabelText('Verdict class'), { target: { value: 'ddos' } });
      await waitFor(() =>
        expect(client.listInvestigations).toHaveBeenCalledWith(expect.objectContaining({ verdict_class: 'ddos', offset: 0 })),
      );
    });

    it('sends status and primary agent as server parameters, shows the active count and the agent domain', async () => {
      client.getAgentFleet.mockResolvedValue(FLEET);
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      openFilters();
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'contained' } });
      await screen.findByRole('option', { name: /Access-Log/ });
      fireEvent.change(screen.getByLabelText('Primary agent'), { target: { value: 'access_log' } });
      await waitFor(() =>
        expect(client.listInvestigations).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'contained', primary_agent: 'access_log', verdict_class: undefined }),
        ),
      );
      expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeTruthy();
      expect(screen.getByText('Reads: File access (CERT r4.2 file.csv)')).toBeTruthy();
    });

    it('clears the filters from the menu', async () => {
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      openFilters();
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'contained' } });
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      await waitFor(() =>
        expect(client.listInvestigations).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined, verdict_class: undefined, primary_agent: undefined })),
      );
      expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    });

    it('closes the menu on Escape and returns focus to the Filters button', async () => {
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      const trigger = screen.getByRole('button', { name: 'Filters' });
      fireEvent.click(trigger);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('sends the search text as q after the debounce', async () => {
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      fireEvent.change(screen.getByLabelText('Search investigations'), { target: { value: 'ddos' } });
      await waitFor(() => expect(client.listInvestigations).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ddos', offset: 0 })));
    });
  });

  describe('empty states', () => {
    it('with filters on, says nothing matches and offers to clear them', async () => {
      client.listInvestigations.mockResolvedValue(page([summary()]));
      render(<InvestigationsPage />);
      await screen.findByText('inv12345');
      client.listInvestigations.mockResolvedValue(page([]));
      openFilters();
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'error' } });
      expect(await screen.findByText('No investigations match')).toBeTruthy();
      client.listInvestigations.mockResolvedValue(page([summary()]));
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear search and filters' }).at(-1) as HTMLElement);
      expect(await screen.findByText('inv12345')).toBeTruthy();
    });

    it('with no data and the inject_scenario capability, offers to run the first scenario in the shared modal', async () => {
      client.listInvestigations.mockResolvedValue(page([]));
      const open = vi.fn();
      render(
        <ScenarioModalContext.Provider value={{ canInject: true, open }}>
          <InvestigationsPage />
        </ScenarioModalContext.Provider>,
      );
      expect(await screen.findByText('No investigations yet')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Run first scenario' }));
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('with no data and no capability, says which roles can instead of offering a button', async () => {
      client.listInvestigations.mockResolvedValue(page([]));
      client.getRbacMatrix.mockResolvedValue({ roles: ['secops_lead'], capabilities: { inject_scenario: ['secops_lead', 'forensic_analyst'] } });
      render(
        <ScenarioModalContext.Provider value={{ canInject: false, open: vi.fn() }}>
          <InvestigationsPage />
        </ScenarioModalContext.Provider>,
      );
      expect(await screen.findByText('No investigations yet')).toBeTruthy();
      expect(await screen.findByText(/Roles that can: SecOps lead, Forensic analyst\./)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Run first scenario' })).toBeNull();
    });

    it('shows no action at all outside the signed-in shell', async () => {
      client.listInvestigations.mockResolvedValue(page([]));
      render(<InvestigationsPage />);
      expect(await screen.findByText('No investigations yet')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Run first scenario/ })).toBeNull();
    });
  });

  it('opens the shared scenario modal from the Inject Scenario button, disabled without the capability', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    const open = vi.fn();
    const { rerender } = render(
      <ScenarioModalContext.Provider value={{ canInject: true, open }}>
        <InvestigationsPage />
      </ScenarioModalContext.Provider>,
    );
    await screen.findByText('inv12345');
    fireEvent.click(screen.getByRole('button', { name: 'Inject Scenario' }));
    expect(open).toHaveBeenCalledTimes(1);
    rerender(
      <ScenarioModalContext.Provider value={{ canInject: false, open }}>
        <InvestigationsPage />
      </ScenarioModalContext.Provider>,
    );
    expect((screen.getByRole('button', { name: 'Inject Scenario' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the next page only when a full page came back, because the list reports no total', async () => {
    const full = Array.from({ length: 20 }, (_, index) => summary({ id: `case-${String(index).padStart(2, '0')}-xxxxxxxx` }));
    client.listInvestigations.mockResolvedValue(page(full));
    render(<InvestigationsPage />);
    await screen.findByText('case-00-');
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    client.listInvestigations.mockResolvedValue(page([summary()]));
    fireEvent.click(next);
    await waitFor(() => expect(client.listInvestigations).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 })));
    expect(await screen.findByText('rows 21–21')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a dismissible how-to-read hint that stays dismissed', async () => {
    client.listInvestigations.mockResolvedValue(page([summary()]));
    const first = render(<InvestigationsPage />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
    first.unmount();
    render(<InvestigationsPage />);
    expect(screen.queryByText('How to read this page')).toBeNull();
  });
});
