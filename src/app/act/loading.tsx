import { Skeleton } from "@/components/ui/skeleton";

export default function ActLoading() {
  return (
    <div role="status" className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <span className="sr-only">Loading projects...</span>
      <Skeleton className="h-9 w-40" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
