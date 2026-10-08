import { Suspense, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { clearToken, getToken, setUnauthorizedHandler } from '../api/client';
import LoginPage from '../features/login';
import { PAGES } from '../features';
import { PageSkeleton } from './PageSkeleton';
import { buildRoute, parseRoute, type Route } from './router';
import { Footer } from '../shell/Footer';
import { ShellDataProvider } from '../shell/shell-data';
import { TopNav } from '../shell/TopNav';
import { Sidebar } from '../shell/Sidebar';
import type { NavKey } from '../shell/nav';
import { Toaster } from '../ui/Toaster';
import { pushToast } from '../ui/toast-store';
import { EmptyState } from '../ui/EmptyState';

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentHash(): string {
  return window.location.hash;
}

/** The route for the current URL fragment. Re-renders on every hashchange. */
function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, currentHash, currentHash);
  return parseRoute(hash);
}

function navigate(route: Exclude<Route, { name: 'not_found' }>): void {
  window.location.hash = buildRoute(route);
}

/** The top-level nav item a route belongs to. Debate rooms sit under the dashboard, investigation detail under investigations. */
function navKeyFor(route: Route): NavKey | null {
  switch (route.name) {
    case 'login':
    case 'not_found':
      return null;
    case 'debate':
      return 'debate';
    case 'investigation':
      return 'investigations';
    default:
      return route.name;
  }
}

function renderPage(route: Route): ReactNode {
  switch (route.name) {
    case 'login':
      return null;
    case 'not_found':
      return (
        <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
          <EmptyState
            title="Page not found"
            description={`No screen matches "${route.path}".`}
            action={
              <a href={buildRoute({ name: 'dashboard' })} className="text-body text-primary underline">
                Go to the dashboard
              </a>
            }
          />
        </div>
      );
    case 'debate':
    case 'investigation': {
      const Page = PAGES[route.name];
      return <Page id={route.id} />;
    }
    default: {
      const Page = PAGES[route.name];
      return <Page />;
    }
  }
}

/** Routes to sign-in, clears the stored token and tells the user why. */
function toLogin(message: string): void {
  clearToken();
  navigate({ name: 'login' });
  pushToast(message, { tone: 'tertiary', durationMs: 6000 });
}

export default function App() {
  const route = useRoute();
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [route.name]);

  const signOut = useCallback(() => {
    clearToken();
    setAuthed(false);
    navigate({ name: 'login' });
  }, []);

  useEffect(() => {
    // A 401 from any call has already cleared the token. Drop the session and return to sign-in.
    setUnauthorizedHandler(() => {
      setAuthed(false);
      toLogin('Your session has expired. Sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Unauthenticated visitors always land on sign-in. A signed-in visitor on sign-in goes to the dashboard.
  useEffect(() => {
    if (!authed && route.name !== 'login') navigate({ name: 'login' });
    if (authed && route.name === 'login') navigate({ name: 'dashboard' });
  }, [authed, route.name]);

  // The toaster sits outside both branches so a session-expired notice shows on the sign-in screen too.
  if (!authed || route.name === 'login') {
    return (
      <>
        <LoginPage
          onSignedIn={() => {
            setAuthed(true);
            navigate({ name: 'dashboard' });
          }}
        />
        <Toaster />
      </>
    );
  }

  return (
    <ShellDataProvider>
      <div className="min-h-screen bg-background text-on-surface">
        <Sidebar active={navKeyFor(route)} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <div className="flex min-h-screen flex-col lg:pl-60">
          <TopNav onMenuToggle={() => setMenuOpen((open) => !open)} onSignOut={signOut} />
          <main className="flex flex-1 flex-col">
            <Suspense fallback={<PageSkeleton />}>{renderPage(route)}</Suspense>
          </main>
          <Footer />
        </div>
      </div>
      <Toaster />
    </ShellDataProvider>
  );
}
