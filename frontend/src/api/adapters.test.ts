/**
 * Adapter tests run on payloads captured from the REAL backend (src/test/real/*.json), not on hand-made
 * mocks. The JSON files are typed as the wire types, so a backend change that the types do not describe
 * fails here as well as in scripts/contract-check.mjs.
 */
import { describe, expect, it } from 'vitest';
import detailJson from '../test/real/investigation-detail.json';
import citationsJson from '../test/real/citations-global.json';
import listJson from '../test/real/investigations-list.json';
import {
  groupRounds,
  toCitationPage,
  toInvestigationDetail,
  toInvestigationPage,
  toInvestigationSummary,
  toVotes,
} from './adapters';
import type { GlobalCitation, InvestigationDetailWire, InvestigationSummaryWire } from './types';

const list = listJson as unknown as InvestigationSummaryWire[];
const detailWire = detailJson as unknown as InvestigationDetailWire;
const citations = citationsJson as unknown as GlobalCitation[];

describe('toInvestigationSummary / toInvestigationPage', () => {
  it('renames investigation_id to id and keeps every other field', () => {
    const wire = list[0];
    const model = toInvestigationSummary(wire);
    expect(model.id).toBe(wire.investigation_id);
    expect('investigation_id' in model).toBe(false);
    expect(model.status).toBe(wire.status);
    expect(model.verdict_class).toBe(wire.verdict_class);
    expect(model.rounds_complete).toBe(wire.rounds_complete);
  });

  it('turns the bare array into a page without inventing a total', () => {
    const page = toInvestigationPage(list, { limit: 3, offset: 6 });
    expect(page.items).toHaveLength(list.length);
    expect(page.limit).toBe(3);
    expect(page.offset).toBe(6);
    expect(page.total.value).toBeNull(); // the API reports no total, so none is made up
    expect(page.total.reason).toMatch(/without a total/);
  });

  it('falls back to the row count when no limit or offset is given', () => {
    const page = toInvestigationPage(list, {});
    expect(page.limit).toBe(list.length);
    expect(page.offset).toBe(0);
  });
});

describe('groupRounds on a real debate', () => {
  const rounds = groupRounds(detailWire.debate, detailWire.credibility);

  it('groups the flat rows into the three rounds, in order', () => {
    expect(rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    for (const round of rounds) expect(round.agents).toHaveLength(3);
  });

  it('keeps each turn as the agent sent it', () => {
    const first = detailWire.debate.find((row) => row.round === 1 && row.agent_id === 'network_traffic');
    const turn = rounds[0].agents.find((agent) => agent.agent_id === 'network_traffic');
    expect(turn?.theory).toBe(first?.theory);
    expect(turn?.confidence).toBe(first?.confidence);
    expect(turn?.stance).toBe(first?.stance);
    expect(turn?.provider).toBe(first?.provider);
    expect(turn?.cited_evidence).toEqual(first?.cited_evidence);
  });

  it('attaches the credibility the Watchdog recorded after that exact turn', () => {
    for (const round of rounds) {
      for (const turn of round.agents) {
        const log = detailWire.credibility.find((c) => c.round === round.round && c.agent_id === turn.agent_id);
        expect(turn.credibility).toBe(log ? log.crs_after : null);
      }
    }
  });

  it('gives null credibility to a turn that was never scored', () => {
    const grouped = groupRounds(detailWire.debate, []);
    expect(grouped[0].agents.every((turn) => turn.credibility === null)).toBe(true);
  });
});

describe('toVotes', () => {
  it('maps the server vote class and takes confidence from that agent in that round', () => {
    const votes = toVotes(detailWire.votes, detailWire.debate);
    expect(votes).toHaveLength(detailWire.votes.length);
    for (const vote of votes) {
      const wire = detailWire.votes.find((v) => v.agent_id === vote.agent_id)!;
      const turn = detailWire.debate.find((row) => row.agent_id === wire.agent_id && row.round === wire.round)!;
      expect(vote.verdict_class).toBe(wire.vote_class);
      expect(vote.confidence).toBe(turn.confidence);
      expect(vote.matched_keywords).toEqual(wire.matched_keywords);
    }
  });

  it('turns "unclassified" into null so the UI never shows a made-up class', () => {
    const votes = toVotes(
      [{ agent_id: 'access_log', round: 3, vote_class: 'unclassified', class_source: 'keywords', matched_keywords: [], counted: true }],
      detailWire.debate,
    );
    expect(votes[0].verdict_class).toBeNull();
  });

  it('marks exactly the agents the Watchdog isolated as not counted, on the real drill payload', () => {
    const isolated = detailWire.credibility.filter((row) => row.isolated).map((row) => row.agent_id);
    expect(isolated.length).toBeGreaterThan(0); // the captured investigation is a hallucination drill
    for (const vote of toVotes(detailWire.votes, detailWire.debate)) {
      expect(vote.counted).toBe(!isolated.includes(vote.agent_id));
    }
  });

  it('keeps the server counted flag, so an isolated agent is shown but not counted', () => {
    const votes = toVotes(
      [
        { agent_id: 'access_log', round: 3, vote_class: 'ddos', class_source: 'keywords', matched_keywords: ['flood'], counted: false },
        { agent_id: 'network_traffic', round: 3, vote_class: 'ddos', class_source: 'stated', matched_keywords: [], counted: true },
      ],
      detailWire.debate,
    );
    expect(votes.map((vote) => vote.counted)).toEqual([false, true]);
    expect(votes.map((vote) => vote.class_source)).toEqual(['keywords', 'stated']); // where the class came from is kept
  });
});

describe('toInvestigationDetail on a real investigation', () => {
  const model = toInvestigationDetail(detailWire);

  it('keys the investigation by id and carries the verdict fields', () => {
    expect(model.id).toBe(detailWire.investigation_id);
    expect(model.status).toBe(detailWire.status);
    expect(model.verdict_class).toBe(detailWire.verdict_class);
    expect(model.verdict_confidence).toBe(detailWire.verdict_confidence);
    expect(model.primary_agent).toBe(detailWire.primary_agent);
  });

  it('never exposes a trigger reason (it can name the injected scenario)', () => {
    expect(model.trigger_reason).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(/scenario_label|ground_truth/);
  });

  it('adds the investigation id to every credibility row and action that lacks it', () => {
    expect(model.credibility.length).toBe(detailWire.credibility.length);
    expect(model.credibility.every((row) => row.investigation_id === detailWire.investigation_id)).toBe(true);
    expect(model.actions.length).toBe(detailWire.actions.length);
    expect(model.actions.every((action) => action.investigation_id === detailWire.investigation_id)).toBe(true);
  });

  it('carries how each agent\'s rows were chosen, as the engine recorded it', () => {
    const basis = { access_log: { basis: 'same_user_window' as const, row_count: 2 } };
    expect(toInvestigationDetail({ ...detailWire, input_basis: basis }).input_basis).toEqual(basis);
    expect(toInvestigationDetail({ ...detailWire, input_basis: {} }).input_basis).toEqual({});
  });

  it('keeps the citation summary as sent', () => {
    expect(model.citations).toEqual(detailWire.citations);
  });

  it('lists rounds and votes consistent with the verdict', () => {
    expect(model.rounds).toHaveLength(3);
    expect(model.votes.length).toBeGreaterThan(0);
  });
});

describe('toCitationPage', () => {
  it('wraps the bare array as a page and keeps every citation untouched', () => {
    const page = toCitationPage(citations, { limit: 3, offset: 0 });
    expect(page.items).toEqual(citations);
    expect(page.limit).toBe(3);
    expect(page.total.value).toBeNull();
  });
});
