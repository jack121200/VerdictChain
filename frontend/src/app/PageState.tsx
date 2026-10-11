import type { ReactNode } from 'react';
import type { PageData } from './use-page-data';

interface PageStateProps {
  page: Pick<PageData<unknown>, 'status' | 'error'>;
  /** Shown until the first answer arrives. */
  skeleton?: ReactNode;
  /** Text placed before the error sentence. */
  prefix?: string;
  className?: string;
}

/**
 * The part of a page that is not its data: the placeholder while the first load runs, and the plain-words
 * error when it failed. Renders nothing once there is a value, so the data block follows it as before.
 */
export function PageState({ page, skeleton, prefix = '', className = 'text-caption text-error' }: PageStateProps) {
  if (page.status === 'loading') return <>{skeleton ?? null}</>;
  if (page.status === 'failed') {
    return (
      <p className={className}>
        {prefix}
        {page.error}
      </p>
    );
  }
  return null;
}
