import { Skeleton } from "@/components/ui/skeleton";

export default function ExploreLoading() {
  return (
    <div role="status" className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <span className="sr-only">Loading issues...</span>
      <Skeleton className="h-9 w-40" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-lg lg:h-[32rem]" />
      </div>
    </div>
  );
}
