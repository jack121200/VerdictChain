import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { describeError, listInvestigations } from '../api/client';
import type { InvestigationSummary } from '../api/types';
import { buildRoute } from '../app/router';
import { cn } from '../lib/cn';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icon-names';
import { Modal } from '../ui/Modal';
import { Timestamp } from '../ui/Timestamp';
import { STATUS_LABEL, VERDICT_LABEL } from '../features/investigations/labels';
import { NAV_ITEMS } from './nav';
import { useScenarioModal } from './scenario-modal';

/** Typing pauses this long before the server is asked, so a word is one request, not one per key. */
const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 8;

type Group = 'Pages' | 'Actions' | 'Investigations';

interface PaletteItem {
  id: string;
  group: Group;
  label: string;
  detail?: string;
  /** When the investigation was created, for the relative time on its row. */
  when?: string;
  icon: IconName;
  /** alt is true for Shift+Enter or a Shift-click. */
  run: (alt: boolean) => void;
}

interface SearchState {
  items: InvestigationSummary[];
  loading: boolean;
  error: string | null;
}

const INJECT_KEYWORDS = 'inject a scenario run simulate';

function summaryDetail(item: InvestigationSummary): string {
  const outcome = item.verdict_class === null ? STATUS_LABEL[item.status] : VERDICT_LABEL[item.verdict_class];
  return item.dataset ? `${outcome} · ${item.dataset}` : outcome;
}

function go(hash: string): void {
  window.location.hash = hash;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const scenario = useScenarioModal();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState>({ items: [], loading: true, error: null });
  const listId = useId();
  const needle = query.trim().toLowerCase();

  // The server is asked once typing pauses. An empty box asks for the newest investigations instead.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), query.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setSearch((current) => ({ ...current, loading: true, error: null }));
    listInvestigations({ limit: RESULT_LIMIT, q: term === '' ? undefined : term }).then(
      (page) => {
        if (!cancelled) setSearch({ items: page.items, loading: false, error: null });
      },
      (failure: unknown) => {
        if (!cancelled) setSearch({ items: [], loading: false, error: describeError(failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [term]);

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = NAV_ITEMS.filter(
      (page) => needle === '' || page.label.toLowerCase().includes(needle) || page.key.includes(needle),
    ).map((page) => ({
      id: `page-${page.key}`,
      group: 'Pages',
      label: page.label,
      icon: page.icon,
      run: () => go(buildRoute({ name: page.key })),
    }));
    const actions: PaletteItem[] =
      scenario !== null && scenario.canInject !== false && (needle === '' || INJECT_KEYWORDS.includes(needle))
        ? [{ id: 'action-inject', group: 'Actions', label: 'Inject a scenario', detail: 'Opens the scenario dialog', icon: 'play_circle', run: () => scenario.open() }]
        : [];
    const found: PaletteItem[] = search.items.map((item) => ({
      id: `investigation-${item.id}`,
      group: 'Investigations',
      label: item.id,
      detail: summaryDetail(item),
      when: item.created_at,
      icon: item.verdict_class === null ? 'forum' : 'gavel',
      run: (alt) => go(buildRoute(alt ? { name: 'debate', id: item.id } : { name: 'investigation', id: item.id })),
    }));
    return [...pages, ...actions, ...found];
  }, [needle, scenario, search.items]);

  // A new list starts at its first row. Keyed by the ids, not the array, so a background refresh that returns the
  // same rows does not throw away the row the analyst is pointing at.
  const listKey = items.map((item) => item.id).join('|');
  useEffect(() => setActive(0), [needle, listKey]);
  const current = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
    // optionId only depends on listId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function choose(item: PaletteItem, alt: boolean) {
    onClose();
    item.run(alt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault();
      setActive((current + 1) % items.length);
    } else if (event.key === 'ArrowUp' && items.length > 0) {
      event.preventDefault();
      setActive((current - 1 + items.length) % items.length);
    } else if (event.key === 'Enter' && current >= 0) {
      event.preventDefault();
      choose(items[current], event.shiftKey);
    }
  }

  const groups = (['Pages', 'Actions', 'Investigations'] as const)
    .map((group) => ({ group, entries: items.map((item, index) => ({ item, index })).filter((entry) => entry.item.group === group) }))
    .filter((entry) => entry.entries.length > 0);

  const status = search.error
    ? `Could not search investigations: ${search.error}`
    : search.loading && search.items.length === 0
      ? 'Searching investigations…'
      : !search.loading && search.items.length === 0
        ? term === ''
          ? 'No investigations yet.'
          : `No investigation matches "${term}".`
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-outline-variant/40 px-4 py-3">
        <Icon name="search" size={20} className="shrink-0 text-on-surface-variant" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search pages and investigations"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to a page, or search by case id, verdict class or trigger type…"
          className="min-w-0 flex-1 bg-transparent text-body text-on-surface placeholder:text-outline focus:outline-none"
        />
      </div>

      <div id={listId} role="listbox" aria-label="Results" className="max-h-80 min-h-0 space-y-2 overflow-y-auto p-2">
        {groups.map(({ group, entries }) => (
          <div key={group} role="group" aria-labelledby={`${listId}-group-${group}`}>
            <p id={`${listId}-group-${group}`} className="px-2 py-1 text-label uppercase text-on-surface-variant">
              {group === 'Investigations' ? (term === '' ? 'Recent investigations' : `Investigations matching "${term}"`) : group}
            </p>
            {entries.map(({ item, index }) => (
              <div
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                onMouseMove={() => setActive(index)}
                onClick={(event) => choose(item, event.shiftKey)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2',
                  index === current ? 'bg-primary/10 text-primary' : 'text-on-surface',
                )}
              >
                <Icon name={item.icon} size={16} className="shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                  <span className={cn('break-all text-body', group === 'Investigations' && 'font-mono text-evidence')}>{item.label}</span>
                  {item.detail && <span className="text-caption text-on-surface-variant">{item.detail}</span>}
                </span>
                {item.when && <Timestamp iso={item.when} className="hidden shrink-0 font-mono text-evidence text-on-surface-variant sm:inline" />}
              </div>
            ))}
          </div>
        ))}
        {items.length === 0 && status === null && <p className="px-2 py-3 text-caption text-on-surface-variant">Nothing matches.</p>}
        {status !== null && (
          <p role="status" className={cn('px-2 py-2 text-caption', search.error ? 'text-error' : 'text-on-surface-variant')}>
            {status}
          </p>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-outline-variant/40 px-4 py-2 text-caption text-on-surface-variant">
        <span>↑↓ move</span>
        <span>↵ open page or dossier</span>
        <span>⇧↵ open the debate room</span>
        <span>esc close</span>
      </p>
    </div>
  );
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Ctrl or Cmd + K. Jumps to any page, opens the scenario dialog, and searches investigations through
 * GET /investigations?q= (the server matches the start of the case id, the verdict class and the trigger type).
 * Arrow keys move, Enter opens the dossier, Shift+Enter opens the debate room, Escape closes.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  return (
    <Modal open={open} onClose={onClose} variant="palette" title="Command palette">
      <PaletteBody onClose={onClose} />
    </Modal>
  );
}
