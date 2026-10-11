/**
 * Everything a printed document needs about one case, read once when the page opens (a document is a snapshot, so
 * nothing polls). The investigation itself is required; every other part may fail on its own and the section that
 * needs it says why it is missing instead of being left out silently.
 */
import { useEffect, useState } from 'react';
import {
  describeError,
  getAgentFleet,
  getCaseAuditChain,
  getEvidenceBundle,
  getInvestigation,
  getInvestigationCitations,
  getMe,
  getSettings,
  listAuditTrail,
} from '../../api/client';
import type {
  AuditTrailResponse,
  CaseAuditChain,
  EvidenceBundleResponse,
  FleetEntry,
  InvestigationCitations,
  InvestigationDetail,
  Me,
  Settings,
} from '../../api/types';

export interface CaseDocument {
  status: 'loading' | 'ready' | 'failed';
  /** Why the investigation could not be read (status failed). */
  error: string | null;
  detail?: InvestigationDetail;
  bundle?: EvidenceBundleResponse;
  citations?: InvestigationCitations;
  audit?: AuditTrailResponse;
  chain?: CaseAuditChain;
  settings?: Settings;
  fleet?: FleetEntry[];
  me?: Me;
  /** The reason each missing part could not be read, by part name. */
  missing: Record<string, string>;
  /** ISO time the document was assembled. */
  generatedAt: string | null;
}

const LOADING: CaseDocument = { status: 'loading', error: null, missing: {}, generatedAt: null };

export function useCaseDocument(id: string): CaseDocument {
  const [state, setState] = useState<CaseDocument>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);
    void Promise.allSettled([
      getInvestigation(id),
      getEvidenceBundle(id),
      getInvestigationCitations(id),
      listAuditTrail({ investigation_id: id, limit: 200 }),
      getCaseAuditChain(id),
      getSettings(),
      getAgentFleet(),
      getMe(),
    ]).then(([detail, bundle, citations, audit, chain, settings, fleet, me]) => {
      if (cancelled) return;
      if (detail.status === 'rejected') {
        setState({ status: 'failed', error: describeError(detail.reason), missing: {}, generatedAt: null });
        return;
      }
      const missing: Record<string, string> = {};
      const value = <T,>(name: string, result: PromiseSettledResult<T>): T | undefined => {
        if (result.status === 'fulfilled') return result.value;
        missing[name] = describeError(result.reason);
        return undefined;
      };
      setState({
        status: 'ready',
        error: null,
        detail: detail.value,
        bundle: value('evidence bundle', bundle),
        citations: value('citations', citations),
        audit: value('audit entries', audit),
        chain: value('case audit chain', chain),
        settings: value('settings', settings),
        fleet: value('agent fleet', fleet),
        me: value('analyst', me),
        missing,
        generatedAt: new Date().toISOString(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}
