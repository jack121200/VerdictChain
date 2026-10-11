import { describe, expect, it } from 'vitest';
import { buildRoute, parseRoute, type Route } from './router';

describe('parseRoute', () => {
  it('opens the dashboard for an empty hash', () => {
    expect(parseRoute('')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/')).toEqual({ name: 'dashboard' });
  });

  it('parses every top-level screen', () => {
    for (const name of ['login', 'dashboard', 'investigations', 'trust', 'fleet', 'audit', 'access', 'overview'] as const) {
      expect(parseRoute(`#/${name}`)).toEqual({ name });
    }
  });

  it('parses debate and investigation detail routes with a decoded id', () => {
    expect(parseRoute('#/debate/9f4d')).toEqual({ name: 'debate', id: '9f4d' });
    expect(parseRoute('#/investigations/abc%20d')).toEqual({ name: 'investigation', id: 'abc d' });
  });

  it('parses the printable documents of a case: the report and the chain of custody', () => {
    expect(parseRoute('#/report/9f4d')).toEqual({ name: 'report', id: '9f4d' });
    expect(parseRoute('#/custody/abc%20d')).toEqual({ name: 'custody', id: 'abc d' });
    expect(parseRoute('#/report')).toMatchObject({ name: 'not_found' }); // a document needs a case
    expect(parseRoute('#/custody/a/b')).toMatchObject({ name: 'not_found' });
  });

  it('parses the debate list route (no id, with or without a trailing slash)', () => {
    expect(parseRoute('#/debate')).toEqual({ name: 'debate' });
    expect(parseRoute('#/debate/')).toEqual({ name: 'debate' });
  });

  it('treats unknown, extra or malformed paths as not_found', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'not_found', path: 'nope' });
    expect(parseRoute('#/investigations/a/b')).toMatchObject({ name: 'not_found' });
    expect(parseRoute('#/debate/%E0%A4%A')).toMatchObject({ name: 'not_found' });
  });
});

describe('buildRoute', () => {
  it('encodes ids so a slash cannot change the route', () => {
    expect(buildRoute({ name: 'debate', id: 'a/b' })).toBe('#/debate/a%2Fb');
    expect(buildRoute({ name: 'investigation', id: 'x y' })).toBe('#/investigations/x%20y');
  });

  it('round-trips every routable screen through parseRoute', () => {
    const routes: Array<Exclude<Route, { name: 'not_found' }>> = [
      { name: 'login' },
      { name: 'dashboard' },
      { name: 'trust' },
      { name: 'overview' },
      { name: 'debate', id: 'id/with slash' },
      { name: 'investigation', id: '9f4d-0001' },
      { name: 'report', id: '9f4d-0001' },
      { name: 'custody', id: 'id/with slash' },
    ];
    for (const route of routes) {
      expect(parseRoute(buildRoute(route))).toEqual(route);
    }
  });
});
