import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Props every routed page receives. id comes from the route for debate and investigation pages. */
export interface PageProps {
  id?: string;
}

/** Routed pages, lazy-loaded so each screen is its own chunk. Login is imported directly by the app. */
export type PageKey =
  | 'dashboard'
  | 'debate'
  | 'investigations'
  | 'investigation'
  | 'trust'
  | 'fleet'
  | 'audit'
  | 'access'
  | 'overview'
  | 'live'
  | 'report'
  | 'custody';

export const PAGES: Record<PageKey, LazyExoticComponent<ComponentType<PageProps>>> = {
  dashboard: lazy(() => import('./dashboard')),
  debate: lazy(() => import('./debate')),
  investigations: lazy(() => import('./investigations')),
  investigation: lazy(() => import('./investigations')),
  trust: lazy(() => import('./trust')),
  fleet: lazy(() => import('./fleet')),
  audit: lazy(() => import('./audit')),
  access: lazy(() => import('./access')),
  overview: lazy(() => import('./overview')),
  live: lazy(() => import('./live')),
  report: lazy(() => import('./report')),
  custody: lazy(() => import('./custody')),
};

/** The scenario injection modal (plan 2.11). Opened from the dashboard, not routed. */
export const SCENARIO = lazy(() => import('./scenario'));
