import { Skeleton } from "@/components/ui/skeleton";

/** Detail-shaped loading state; the parent `explore/loading.tsx` is list-shaped. */
export default function IssueDetailLoading() {
  return (
    <div role="status" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6">
      <span className="sr-only">Loading issue...</span>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
