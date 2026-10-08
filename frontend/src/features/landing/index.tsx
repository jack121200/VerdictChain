import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icon-names';

export interface LandingProps {
  /** Opens the sign-in screen. */
  onEnter: () => void;
}

const PILLARS: ReadonlyArray<{ icon: IconName; phase: string; title: string; body: string; tone: string }> = [
  {
    icon: 'database',
    phase: 'Phase 01',
    title: 'Multi-source ingestion',
    body: 'Raw network flows (CICIDS2017) and insider telemetry (CERT r4.2 logon, device and file logs) are normalised into one evidence table that every agent cites against.',
    tone: 'text-primary',
  },
  {
    icon: 'forum',
    phase: 'Phase 02',
    title: 'Three-round debate',
    body: 'Three specialist agents — Network-Traffic, Access-Log and Endpoint-Behavior — state a theory, challenge each other, and finalise their positions over three rounds. No agent is told the scenario.',
    tone: 'text-tertiary',
  },
  {
    icon: 'policy',
    phase: 'Phase 03',
    title: 'Watchdog verification',
    body: 'Every cited row is looked up directly in the raw logs. Fabricated or mismatched evidence lowers that agent’s credibility score. This is a deterministic database check, not another model.',
    tone: 'text-secondary',
  },
  {
    icon: 'lock_reset',
    phase: 'Phase 04',
    title: 'Sandboxed response',
    body: 'A confident verdict triggers simulated containment (account lock, IP block, audit) inside a sandbox with no real-system reach. Every step is written to a tamper-evident SHA-256 audit chain.',
    tone: 'text-primary',
  },
];

const CAPABILITIES: ReadonlyArray<{ icon: IconName; label: string }> = [
  { icon: 'smart_toy', label: 'Three investigator agents' },
  { icon: 'forum', label: 'Three-round dialectical debate' },
  { icon: 'policy', label: 'Watchdog credibility scoring' },
  { icon: 'fact_check', label: 'Citations checked against raw logs' },
  { icon: 'lock_reset', label: 'Simulated containment only' },
  { icon: 'receipt_long', label: 'Hash-chained audit trail' },
];

/** Public marketing landing shown before sign-in. Full-viewport hero, honest copy, no live numbers. */
export default function LandingPage({ onEnter }: LandingProps) {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-outline-variant/30 bg-surface-container-lowest/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-6">
          <span className="flex items-center gap-2.5">
            <img
              src="/assets/logo-emblem.png"
              alt="VerdictChain logo"
              className="h-9 w-9 rounded-lg border border-primary-container/40 bg-surface-card p-1 shadow-glow-cyan"
            />
            <span className="flex flex-col leading-none">
              <span className="font-headline text-lg font-bold uppercase tracking-tight text-primary">
                Verdict<span className="text-on-surface">Chain</span>
              </span>
              <span className="mt-1 text-label uppercase tracking-wider text-on-surface-variant">Multi-agent SOC</span>
            </span>
          </span>
          <button
            type="button"
            onClick={onEnter}
            className="flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2 text-label font-bold uppercase tracking-wider text-on-primary shadow-glow-cyan transition-colors hover:bg-primary"
          >
            <Icon name="login" size={16} />
            Sign in
          </button>
        </div>
      </header>

      {/* HERO — fills the viewport */}
      <section className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden">
        <img
          src="/assets/holographic-soc.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" aria-hidden="true" />
        <div
          className="absolute inset-0 opacity-30"
          aria-hidden="true"
          style={{
            backgroundImage:
              'linear-gradient(to right, color-mix(in srgb, var(--color-primary) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-primary) 6%, transparent) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="relative mx-auto flex max-w-5xl flex-col items-center px-4 py-16 text-center lg:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-outline-variant/50 bg-surface-card/80 px-3 py-1 font-mono text-evidence uppercase tracking-wider text-on-surface-variant backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-secondary" aria-hidden="true" />
            Multi-agent debate &middot; Watchdog verification &middot; Simulated response
          </span>

          <h1 className="mt-6 font-headline text-4xl font-bold leading-tight tracking-tight text-on-surface sm:text-5xl lg:text-6xl">
            Multi-agent forensic adjudication for{' '}
            <span className="bg-gradient-to-r from-primary via-primary-fixed to-secondary bg-clip-text text-transparent">
              insider &amp; network threats
            </span>
          </h1>

          <p className="mt-6 max-w-2xl font-body text-body-lg leading-relaxed text-on-surface-variant">
            Three investigator agents analyse different log slices and debate over three rounds to reach a verdict. A
            Watchdog scores each agent by checking its cited evidence against the raw logs. Containment is simulated, and
            every step is written to a tamper-evident audit trail.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onEnter}
              className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-mono text-caption font-bold uppercase tracking-wider text-on-primary shadow-glow-cyan transition-all hover:bg-primary active:scale-95"
            >
              <Icon name="rocket_launch" size={18} />
              Launch console
              <Icon name="arrow_forward" size={16} />
            </button>
            <a
              href="#how-it-works"
              className="flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-card px-6 py-3 font-mono text-caption font-semibold uppercase tracking-wider text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Icon name="science" size={18} />
              How it works
            </a>
          </div>

          <div className="mt-12 grid w-full max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <span
                key={cap.label}
                className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-card/70 px-3 py-2.5 text-left font-mono text-evidence uppercase tracking-wider text-on-surface-variant backdrop-blur"
              >
                <Icon name={cap.icon} size={16} className="shrink-0 text-primary" />
                {cap.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section id="how-it-works" className="border-t border-outline-variant/30 bg-surface-container-lowest/40 py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="font-mono text-caption uppercase tracking-widest text-primary">The pipeline</span>
            <h2 className="mt-2 font-headline text-3xl font-bold text-on-surface sm:text-4xl">
              Four stages, every claim checked
            </h2>
            <p className="mt-3 font-body text-body text-on-surface-variant">
              From raw telemetry to a signed-off verdict — nothing shown is invented, every value is traced to the data.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.phase}
                className="flex flex-col rounded-xl border border-outline-variant/40 bg-surface-card p-5 transition-transform hover:-translate-y-1"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="rounded border border-outline-variant/40 bg-surface-container-low px-2 py-0.5 font-mono text-evidence font-bold uppercase text-on-surface-variant">
                    {pillar.phase}
                  </span>
                  <Icon name={pillar.icon} size={22} className={pillar.tone} />
                </div>
                <h3 className="font-headline text-body-lg font-semibold text-on-surface">{pillar.title}</h3>
                <p className="mt-2 font-body text-caption leading-relaxed text-on-surface-variant">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="border-t border-outline-variant/30 py-20">
        <div className="mx-auto max-w-3xl px-4 text-center lg:px-6">
          <h2 className="font-headline text-3xl font-bold text-on-surface sm:text-4xl">
            Open the forensic console
          </h2>
          <p className="mt-3 font-body text-body text-on-surface-variant">
            Run a scenario, watch the three agents debate live, and inspect every cited row and audit entry yourself.
          </p>
          <button
            type="button"
            onClick={onEnter}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary-container px-7 py-3.5 font-mono text-caption font-bold uppercase tracking-wider text-on-primary shadow-glow-cyan transition-all hover:bg-primary active:scale-95"
          >
            <Icon name="login" size={18} />
            Sign in to continue
          </button>
          <p className="mt-10 font-mono text-evidence uppercase tracking-wider text-outline">
            Sandboxed forensic console &middot; Authorized personnel only
          </p>
        </div>
      </section>
    </div>
  );
}
