import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 sm:py-24"
    >
      <span className="sr-only">Loading...</span>

      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-full max-w-lg" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>

      <Skeleton className="h-56 w-full max-w-md rounded-xl" />
    </div>
  );
}
