import { useId, useState, type FormEvent } from 'react';
import { describeError, login, register, setToken } from '../../api/client';
import { FOCUS_RING } from '../../ui/classes';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH, validateCredentials } from './validate';

export interface LoginPageProps {
  /** Called after the token is stored. The app then routes to the dashboard. */
  onSignedIn: () => void;
}

type Mode = 'login' | 'register';

const FEATURES = [
  'Three investigator agents',
  'Three-round debate',
  'Watchdog credibility scoring',
  'Citations checked against raw logs',
  'Simulated containment only',
  'Hash-chained audit trail',
] as const;

/** Decorative node graph. Carries no values; colours come from the token classes. */
const GRAPH_NODES: ReadonlyArray<readonly [number, number]> = [
  [120, 180], [320, 120], [480, 260], [200, 380], [400, 480],
  [560, 160], [80, 500], [300, 560], [540, 420], [160, 320],
];

const GRAPH_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 4], [3, 1], [3, 4], [5, 2], [6, 3], [7, 4], [8, 2], [9, 0], [9, 3], [8, 7],
];

function DecorGraph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 640 640" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full opacity-40">
      {GRAPH_EDGES.map(([from, to]) => {
        const [x1, y1] = GRAPH_NODES[from];
        const [x2, y2] = GRAPH_NODES[to];
        return <line key={`${from}-${to}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={0.8} className="stroke-primary/40" />;
      })}
      {GRAPH_NODES.map(([cx, cy], index) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index % 3 === 0 ? 5 : 3} className="fill-primary/60" />
      ))}
    </svg>
  );
}

const INPUT_CLASS = `w-full rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 text-body text-on-surface placeholder:text-outline focus:border-primary focus:outline-none ${FOCUS_RING}`;

/** Sign-in and account creation. Both call the real API and store the returned token. */
export default function LoginPage({ onSignedIn }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameId = useId();
  const passwordId = useId();
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateCredentials(username, password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = mode === 'login' ? await login(username, password) : await register(username, password);
      setToken(token.access_token);
      onSignedIn();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  const submitProof = {
    source: mode === 'login' ? 'POST /auth/login' : 'POST /auth/register',
    n: 1,
    asOf: null,
    definition: 'Sends the username and password to the API and stores the returned token in this browser. Nothing else is sent.',
  };

  return (
    <div className="flex min-h-screen bg-background text-on-surface">
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-outline-variant/40 bg-surface-container-low p-12 lg:flex">
        <img src="/assets/holographic-soc.jpg" alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20" />
        <DecorGraph />
        <div className="relative z-10 flex items-center gap-3">
          <img src="/assets/logo-emblem.png" alt="VerdictChain logo" className="h-10 w-10 rounded-lg border border-primary-container/40 bg-surface-card p-1.5" />
          <div className="flex flex-col leading-none">
            <span className="font-headline text-lg font-bold uppercase tracking-tight text-primary">
              Verdict<span className="text-on-surface">Chain</span>
            </span>
            <span className="mt-1 text-label uppercase text-on-surface-variant">Multi-agent forensic console</span>
          </div>
        </div>
        <div className="relative z-10 flex flex-col gap-6">
          <h1 className="font-headline text-h1-sm font-bold text-on-surface">
            Multi-agent debate and credibility checks for insider and network threat forensics
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            Three investigator agents debate the log evidence in three rounds. A Watchdog checks every cited row against the raw logs and scores each agent&apos;s
            credibility. Containment is simulated, and every action is written to the audit trail.
          </p>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((feature) => (
              <Pill key={feature} tone="primary">
                {feature}
              </Pill>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-caption text-on-surface-variant">Protected system. Authorized personnel only.</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-12 lg:px-8">
        <div className="w-full max-w-sm">
          <h2 className="font-headline text-h2 text-on-surface">{mode === 'login' ? 'Sign in' : 'Create an analyst account'}</h2>
          <p className="mt-1 text-body text-on-surface-variant">
            {mode === 'login' ? 'Sign in to the forensic console.' : 'New accounts start as forensic analysts.'}
          </p>

          <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={usernameId} className="text-label uppercase text-on-surface-variant">
                Username
              </label>
              <input
                id={usernameId}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="username"
                className={INPUT_CLASS}
              />
              <span className="text-caption text-on-surface-variant">At least {MIN_USERNAME_LENGTH} characters.</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={passwordId} className="text-label uppercase text-on-surface-variant">
                  Password
                </label>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((shown) => !shown)}
                    className={`cursor-pointer rounded px-1 text-caption text-primary hover:underline ${FOCUS_RING}`}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                  <Proof
                    source="browser only"
                    n={1}
                    asOf={null}
                    label="Show password"
                    definition="Changes the password field between hidden and visible text. Nothing is sent to the server."
                  />
                </span>
              </div>
              <input
                id={passwordId}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={INPUT_CLASS}
              />
              <span className="text-caption text-on-surface-variant">At least {MIN_PASSWORD_LENGTH} characters.</span>
            </div>

            {error !== null && (
              <p id={errorId} role="alert" className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/30 px-3 py-2 text-caption text-error">
                <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" busy={busy} className="flex-1">
                {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
              <Proof {...submitProof} label={mode === 'login' ? 'Sign in' : 'Create account'} />
            </div>
          </form>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setMode((current) => (current === 'login' ? 'register' : 'login'));
                setError(null);
              }}
            >
              {mode === 'login' ? 'New analyst? Create an account' : 'Already have an account? Sign in'}
            </Button>
            <Proof
              source={mode === 'login' ? 'POST /auth/register (switch to create)' : 'POST /auth/login (switch to sign in)'}
              n={1}
              asOf={null}
              label="Switch sign-in mode"
              definition="Switches this form between sign-in (POST /auth/login) and account creation (POST /auth/register). Registration never accepts a role. Roles are set by a secops lead."
            />
          </div>
        </div>
      </main>
    </div>
  );
}
