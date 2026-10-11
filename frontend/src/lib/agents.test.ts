import { describe, expect, it } from 'vitest';
import { AGENT_VISUALS, INVESTIGATOR_IDS, INVESTIGATOR_VISUALS, isAgentVisualId } from './agents';

describe('the one agent table', () => {
  it('lists the three investigators once, in display order, with a glyph and a tone each', () => {
    expect(INVESTIGATOR_IDS).toEqual(['network_traffic', 'access_log', 'endpoint_behavior']);
    expect(Object.keys(INVESTIGATOR_VISUALS)).toEqual([...INVESTIGATOR_IDS]);
    expect(new Set(INVESTIGATOR_IDS.map((id) => INVESTIGATOR_VISUALS[id].glyph)).size).toBe(3);
    expect(new Set(INVESTIGATOR_IDS.map((id) => INVESTIGATOR_VISUALS[id].tone)).size).toBe(3);
  });

  it('is the same data the chips read, so a screen cannot show an investigator in another colour', () => {
    for (const id of INVESTIGATOR_IDS) expect(AGENT_VISUALS[id]).toBe(INVESTIGATOR_VISUALS[id]);
  });
});

describe('agent visuals', () => {
  it('gives each agent its glyph and token tone', () => {
    expect(AGENT_VISUALS.network_traffic).toEqual({ glyph: 'α', tone: 'primary' });
    expect(AGENT_VISUALS.access_log).toEqual({ glyph: 'β', tone: 'secondary' });
    expect(AGENT_VISUALS.endpoint_behavior).toEqual({ glyph: 'γ', tone: 'tertiary' });
    expect(AGENT_VISUALS.watchdog).toEqual({ glyph: 'Ω', tone: 'primary-container' });
    expect(AGENT_VISUALS.self_healing).toEqual({ glyph: 'Σ', tone: 'error' });
  });

  it('accepts only known visual ids', () => {
    expect(isAgentVisualId('watchdog')).toBe(true);
    expect(isAgentVisualId('toString')).toBe(false);
    expect(isAgentVisualId('constructor')).toBe(false);
  });
});
