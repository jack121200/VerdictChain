/**
 * Visual identity only: the glyph and the token colour of each agent (SKILL-design-system section 5).
 * Names, domains and signals come from GET /agents/fleet. This file holds no names and no data.
 *
 * It is also the one place that lists the three investigators and their glyph and colour: screens read
 * INVESTIGATOR_IDS and INVESTIGATOR_VISUALS from here (frontend/scripts/no-bluff-check.mjs fails on a copy).
 */
import type { InvestigatorId } from '../api/types';

export type AgentVisualId = InvestigatorId | 'watchdog' | 'self_healing';

/** Tokens only. Components map each tone to its utility classes. */
export type AgentTone = 'primary' | 'secondary' | 'tertiary' | 'primary-container' | 'error';

export interface AgentVisual {
  glyph: string;
  tone: AgentTone;
}

/** The three investigators in the display order used across the console. */
export const INVESTIGATOR_IDS: readonly InvestigatorId[] = ['network_traffic', 'access_log', 'endpoint_behavior'];

/** Network cyan, access emerald, endpoint amber: the tones every chart and chip of an investigator uses. */
export type InvestigatorTone = 'primary' | 'secondary' | 'tertiary';

export const INVESTIGATOR_VISUALS: Record<InvestigatorId, { glyph: string; tone: InvestigatorTone }> = {
  network_traffic: { glyph: 'α', tone: 'primary' },
  access_log: { glyph: 'β', tone: 'secondary' },
  endpoint_behavior: { glyph: 'γ', tone: 'tertiary' },
};

export const AGENT_VISUALS: Record<AgentVisualId, AgentVisual> = {
  ...INVESTIGATOR_VISUALS,
  watchdog: { glyph: 'Ω', tone: 'primary-container' },
  self_healing: { glyph: 'Σ', tone: 'error' },
};

export function isAgentVisualId(value: string): value is AgentVisualId {
  return Object.prototype.hasOwnProperty.call(AGENT_VISUALS, value);
}
