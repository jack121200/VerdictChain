/**
 * Visual identity only: the glyph and the token colour of each agent (SKILL-design-system section 5).
 * Names, domains and signals come from GET /agents/fleet. This file holds no names and no data.
 */

export type AgentVisualId = 'network_traffic' | 'access_log' | 'endpoint_behavior' | 'watchdog' | 'self_healing';

/** Tokens only. Components map each tone to its utility classes. */
export type AgentTone = 'primary' | 'secondary' | 'tertiary' | 'primary-container' | 'error';

export interface AgentVisual {
  glyph: string;
  tone: AgentTone;
}

export const AGENT_VISUALS: Record<AgentVisualId, AgentVisual> = {
  network_traffic: { glyph: 'α', tone: 'primary' },
  access_log: { glyph: 'β', tone: 'secondary' },
  endpoint_behavior: { glyph: 'γ', tone: 'tertiary' },
  watchdog: { glyph: 'Ω', tone: 'primary-container' },
  self_healing: { glyph: 'Σ', tone: 'error' },
};

export function isAgentVisualId(value: string): value is AgentVisualId {
  return Object.prototype.hasOwnProperty.call(AGENT_VISUALS, value);
}
