/** Everything the Investigations screen loads and keeps: the filtered, paged case list and the dossier of the selected case. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAgentFleet, getEvidenceBundle, getInvestigation, getInvestigationCitations, getSettings, listAuditTrail, listInvestigations } from '../../api/client';
import type { FleetEntry, InvestigationListParams, InvestigationStatus, InvestigatorId, VerdictClass } from '../../api/types';
import { useAsync } from '../../app/use-async';
import { usePageData } from '../../app/use-page-data';
import { AGENT_VISUALS } from '../../lib/agents';
import { useScenarioModal } from '../../shell/scenario-modal';
import { type FilterGroup } from '../../ui/FilterMenu';
import { type DossierData } from './Dossier';
import { STATUS_LABEL, VERDICT_LABEL } from './labels';
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS, STATUS_OPTIONS, VERDICT_OPTIONS, settled } from './shared';

export function useInvestigations(id: string | undefined) {
  const scenario = useScenarioModal();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvestigationStatus | 'ALL'>('ALL');
  const [verdictFilter, setVerdictFilter] = useState<VerdictClass | 'ALL'>('ALL');
  const [agentFilter, setAgentFilter] = useState<InvestigatorId | 'ALL'>('ALL');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [dossier, setDossier] = useState<DossierData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // A deep link (#/investigations/<id>) pre-selects that case.
  useEffect(() => {
    if (id) setSelectedId(id);
  }, [id]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const fleet = useAsync(getAgentFleet, undefined, ['agents', 'credibility']);
  // The debate length and the containment floors: the pipeline strips and the Self-Healing gate read them.
  const settings = useAsync(getSettings, undefined, ['settings']);

  const params = useMemo<InvestigationListParams>(
    () => ({
      limit: PAGE_SIZE,
      offset,
      q: debouncedQuery === '' ? undefined : debouncedQuery,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      verdict_class: verdictFilter === 'ALL' ? undefined : verdictFilter,
      primary_agent: agentFilter === 'ALL' ? undefined : agentFilter,
    }),
    [offset, debouncedQuery, statusFilter, verdictFilter, agentFilter],
  );

  const list = usePageData(() => listInvestigations(params), undefined, ['investigations']);
  const { reload: reloadList } = list;

  // Refetch the list when the filters or page change (useAsync itself only loads on mount).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reloadList();
  }, [params, reloadList]);

  const agentName = useCallback(
    (agentId: string): string => {
      const match = fleet.data?.find((entry: FleetEntry) => entry.agent_id === agentId);
      return match?.display_name ?? agentId;
    },
    [fleet.data],
  );

  const items = list.data?.items ?? [];
  const summaryFor = useCallback((caseId: string) => items.find((item) => item.id === caseId), [items]);

  // Load the four dossier requests whenever the selection (or a feedback action) changes.
  useEffect(() => {
    const target = selectedId;
    if (target === null) {
      setDossier(null);
      return;
    }
    let cancelled = false;
    setDossier({ id: target, summary: summaryFor(target), detail: {}, bundle: {}, citations: {}, audit: {}, loadedAt: null });
    Promise.allSettled([
      getInvestigation(target),
      getEvidenceBundle(target),
      getInvestigationCitations(target),
      listAuditTrail({ investigation_id: target, limit: 100 }),
    ]).then((results) => {
      if (cancelled) return;
      const [detail, bundle, citations, audit] = results;
      setDossier({
        id: target,
        summary: summaryFor(target),
        detail: settled(detail),
        bundle: settled(bundle),
        citations: settled(citations),
        audit: settled(audit),
        loadedAt: new Date().toISOString(),
      });
    });
    return () => {
      cancelled = true;
    };
    // summaryFor is intentionally excluded: it changes with every list reload and must not refetch the dossier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, reloadKey]);

  function changeFilter(apply: () => void) {
    setOffset(0);
    apply();
  }

  function clearFilters() {
    changeFilter(() => {
      setStatusFilter('ALL');
      setVerdictFilter('ALL');
      setAgentFilter('ALL');
    });
  }

  function clearAll() {
    changeFilter(() => {
      setStatusFilter('ALL');
      setVerdictFilter('ALL');
      setAgentFilter('ALL');
      setQuery('');
    });
  }

  const selectedAgent = fleet.data?.find((entry) => entry.agent_id === agentFilter);
  const agentOptions = [
    { value: 'ALL', label: 'All primary agents' },
    ...(fleet.data ?? []).map((entry) => ({ value: entry.agent_id, label: `${AGENT_VISUALS[entry.agent_id].glyph} ${entry.display_name}` })),
  ];
  const filterGroups: FilterGroup[] = [
    {
      id: 'status',
      label: 'Status',
      value: statusFilter,
      options: STATUS_OPTIONS,
      onChange: (value) => changeFilter(() => setStatusFilter(value as InvestigationStatus | 'ALL')),
    },
    {
      id: 'verdict',
      label: 'Verdict class',
      value: verdictFilter,
      options: VERDICT_OPTIONS,
      onChange: (value) => changeFilter(() => setVerdictFilter(value as VerdictClass | 'ALL')),
    },
    ...(agentOptions.length > 1
      ? [
          {
            id: 'agent',
            label: 'Primary agent',
            value: agentFilter,
            options: agentOptions,
            onChange: (value: string) => changeFilter(() => setAgentFilter(value as InvestigatorId | 'ALL')),
            // The dataset an investigation reads follows from its primary agent, so the agent's own domain is the dataset hint.
            hint: selectedAgent ? `Reads: ${selectedAgent.domain}` : null,
          },
        ]
      : []),
  ];

  const activeSummary = [
    statusFilter !== 'ALL' ? `status ${STATUS_LABEL[statusFilter]}` : null,
    verdictFilter !== 'ALL' ? `verdict class ${VERDICT_LABEL[verdictFilter]}` : null,
    agentFilter !== 'ALL' ? `primary agent ${agentName(agentFilter)}` : null,
    debouncedQuery !== '' ? `search “${debouncedQuery}”` : null,
  ].filter((part): part is string => part !== null);
  const narrowed = activeSummary.length > 0;

  const canPrev = offset > 0;
  // The list endpoint reports no total, so a full page is the only sign that more may follow.
  const canNext = items.length >= PAGE_SIZE;

  return { scenario, selectedId, query, changeFilter, setQuery, filterGroups, clearFilters, items, list, narrowed, activeSummary, offset, clearAll, setSelectedId, agentName, canPrev, canNext, setOffset, dossier, setReloadKey, settings: settings.data };
}
