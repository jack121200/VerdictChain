/**
 * Hash routes (plan section 4). Refresh-safe: the route is the URL fragment, so no server
 * rewrite is needed and a reload lands on the same screen.
 */

export type SimpleRouteName =
  | 'landing'
  | 'login'
  | 'dashboard'
  | 'investigations'
  | 'trust'
  | 'fleet'
  | 'audit'
  | 'access'
  | 'overview'
  | 'live';

export type Route =
  | { name: SimpleRouteName }
  | { name: 'debate'; id?: string }
  | { name: 'investigation'; id: string }
  /** The printable case report and chain-of-custody documents (outside the console shell). */
  | { name: 'report'; id: string }
  | { name: 'custody'; id: string }
  | { name: 'not_found'; path: string };

const SIMPLE_ROUTES: ReadonlySet<string> = new Set<SimpleRouteName>([
  'landing',
  'login',
  'dashboard',
  'investigations',
  'trust',
  'fleet',
  'audit',
  'access',
  'overview',
  'live',
]);

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded === '' ? null : decoded;
  } catch {
    return null;
  }
}

/** Parses a location hash ("#/debate/9f4d") into a route. Unknown or malformed paths are not_found. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+|\/+$/g, '');
  if (path === '') return { name: 'dashboard' };
  const segments = path.split('/');
  const [head, ...rest] = segments;

  if (rest.length === 0 && SIMPLE_ROUTES.has(head)) {
    return { name: head as SimpleRouteName };
  }
  if (rest.length === 0 && head === 'debate') {
    return { name: 'debate' };
  }
  if (rest.length === 1 && (head === 'debate' || head === 'investigations' || head === 'report' || head === 'custody')) {
    const id = decodeSegment(rest[0]);
    if (id === null) return { name: 'not_found', path };
    if (head === 'debate') return { name: 'debate', id };
    if (head === 'investigations') return { name: 'investigation', id };
    return { name: head, id };
  }
  return { name: 'not_found', path };
}

/** Builds the hash for a route. Ids are encoded, so parseRoute(buildRoute(r)) returns r. */
export function buildRoute(route: Exclude<Route, { name: 'not_found' }>): string {
  switch (route.name) {
    case 'debate':
      return route.id ? `#/debate/${encodeURIComponent(route.id)}` : '#/debate';
    case 'investigation':
      return `#/investigations/${encodeURIComponent(route.id)}`;
    case 'report':
    case 'custody':
      return `#/${route.name}/${encodeURIComponent(route.id)}`;
    default:
      return `#/${route.name}`;
  }
}
