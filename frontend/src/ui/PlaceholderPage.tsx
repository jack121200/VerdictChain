import { EmptyState } from './EmptyState';
import { PageHeader } from './Headings';

/** Stand-in for a screen that is not built yet. Feature folders replace it with the real page. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <PageHeader title={title} />
      <div className="mt-6">
        <EmptyState title="Not built yet" />
      </div>
    </div>
  );
}
