import type { SimpleRouteName } from '../app/router';
import type { IconName } from '../ui/icon-names';

/** The top-level navigation targets. 'login' is never a nav target. */
export type NavKey = Exclude<SimpleRouteName, 'login'>;

/** Primary navigation, rendered in the left sidebar. One icon + label per screen. */
export const NAV_ITEMS: ReadonlyArray<{ key: NavKey; label: string; icon: IconName }> = [
  { key: 'overview', label: 'Overview', icon: 'menu_book' },
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'investigations', label: 'Investigations', icon: 'travel_explore' },
  { key: 'trust', label: 'Trust & credibility', icon: 'verified_user' },
  { key: 'fleet', label: 'Agent fleet', icon: 'hub' },
  { key: 'audit', label: 'Audit trail', icon: 'receipt_long' },
  { key: 'access', label: 'Access & system', icon: 'admin_panel_settings' },
];
