/** Table columns of the Live screen. */
import type { InvestigationSummary, LiveArrival } from '../../api/types';
import { buildRoute } from '../../app/router';
import { formatCountNoun, formatPercent, shortId } from '../../lib/format';
import { CopyButton, CopyHash } from '../../ui/CopyHash';
import { Pill } from '../../ui/Pill';
import { type TableColumn } from '../../ui/Table';
import { StubBadge } from '../../ui/StubBadge';
import { Timestamp } from '../../ui/Timestamp';
import { statusIcon, statusTone, STATUS_LABEL, VERDICT_LABEL } from '../investigations/labels';

export const ARRIVAL_COLUMNS: TableColumn<LiveArrival>[] = [
  { key: 'arrived', header: 'Arrived', cell: (row) => <Timestamp iso={row.arrived_at} mode="clock" /> },
  { key: 'source', header: 'Source', cell: (row) => row.source, mono: true },
  { key: 'event', header: 'Event', cell: (row) => row.event_type, mono: true },
  { key: 'user', header: 'User', cell: (row) => row.user_id ?? '—', mono: true },
  { key: 'host', header: 'Host', cell: (row) => row.host_id ?? '—', mono: true },
  { key: 'row', header: 'Row', cell: (row) => <CopyHash value={row.row_id} display={shortId(row.row_id)} label="row id" />, mono: true },
];

export const INVESTIGATION_COLUMNS: TableColumn<InvestigationSummary>[] = [
  {
    key: 'case',
    header: 'Case',
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5">
        <a href={buildRoute({ name: 'debate', id: row.id })} className="font-mono text-primary underline">
          {shortId(row.id)}
        </a>
        <CopyButton value={row.id} label="investigation id" />
      </span>
    ),
  },
  { key: 'started', header: 'Started', cell: (row) => <Timestamp iso={row.created_at} /> },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <Pill tone={statusTone(row.status)} icon={statusIcon(row.status)}>
        {STATUS_LABEL[row.status]}
      </Pill>
    ),
  },
  {
    key: 'rounds',
    header: 'Progress',
    cell: (row) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        {formatCountNoun(row.rounds_complete, 'round')}
        <StubBadge source={row.data_source} />
      </span>
    ),
  },
  { key: 'verdict', header: 'Verdict', cell: (row) => (row.verdict_class ? VERDICT_LABEL[row.verdict_class] : '—') },
  {
    key: 'containment',
    header: 'Containment',
    align: 'right',
    mono: true,
    cell: (row) => (row.containment_count > 0 ? formatCountNoun(row.containment_count, 'action') : '—'),
  },
  {
    key: 'confidence',
    header: 'Agent-reported confidence',
    align: 'right',
    mono: true,
    cell: (row) => (row.verdict_confidence === null ? '—' : formatPercent(row.verdict_confidence, 0)),
  },
];
