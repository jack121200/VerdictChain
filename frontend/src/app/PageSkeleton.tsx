import { Skeleton } from '../ui/Skeleton';

/** Shown while a routed page chunk loads. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading screen" className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 lg:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
