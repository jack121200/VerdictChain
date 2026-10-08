import { buildRoute } from '../app/router';
import { cn } from '../lib/cn';
import { Icon } from '../ui/Icon';
import { NAV_ITEMS, type NavKey } from './nav';

export interface SidebarProps {
  active: NavKey | null;
  /** Mobile drawer open state. Ignored at lg and up, where the sidebar is always shown. */
  open: boolean;
  onNavigate: () => void;
}

/**
 * Left navigation rail: brand, then one row per screen. Always visible at lg+;
 * a slide-in drawer below that, toggled from the top bar. No values here, only links.
 */
export function Sidebar({ active, open, onNavigate }: SidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onNavigate}
          className="fixed inset-0 z-40 bg-surface-container-lowest/70 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-outline-variant/40 bg-surface-container-lowest shadow-panel transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <a
          href={buildRoute({ name: 'dashboard' })}
          onClick={onNavigate}
          className="flex h-16 shrink-0 items-center gap-2.5 border-b border-outline-variant/40 px-4 lg:h-20"
        >
          <img
            src="/assets/logo-emblem.png"
            alt="VerdictChain logo"
            className="h-9 w-9 rounded-lg border border-primary-container/40 bg-surface-card p-1 shadow-glow-cyan"
          />
          <span className="flex flex-col leading-none">
            <span className="font-headline text-lg font-bold uppercase tracking-tight text-primary">
              Verdict<span className="text-on-surface">Chain</span>
            </span>
            <span className="mt-1 text-label uppercase tracking-wider text-on-surface-variant">
              Multi-agent console
            </span>
          </span>
        </a>

        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const selected = active === item.key;
            return (
              <a
                key={item.key}
                href={buildRoute({ name: item.key })}
                aria-current={selected ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-label font-semibold uppercase tracking-wider transition-all',
                  selected
                    ? 'bg-primary-container text-on-primary shadow-glow-cyan'
                    : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface',
                )}
              >
                {selected && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                )}
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-outline-variant/40 px-4 py-3">
          <span className="flex items-center gap-2 font-mono text-evidence uppercase text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden="true" />
            Sandboxed forensic console
          </span>
        </div>
      </aside>
    </>
  );
}
