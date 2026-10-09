import { describe, expect, it } from 'vitest';
import type { LiveWindow } from '../../api/types';
import { FLAG_SUSPICION, RULE_DEFINITION, fillRatio, thresholdLabel, valueLabel, windowState } from './derive';

function win(over: Partial<LiveWindow> = {}): LiveWindow {
  return {
    group: 'logon',
    source: 'CERT r4.2 logons',
    feature: 'off_hours',
    size: 20,
    rows: 20,
    scored_rows: 20,
    value: 0.05,
    threshold: 0.2,
    z: 0.4,
    suspicion: 0.05,
    flagged: false,
    rule: 'r',
    evaluated_at: null,
    ...over,
  };
}

describe('live window helpers', () => {
  it('the flag sits at one half for every group', () => {
    expect(FLAG_SUSPICION).toBe(0.5);
  });

  it('classifies a window as filling, normal or flagged', () => {
    expect(windowState(win({ rows: 7, value: null }))).toBe('filling');
    expect(windowState(win({ value: null }))).toBe('filling'); // full, but not scored yet
    expect(windowState(win())).toBe('normal');
    expect(windowState(win({ flagged: true }))).toBe('flagged');
  });

  it('labels the network group by its spread and flags at most, the others by their mean and flag at least', () => {
    expect(valueLabel('network')).toBe('spread');
    expect(thresholdLabel('network')).toBe('flag at ≤');
    expect(valueLabel('device')).toBe('window mean');
    expect(thresholdLabel('device')).toBe('flag at ≥');
  });

  it('measures how full a window is, never above one', () => {
    expect(fillRatio(win({ rows: 5, size: 20 }))).toBe(0.25);
    expect(fillRatio(win({ rows: 30, size: 20 }))).toBe(1);
    expect(fillRatio(win({ size: 0 }))).toBe(0);
  });

  it('every group has a Proof definition that names its rule', () => {
    for (const group of ['network', 'logon', 'device', 'file'] as const) {
      expect(RULE_DEFINITION[group].length).toBeGreaterThan(40);
    }
    expect(RULE_DEFINITION.network).toContain('Flow Packets/s');
    expect(RULE_DEFINITION.device).toContain('connect_count');
    expect(RULE_DEFINITION.file).toContain('no label is read');
  });
});
