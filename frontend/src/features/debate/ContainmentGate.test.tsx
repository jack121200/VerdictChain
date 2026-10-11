import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContainmentGate } from './ContainmentGate';
import type { ContainmentGate as Gate } from './gate';

const PASSING: Gate = {
  outcome: 'passed',
  refusal: null,
  checks: [
    { id: 'verdict', state: 'pass', title: 'A verdict was reached', detail: 'The agents agreed on a class.' },
    { id: 'class', state: 'pass', title: 'The class has containment actions', detail: 'DDoS plans sandbox actions.' },
    { id: 'confidence', state: 'pass', title: 'Confidence is at or above the containment floor', detail: '90.0% is at or above the floor 80.0%.' },
    { id: 'credibility', state: 'pass', title: 'Every supporting agent is at or above the credibility floor', detail: 'The lowest is Access-Log at 58.0%.' },
  ],
};

describe('ContainmentGate', () => {
  it('lists the four conditions, each with its numbers, and says the actions ran when all passed', () => {
    render(<ContainmentGate gate={PASSING} loadedAt={null} />);

    const card = within(screen.getByRole('region', { name: 'Containment gate' }));
    expect(card.getAllByRole('listitem')).toHaveLength(4);
    expect(card.getByText('passed: the sandbox actions ran')).toBeTruthy();
    expect(card.getByText('90.0% is at or above the floor 80.0%.')).toBeTruthy();
    expect(card.getAllByText(/· Passed/)).toHaveLength(4);
  });

  it('shows a refusal as words, an icon and the sentence, not as a colour alone', () => {
    const refused: Gate = {
      outcome: 'refused',
      refusal: 'Confidence 88.0% is below the floor 95.0%.',
      checks: PASSING.checks.map((check) =>
        check.id === 'confidence' ? { ...check, state: 'fail' as const, detail: 'Confidence 88.0% is below the floor 95.0%.' } : check,
      ),
    };
    const { container } = render(<ContainmentGate gate={refused} loadedAt={null} />);

    expect(screen.getByText('refused: nothing was contained')).toBeTruthy();
    expect(screen.getAllByText('Confidence 88.0% is below the floor 95.0%.').length).toBeGreaterThanOrEqual(2); // the row and the summary
    expect(screen.getByText(/· Refused/)).toBeTruthy();
    // Status words come with their own icon glyph (Material Symbols render the icon name as text).
    expect(container.textContent).toContain('cancel');
    expect(container.textContent).toContain('check_circle');
  });

  it('says a case is waiting for a verdict, and does not say it was refused', () => {
    const pending: Gate = {
      outcome: 'pending',
      refusal: null,
      checks: PASSING.checks.map((check) => ({ ...check, state: 'unknown' as const, detail: 'no verdict yet' })),
    };
    render(<ContainmentGate gate={pending} loadedAt={null} />);

    expect(screen.getByText('waiting for a verdict')).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
    expect(screen.getAllByText(/Not known yet/)).toHaveLength(4);
  });

  it('says a stopped debate has no verdict, and does not say it is waiting for one or that it was refused', () => {
    const stopped: Gate = {
      outcome: 'stopped',
      refusal: null,
      checks: PASSING.checks.map((check) => ({ ...check, state: 'unknown' as const, detail: 'The debate stopped before a verdict.' })),
    };
    render(<ContainmentGate gate={stopped} loadedAt={null} />);

    expect(screen.getByText('no verdict: the debate stopped')).toBeTruthy();
    expect(screen.queryByText('waiting for a verdict')).toBeNull();
    expect(screen.queryByText(/refused/)).toBeNull();
    expect(screen.getAllByText('The debate stopped before a verdict.')).toHaveLength(4);
  });

  it('shows a hand-run containment as such', () => {
    render(<ContainmentGate gate={{ ...PASSING, outcome: 'manual', refusal: 'Confidence 50.0% is below the floor 80.0%.' }} loadedAt={null} />);

    expect(screen.getByText('contained by hand: an analyst ran it')).toBeTruthy();
  });
});
