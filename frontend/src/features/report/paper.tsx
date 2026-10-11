/**
 * Building blocks of the printed documents (case report, chain of custody): the A4 sheet with its toolbar, section
 * headings, chips and table styles. Light page, dark ink, the deeper `paper-*` accents (src/styles/tokens.css).
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

export type PaperTone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'neutral';

const CHIP: Record<PaperTone, string> = {
  primary: 'border-paper-primary/40 bg-paper-primary/10 text-paper-primary',
  secondary: 'border-paper-secondary/40 bg-paper-secondary/10 text-paper-secondary',
  tertiary: 'border-paper-tertiary/40 bg-paper-tertiary/10 text-paper-tertiary',
  error: 'border-paper-error/40 bg-paper-error/10 text-paper-error',
  neutral: 'border-paper-rule bg-paper-tint text-ink-muted',
};

export const TEXT_TONE: Record<PaperTone, string> = {
  primary: 'text-paper-primary',
  secondary: 'text-paper-secondary',
  tertiary: 'text-paper-tertiary',
  error: 'text-paper-error',
  neutral: 'text-ink-muted',
};

export const BAR_TONE: Record<PaperTone, string> = {
  primary: 'bg-paper-primary',
  secondary: 'bg-paper-secondary',
  tertiary: 'bg-paper-tertiary',
  error: 'bg-paper-error',
  neutral: 'bg-ink-muted',
};

export function Chip({ tone = 'neutral', children, className }: { tone?: PaperTone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', CHIP[tone], className)}>{children}</span>;
}

/** A numbered section of the document: an accent bar, an uppercase title and an optional one-line note. */
export function Section({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('mt-5', className)}>
      {/* break-after-avoid keeps a heading with the block that follows it, never alone at the foot of a page */}
      <div className="mb-2 flex items-end justify-between gap-3 border-b border-paper-rule pb-1 break-after-avoid">
        <h2 className="flex items-center gap-2 font-headline text-[13px] font-bold uppercase tracking-wider text-ink">
          <span aria-hidden="true" className="h-3 w-1 rounded-full bg-paper-primary" />
          {title}
        </h2>
        {note && <span className="text-right text-[10px] text-ink-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** One labelled fact: a small muted label above its value. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-0.5 break-words text-[12px] text-ink">{children}</div>
    </div>
  );
}

/** A mono hash that may break anywhere, so a 64-character digest fits the page. */
export function Hash({ value, className }: { value: string; className?: string }) {
  return <span className={cn('break-all font-mono text-[10px] leading-snug', className)}>{value}</span>;
}

export const TABLE = 'w-full border-collapse text-[11px]';
export const TH = 'border-b border-paper-rule bg-paper-tint px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wider text-ink-muted';
export const TD = 'border-b border-paper-rule px-2 py-1 align-top';

export interface SheetProps {
  /** The file name the PDF is saved under (the browser takes it from the page title). */
  fileName: string;
  backHref: string;
  backLabel: string;
  /** False while the document is still reading its data or recomputing its hashes. */
  ready: boolean;
  children: ReactNode;
}

/** Opens the print dialog with the page title set to the file name, and puts the title back afterwards. */
export function printAs(fileName: string): void {
  const previous = document.title;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  document.title = fileName;
  window.print();
}

/**
 * The page the document sits on. On screen: a toolbar (back link and the download button) above an A4 sheet. In print:
 * only the sheet (the toolbar is print:hidden and the page rule in tokens.css sets A4 with 12 mm margins).
 */
export function Sheet({ fileName, backHref, backLabel, ready, children }: SheetProps) {
  return (
    <div className="min-h-screen bg-background px-4 py-6 print:bg-paper print:p-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <a href={backHref} className="inline-flex items-center gap-1.5 font-mono text-caption text-primary underline">
          <Icon name="chevron_left" size={16} />
          {backLabel}
        </a>
        <span className="inline-flex flex-wrap items-center gap-3">
          <span className="max-w-md text-right font-mono text-caption text-on-surface-variant">
            The print dialog opens: choose “Save as PDF” as the destination, and untick “Headers and footers” for a clean page.
          </span>
          <Button variant="primary" icon="download" disabled={!ready} onClick={() => printAs(fileName)}>
            {ready ? 'Download PDF' : 'Preparing the document…'}
          </Button>
        </span>
      </div>
      <article className="vc-sheet mx-auto w-full max-w-[210mm] bg-paper p-[12mm] font-body text-[12px] leading-[1.45] text-ink shadow-hero print:max-w-none print:p-0 print:shadow-none">{children}</article>
    </div>
  );
}
