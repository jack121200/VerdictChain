import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TableColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  /** Evidence values (ids, hashes, timestamps) use JetBrains Mono. */
  mono?: boolean;
}

export interface TableProps<Row> {
  /** Screen-reader caption for the table. */
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Rendered in place of the table when there are no rows. Pass an EmptyState. */
  empty?: ReactNode;
}

/** Data table. It scrolls inside its own box, so the page itself never scrolls sideways on phones. */
export function Table<Row>({ caption, columns, rows, rowKey, empty }: TableProps<Row>) {
  if (rows.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface-card">
      <table className="w-full min-w-max border-collapse text-left text-body">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-container-low">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-2 text-label uppercase text-on-surface-variant',
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-outline-variant/40 transition-colors hover:bg-surface-container-high/50">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-2 align-middle text-on-surface',
                    column.mono && 'font-mono text-evidence',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
