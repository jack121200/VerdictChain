import type { PageProps } from '../index';
import { Dossier } from './Dossier';
import { useInvestigations } from './useInvestigations';
import { CaseList } from './CaseList';
import { OperationsBoard } from './OperationsBoard';
import { SearchBar } from './SearchBar';
import { Header } from './Header';

/** Investigations: the operations board, then a filterable list on the left and a live dossier inspector on the right (plan 2.6). */
export default function InvestigationsPage({ id }: PageProps) {
  const { scenario, selectedId, query, changeFilter, setQuery, filterGroups, clearFilters, items, list, narrowed, activeSummary, offset, clearAll, setSelectedId, agentName, canPrev, canNext, setOffset, dossier, setReloadKey, settings } = useInvestigations(id);

  return (
    <div className="relative flex min-h-screen w-full flex-col text-on-surface">
      <section className="relative mx-auto w-full max-w-7xl px-4 pb-6 pt-6 lg:px-6">
        <Header scenario={scenario} selectedId={selectedId} />

        {/* What the automation did and what is running side by side right now */}
        <OperationsBoard rounds={settings?.debate_rounds ?? null} />

        <SearchBar query={query} changeFilter={changeFilter} setQuery={setQuery} filterGroups={filterGroups} clearFilters={clearFilters} items={items} list={list} />

        {/* Content: left master list / right detail dossier */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <CaseList items={items} narrowed={narrowed} activeSummary={activeSummary} list={list} offset={offset} clearAll={clearAll} selectedId={selectedId} setSelectedId={setSelectedId} agentName={agentName} canPrev={canPrev} canNext={canNext} setOffset={setOffset} settings={settings} />
          {/* Right: dossier */}
          <div className="min-w-0 lg:col-span-5">
            <Dossier dossier={dossier} onChanged={() => setReloadKey((value) => value + 1)} settings={settings} agentName={agentName} />
          </div>
        </div>
      </section>
    </div>
  );
}
