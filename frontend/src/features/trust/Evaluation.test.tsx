import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationResponse, EvaluationSource } from '../../api/types';
import { evaluationFixture } from '../../test/fixtures';

const h = vi.hoisted(() => ({ getEvaluation: vi.fn() }));

vi.mock('../../api/client', () => ({
  getEvaluation: h.getEvaluation,
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

import { EvaluationPanel } from './Evaluation';

beforeEach(() => {
  vi.clearAllMocks();
  // No real model run has reached a verdict; 12 offline-stub runs have.
  h.getEvaluation.mockImplementation(async (source: EvaluationSource = 'model') =>
    source === 'stub' ? evaluationFixture('stub', 10, { stub: 12 }) : evaluationFixture(source, 0, { stub: 12 }),
  );
});

const panel = () => within(screen.getByRole('region', { name: 'Evaluation against labelled scenarios' }));
const headline = () => within(screen.getByRole('group', { name: 'Headline rates' }));

describe('EvaluationPanel', () => {
  it('counts the real model by default and says so, even when only stub runs exist', async () => {
    render(<EvaluationPanel />);

    expect(await screen.findByText(/Counts only investigations answered by the real model/)).toBeTruthy();
    expect(h.getEvaluation).toHaveBeenCalledWith('model');
    expect(panel().getByRole('tab', { name: 'Model runs', selected: true })).toBeTruthy();
  });

  it('shows "—" with the API reason for a rate nobody has measured, never 0, and no matrix of zeros', async () => {
    render(<EvaluationPanel />);

    expect(await screen.findByText('Nothing scored for this choice yet')).toBeTruthy();
    expect(panel().getAllByText('—').length).toBeGreaterThanOrEqual(4); // accuracy, acceptable, family, abstain
    // The reason sentence comes from the API, word for word, and is shown once (each tile's Proof carries it too).
    expect(panel().getAllByText('no model runs scored yet; 12 scored run(s) from other sources are not counted here')).toHaveLength(1);
    expect(panel().queryByRole('table', { name: /Expected class by verdict given/ })).toBeNull();
    expect(panel().queryByText('0.0%')).toBeNull();
  });

  it('keeps the stub apart: its scored runs are on their own tile, labelled, beside the model and mixed ones', async () => {
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');

    const group = within(screen.getByRole('group', { name: 'Accuracy by source of the answers' }));
    expect(group.getByText('Offline stub')).toBeTruthy();
    expect(group.getByText('12 scored')).toBeTruthy();
    expect(group.getByText('Model')).toBeTruthy();
    expect(group.getByText('Mixed')).toBeTruthy();
  });

  it('switches to the stub, asks for it, warns that it measures the stub, and shows the full result', async () => {
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');

    fireEvent.click(panel().getByRole('tab', { name: 'Offline stub runs' }));

    await waitFor(() => expect(h.getEvaluation).toHaveBeenCalledWith('stub'));
    expect(await screen.findByText(/measure the stub’s canned sentences, not a model/)).toBeTruthy();
    await screen.findByRole('group', { name: 'Headline rates' });
    expect(await headline().findByText('80.0%')).toBeTruthy(); // accuracy
    expect(headline().getByText('10')).toBeTruthy(); // scored
    expect(panel().getByText(/10 scored/)).toBeTruthy();
    // Per class: precision and recall of DDoS from the API; a class nobody predicted is a dash.
    const perClass = within(panel().getByRole('table', { name: 'Precision, recall and F1 per verdict class' }));
    expect(perClass.getByText('83.3%')).toBeTruthy();
    expect(perClass.getAllByText('—').length).toBeGreaterThan(0);
    // By noise: the three levels the inject dialog offers.
    const byNoise = within(panel().getByRole('table', { name: /by noise level/ }));
    expect(byNoise.getByText('0 %')).toBeTruthy();
    expect(byNoise.getByText('15 %')).toBeTruthy();
    expect(byNoise.getByText('30 %')).toBeTruthy();
  });

  it('draws the confusion matrix from the API counts, with the digit as the signal and misses apart from hits', async () => {
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');
    fireEvent.click(panel().getByRole('tab', { name: 'Offline stub runs' }));

    const matrix = within(await panel().findByRole('table', { name: /Expected class by verdict given/ }));
    const ddosRow = matrix.getByRole('row', { name: /^ddos/ });
    expect(within(ddosRow).getByText('5')).toBeTruthy(); // five DDoS cases read as DDoS (the diagonal)
    const portScanRow = matrix.getByRole('row', { name: /^port_scan/ });
    expect(within(portScanRow).getByText('1')).toBeTruthy(); // one port scan read as DDoS (a miss)
    const benignRow = matrix.getByRole('row', { name: /^benign/ });
    expect(within(benignRow).getByText('1')).toBeTruthy(); // one benign case that ended ambiguous (an abstention)
    expect(matrix.getAllByRole('columnheader').map((cell) => cell.textContent)).toContain('unclassified');
  });

  it('never shows the numbers of one choice under the tab of another while the new ones load', async () => {
    let release: (value: EvaluationResponse) => void = () => undefined;
    h.getEvaluation.mockImplementation(
      (source: EvaluationSource = 'model') =>
        source === 'model'
          ? Promise.resolve(evaluationFixture('model', 0, { stub: 12 }))
          : new Promise<EvaluationResponse>((resolve) => {
              release = resolve;
            }),
    );
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');

    fireEvent.click(panel().getByRole('tab', { name: 'Offline stub runs' }));

    // The model numbers are still held by the hook, but they must not be drawn under the stub tab.
    await waitFor(() => expect(h.getEvaluation).toHaveBeenCalledWith('stub'));
    expect(panel().queryByText('Nothing scored for this choice yet')).toBeNull();
    release(evaluationFixture('stub', 10, { stub: 12 }));
    await screen.findByRole('group', { name: 'Headline rates' });
    expect(headline().getByText('80.0%')).toBeTruthy();
  });

  it('explains how a scenario label is scored, from the API mapping, and says agents never see it', async () => {
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');

    const mapping = within(panel().getByRole('table', { hidden: true, name: /Scenario label, the verdict class it is scored against/ }));
    expect(mapping.getByText('insider_scenario_1')).toBeTruthy();
    expect(mapping.getByText('insider_file_exfiltration')).toBeTruthy(); // also accepted
    expect(panel().getByText(/no investigator is ever shown it/)).toBeTruthy();
  });

  it('gives every headline number a Proof, and shows the plain-words error when the API fails', async () => {
    render(<EvaluationPanel />);
    await screen.findByText('Nothing scored for this choice yet');
    expect(panel().getByRole('button', { name: 'Proof: Accuracy' })).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Proof: Family accuracy' })).toBeTruthy();

    h.getEvaluation.mockRejectedValue(new Error('The evaluation could not be read.'));
    fireEvent.click(panel().getByRole('tab', { name: 'All runs' }));
    expect(await panel().findByText('The evaluation could not be read.')).toBeTruthy();
  });
});
