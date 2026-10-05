import { describe, expect, it } from 'vitest';
import { AGENT_VISUALS, isAgentVisualId } from './agents';

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
