/** The search box and the filter menu of the Investigations screen. */
import { FilterMenu } from '../../ui/FilterMenu';
import { Icon } from '../../ui/Icon';
import type { useInvestigations } from './useInvestigations';

type Props = Pick<ReturnType<typeof useInvestigations>, 'query' | 'changeFilter' | 'setQuery' | 'filterGroups' | 'clearFilters' | 'items' | 'list'>;

export function SearchBar({ query, changeFilter, setQuery, filterGroups, clearFilters, items, list }: Props) {
  return (
    <>
        {/* Search and filters */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-3 backdrop-blur-md">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
              <Icon name="travel_explore" size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => changeFilter(() => setQuery(event.target.value))}
              placeholder="Search by case id, verdict class or trigger type…"
              aria-label="Search investigations"
              className="w-full rounded-lg border border-outline-variant/50 bg-background py-2 pl-9 pr-9 font-mono text-xs text-on-surface placeholder:text-outline focus:border-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => changeFilter(() => setQuery(''))}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          <FilterMenu
            groups={filterGroups}
            onClear={clearFilters}
            proof={{
              source: 'GET /investigations?status=&verdict_class=&primary_agent=',
              n: items.length,
              asOf: list.loadedAt,
              definition:
                'Each choice becomes a query parameter, so the server filters the list and the page is fetched again. Nothing is filtered in the browser. The dataset a case reads follows from its primary agent, so the agent choice also selects the dataset.',
            }}
          />
        </div>
    </>
  );
}
