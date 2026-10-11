import { getLiveArrivals, getLiveStatus, getMe, getSettings, listInvestigations } from '../../api/client';
import { buildRoute } from '../../app/router';
import { useAsync } from '../../app/use-async';
import { usePageData } from '../../app/use-page-data';
import { formatNumber, shortId } from '../../lib/format';
import { Card } from '../../ui/Card';
import { CopyButton } from '../../ui/CopyHash';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader, SectionHeader } from '../../ui/Headings';
import { HintStrip } from '../../ui/HintStrip';
import { Icon } from '../../ui/Icon';
import { Metric } from '../../ui/Metric';
import { Pill } from '../../ui/Pill';
import { Proof } from '../../ui/Proof';
import { Table } from '../../ui/Table';
import { Timestamp } from '../../ui/Timestamp';
import { OperationsBoard } from '../investigations/OperationsBoard';
import { Controls } from './Controls';
import { LlmCard } from './LlmCard';
import { Tile, WindowCard } from './WindowCard';
import { ARRIVAL_COLUMNS, INVESTIGATION_COLUMNS } from './columns';

const HINT = [
  'There is no real network here: the feed replays rows of the CICIDS2017 and CERT r4.2 datasets through RabbitMQ on its own, and says so on this page.',
  'A monitor keeps a window of the newest rows per source and scores it with a fixed rule that never reads a label; when a window looks unusual it starts an investigation without a click.',
  'Several automatic investigations run side by side, one per free debate slot; when every slot is busy they wait in the same queue as injected ones. A gap per source window, a waiting limit and a daily cap stop the feed from using up the model quota.',
  'OpenAI is used by all debates (manual and live). The live feed has its own budget-tracked OpenAI client with a daily token limit; until the chosen row count streams, the monitor scores windows locally and no model is called.',
] as const;

export default function LivePage() {
  const feed = usePageData(getLiveStatus, 2000, ['live']);
  const arrivals = useAsync(() => getLiveArrivals(15), 2000, ['live']);
  const automatic = useAsync(() => listInvestigations({ trigger_type: 'continuous', limit: 8 }), 3000, ['investigations']);
  const me = useAsync(getMe);
  // The debate length, so a lane can show "round 2 of 3".
  const settings = useAsync(getSettings, undefined, ['settings']);
  const canControl = me.data?.capabilities.includes('control_live_feed') ?? false;
  const live = feed.data;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <PageHeader
        title="Live feed"
        subtitle="Dataset rows are replayed on their own, a monitor watches them in windows, and an unusual window starts an investigation without a click."
        actions={
          live && (
            <>
              <Pill tone={live.state === 'running' ? 'secondary' : 'neutral'} icon={live.state === 'running' ? 'sensors' : 'pause'}>
                {live.state === 'running' ? 'Running' : 'Stopped'}
              </Pill>
              {canControl && <Controls status={live} onChanged={feed.reload} />}
            </>
          )
        }
      />
      <HintStrip pageId="live" sentences={HINT} className="mt-4" />

      {feed.status === 'failed' && (
        <Card className="mt-6">
          <span className="text-caption text-error">{feed.error}</span>
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

          <LlmCard live={live} loadedAt={feed.loadedAt} />

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
                <WindowCard key={window.group} window={window} loadedAt={feed.loadedAt} />
              ))}
            </div>
          </section>

          {/* The cases the monitor has put into debate slots, running side by side */}
          <OperationsBoard rounds={settings.data?.debate_rounds ?? null} showScoreboard={false} />

          <section aria-label="Last automatic investigation" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <span className="text-label uppercase text-on-surface-variant">Last automatic investigation</span>
              {live.last_trigger ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <a href={buildRoute({ name: 'debate', id: live.last_trigger.investigation_id })} className="font-mono text-primary underline">
                      {shortId(live.last_trigger.investigation_id)}
                    </a>
                    <CopyButton value={live.last_trigger.investigation_id} label="investigation id" />
                  </span>
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
