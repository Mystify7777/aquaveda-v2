export default function DiscussionLoading() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6" aria-busy="true">
      <div className="bg-muted h-4 w-24 animate-pulse rounded" />
      <div className="bg-muted h-56 animate-pulse rounded-xl border" />
      <div className="space-y-3">
        <div className="bg-muted h-6 w-32 animate-pulse rounded" />
        <div className="bg-muted h-20 animate-pulse rounded-xl border" />
      </div>
      <span className="sr-only">Loading discussion...</span>
    </main>
  );
}