import { useState, type ReactNode } from 'react';
import { describeError, getLiveArrivals, getLiveStatus, getMe, listInvestigations, startLiveFeed, stopLiveFeed } from '../../api/client';
import type { InvestigationSummary, LiveArrival, LiveStatus, LiveWindow } from '../../api/types';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { cn } from '../../lib/cn';
import { formatCount, formatNumber, formatPercent, shortId } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CopyHash } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader, SectionHeader } from '../../ui/Headings';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Select } from '../../ui/Select';
import { Table, type TableColumn } from '../../ui/Table';
import { Timestamp } from '../../ui/Timestamp';
import { Toggle } from '../../ui/Toggle';
import { pushToast } from '../../ui/toast-store';
import { statusTone, STATUS_LABEL, VERDICT_LABEL } from '../investigations/labels';
import { FLAG_SUSPICION, RULE_DEFINITION, fillRatio, thresholdLabel, valueLabel, windowState } from './derive';

const HINT = [
  'There is no real network here: the feed replays rows of the CICIDS2017 and CERT r4.2 datasets through RabbitMQ on its own, and says so on this page.',
  'A monitor keeps a window of the newest rows per source and scores it with a fixed rule that never reads a label; when a window looks unusual it starts an investigation without a click.',
  'Automatic investigations wait in the same queue as injected ones, one debate at a time, and are limited by a gap, a waiting limit and a daily cap so the feed cannot use up the model quota.',
] as const;

const RATE_OPTIONS = [
  { value: '1', label: '1 row / s' },
  { value: '2', label: '2 rows / s' },
  { value: '4', label: '4 rows / s' },
  { value: '10', label: '10 rows / s' },
  { value: '25', label: '25 rows / s' },
] as const;
type RateValue = (typeof RATE_OPTIONS)[number]['value'];

function Tile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-4 backdrop-blur-md">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">{children}</div>
      {sub && <div className="mt-1 font-mono text-[10px] text-on-surface-variant">{sub}</div>}
    </div>
  );
}

/** One source group: how full its window is, the number the rule looks at, and whether it flagged. */
function WindowCard({ window: win, loadedAt }: { window: LiveWindow; loadedAt: string | null }) {
  const state = windowState(win);
  const tone = state === 'flagged' ? 'error' : state === 'normal' ? 'secondary' : 'neutral';
  return (
    <Card hoverTone={state === 'flagged' ? 'error' : undefined} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-headline text-body font-semibold text-on-surface">{win.source}</span>
          <span className="font-mono text-[10px] text-on-surface-variant">{win.feature}</span>
        </div>
        <Pill tone={tone} icon={state === 'flagged' ? 'warning' : state === 'normal' ? 'check' : 'sync'}>
          {state === 'flagged' ? 'Flagged' : state === 'normal' ? 'Normal' : 'Filling'}
        </Pill>
      </div>

      <div className="flex items-center gap-2">
        <div
          role="meter"
          aria-label={`Suspicion, ${win.source}`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(win.suspicion.toFixed(2))}
          className="relative h-2 w-full overflow-hidden rounded-full bg-surface-container-highest"
        >
          <div
            className={cn('h-full rounded-full', state === 'flagged' ? 'bg-error' : 'bg-linear-to-r from-primary-container to-secondary')}
            style={{ width: `${win.suspicion * 100}%` }}
          />
          <div aria-hidden="true" className="absolute inset-y-0 w-px bg-on-surface-variant" style={{ left: `${FLAG_SUSPICION * 100}%` }} />
        </div>
        <span className="font-mono text-evidence tabular-nums text-on-surface">{formatNumber(win.suspicion, 2)}</span>
        <Proof
          source="GET /live/status (windows)"
          n={win.scored_rows}
          asOf={loadedAt}
          label={`Suspicion, ${win.source}`}
          definition={RULE_DEFINITION[win.group]}
          inputs={[
            { label: 'window rows', value: `${win.rows} of ${win.size}` },
            { label: valueLabel(win.group), value: win.value === null ? '—' : formatNumber(win.value, 3) },
            { label: thresholdLabel(win.group), value: win.threshold === null ? '—' : formatNumber(win.threshold, 3) },
            { label: 'z', value: win.z === null ? '—' : formatNumber(win.z, 1) },
          ]}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2 font-mono text-[10px] text-on-surface-variant">
        <div>
          <dt className="uppercase">window</dt>
          <dd className="text-evidence text-on-surface tabular-nums">
            {formatCount(win.rows)} / {formatCount(win.size)}
          </dd>
        </div>
        <div>
          <dt className="uppercase">{valueLabel(win.group)}</dt>
          <dd className="text-evidence text-on-surface tabular-nums">{win.value === null ? '—' : formatNumber(win.value, 2)}</dd>
        </div>
        <div>
          <dt className="uppercase">{thresholdLabel(win.group)}</dt>
          <dd className="text-evidence text-on-surface tabular-nums">{win.threshold === null ? '—' : formatNumber(win.threshold, 2)}</dd>
        </div>
      </dl>
      <p className="text-caption text-on-surface-variant">{win.rule}</p>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
        <div className="h-full bg-outline" style={{ width: `${fillRatio(win) * 100}%` }} />
      </div>
    </Card>
  );
}

function Controls({ status, onChanged }: { status: LiveStatus; onChanged: () => void }) {
  const [rate, setRate] = useState<RateValue>('4');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = status.state === 'running';

  async function run(action: () => Promise<LiveStatus>, done: string) {
    setBusy(true);
    try {
      await action();
      pushToast(done, { tone: 'secondary' });
      onChanged();
    } catch (error) {
      pushToast(describeError(error), { tone: 'tertiary', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  if (running) {
    return (
      <Button variant="secondary" icon="pause" busy={busy} onClick={() => void run(stopLiveFeed, 'Live feed stopped (audited).')}>
        Stop live feed
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Select<RateValue> label="Replay speed" value={rate} options={RATE_OPTIONS} onChange={setRate} disabled={busy} />
      <div className="min-w-56">
        <Toggle
          label="Start investigations automatically"
          description="Off: the monitor still scores windows, nothing starts."
          checked={auto}
          onChange={setAuto}
          disabled={busy}
        />
      </div>
      <Button
        variant="primary"
        icon="play_arrow"
        busy={busy}
        onClick={() =>
          void run(() => startLiveFeed({ events_per_second: Number(rate), auto_investigate: auto }), 'Live feed started (audited).')
        }
      >
        Start live feed
      </Button>
    </div>
  );
}

const ARRIVAL_COLUMNS: TableColumn<LiveArrival>[] = [
  { key: 'arrived', header: 'Arrived', cell: (row) => <Timestamp iso={row.arrived_at} mode="clock" /> },
  { key: 'source', header: 'Source', cell: (row) => row.source, mono: true },
  { key: 'event', header: 'Event', cell: (row) => row.event_type, mono: true },
  { key: 'user', header: 'User', cell: (row) => row.user_id ?? '—', mono: true },
  { key: 'host', header: 'Host', cell: (row) => row.host_id ?? '—', mono: true },
  { key: 'row', header: 'Row', cell: (row) => <CopyHash value={row.row_id} display={shortId(row.row_id)} label="row id" />, mono: true },
];

const INVESTIGATION_COLUMNS: TableColumn<InvestigationSummary>[] = [
  {
    key: 'case',
    header: 'Case',
    cell: (row) => (
      <a href={buildRoute({ name: 'debate', id: row.id })} className="font-mono text-primary underline">
        {shortId(row.id)}
      </a>
    ),
  },
  { key: 'started', header: 'Started', cell: (row) => <Timestamp iso={row.created_at} /> },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <Pill tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</Pill>,
  },
  { key: 'verdict', header: 'Verdict', cell: (row) => (row.verdict_class ? VERDICT_LABEL[row.verdict_class] : '—') },
  {
    key: 'confidence',
    header: 'Agent-reported confidence',
    align: 'right',
    mono: true,
    cell: (row) => (row.verdict_confidence === null ? '—' : formatPercent(row.verdict_confidence, 0)),
  },
];

export default function LivePage() {
  const status = useAsync(getLiveStatus, 3000, ['live']);
  const arrivals = useAsync(() => getLiveArrivals(15), 3000, ['live']);
  const automatic = useAsync(() => listInvestigations({ trigger_type: 'continuous', limit: 8 }), 5000, ['investigations']);
  const me = useAsync(getMe);
  const canControl = me.data?.capabilities.includes('control_live_feed') ?? false;
  const live = status.data;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <PageHeader
        title="Live feed"
        subtitle="Logs arrive on their own, a monitor watches them in windows, and an unusual window starts an investigation without a click."
        actions={
          live && (
            <>
              <Pill tone={live.state === 'running' ? 'secondary' : 'neutral'} icon={live.state === 'running' ? 'sensors' : 'pause'}>
                {live.state === 'running' ? 'Running' : 'Stopped'}
              </Pill>
              {canControl && <Controls status={live} onChanged={status.reload} />}
            </>
          )
        }
      />
      <HintStrip pageId="live" sentences={HINT} className="mt-4" />

      {status.error !== null && live === undefined && (
        <Card className="mt-6">
          <span className="text-caption text-error">{status.error}</span>
        </Card>
      )}

      {live && (
        <div className="mt-6 flex flex-col gap-6">
          <div role="note" className="flex items-start gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
            <Icon name="info" size={20} className="mt-0.5 text-primary" />
            <p className="text-body text-on-surface-variant">{live.notice}</p>
          </div>

          {live.error !== null && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-error/40 bg-error-container/20 p-4">
              <Icon name="warning" size={20} className="mt-0.5 text-error" />
              <p className="text-body text-on-surface">The feed stopped by itself: {live.error}</p>
            </div>
          )}

          <section aria-label="Feed numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Published" sub="rows the sensor put on the queue">
              <Metric metric={live.published} label="Published rows" />
            </Tile>
            <Tile label="Consumed" sub="rows the monitor took in">
              <Metric metric={live.consumed} label="Consumed rows" />
            </Tile>
            <Tile label="Rate" sub="rows / s, last 10 s">
              <Metric metric={live.rate} label="Consumed rows per second" format={(value) => formatNumber(value, 1)} />
            </Tile>
            <Tile label="Queue backlog" sub="messages waiting">
              <Metric metric={live.backlog} label="Queue backlog" />
            </Tile>
            <Tile label="Flagged windows" sub="since the feed started">
              <Metric metric={live.flagged} label="Flagged windows" />
            </Tile>
            <Tile label="Automatic investigations" sub="started by the monitor">
              <Metric metric={live.triggered} label="Automatic investigations" />
            </Tile>
            <Tile label="Today" sub="last 24 hours">
              <Metric metric={live.triggers_today} label="Automatic investigations in 24 hours" />
              <span className="text-caption text-on-surface-variant">of</span>
              <Metric metric={live.daily_cap} label="Daily cap" />
            </Tile>
            <Tile label="Investigations" sub="started automatically">
              <Pill tone={live.auto_investigate ? 'secondary' : 'neutral'} icon={live.auto_investigate ? 'check' : 'block'}>
                {live.auto_investigate ? 'On' : 'Off'}
              </Pill>
            </Tile>
          </section>

          <section aria-label="Monitor windows" className="flex flex-col gap-3">
            <SectionHeader title="What the monitor sees" eyebrow="Windows" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {live.windows.map((window) => (
                <WindowCard key={window.group} window={window} loadedAt={status.loadedAt} />
              ))}
            </div>
          </section>

          <section aria-label="Last automatic investigation" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <span className="text-label uppercase text-on-surface-variant">Last automatic investigation</span>
              {live.last_trigger ? (
                <>
                  <a href={buildRoute({ name: 'debate', id: live.last_trigger.investigation_id })} className="font-mono text-primary underline">
                    {shortId(live.last_trigger.investigation_id)}
                  </a>
                  <p className="text-body text-on-surface">{live.last_trigger.reason}</p>
                  <Timestamp iso={live.last_trigger.at} className="text-caption text-on-surface-variant" />
                </>
              ) : (
                <p className="text-body text-on-surface-variant">None yet. A window has to be flagged first.</p>
              )}
            </Card>
            <Card className="flex flex-col gap-2">
              <span className="text-label uppercase text-on-surface-variant">Why nothing started</span>
              {live.blocked ? (
                <>
                  <p className="text-body text-on-surface">{live.blocked.reason}</p>
                  <Timestamp iso={live.blocked.at} className="text-caption text-on-surface-variant" />
                </>
              ) : (
                <p className="text-body text-on-surface-variant">No flagged window has been refused.</p>
              )}
            </Card>
          </section>

          <section aria-label="Arrivals" className="flex flex-col gap-3">
            <SectionHeader
              title="Rows arriving"
              eyebrow="Newest first"
              action={
                <Proof
                  source="GET /live/arrivals"
                  n={arrivals.data?.length ?? 0}
                  asOf={arrivals.loadedAt}
                  label="Rows arriving"
                  definition="The pointer of each row the monitor took off the queue (row id, time, source, event type) with its user and host. The last 100 are kept; no label and no raw field is returned."
                />
              }
            />
            <Table
              caption="Rows that arrived most recently"
              columns={ARRIVAL_COLUMNS}
              rows={arrivals.data ?? []}
              rowKey={(row) => `${row.row_id}-${row.arrived_at}`}
              empty={
                <EmptyState
                  icon="sensors"
                  title={live.state === 'running' ? 'Waiting for the first rows' : 'The feed is off'}
                  description={
                    live.state === 'running'
                      ? 'Rows appear here as the sensor publishes them.'
                      : canControl
                        ? 'Start the live feed above and rows will arrive on their own.'
                        : 'A lead or a supervisor can start the live feed.'
                  }
                />
              }
            />
          </section>

          <section aria-label="Automatic investigations" className="flex flex-col gap-3">
            <SectionHeader
              title="Investigations the monitor started"
              eyebrow="trigger_type = continuous"
              action={
                <Proof
                  source="GET /investigations?trigger_type=continuous"
                  n={automatic.data?.items.length ?? 0}
                  asOf={automatic.loadedAt}
                  label="Automatic investigations"
                  definition="The newest investigations whose trigger is the live monitor. They run in the same debate queue as injected scenarios."
                />
              }
            />
            <Table
              caption="Investigations started by the live monitor"
              columns={INVESTIGATION_COLUMNS}
              rows={automatic.data?.items ?? []}
              rowKey={(row) => row.id}
              empty={<EmptyState icon="forum" title="None yet" description="Investigations started by the monitor are listed here, newest first." />}
            />
          </section>
        </div>
      )}
    </div>
  );
}
