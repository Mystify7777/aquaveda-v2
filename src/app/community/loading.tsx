export default function CommunityLoading() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-16 sm:px-6" aria-busy="true">
      <div className="space-y-3">
        <div className="bg-muted h-3 w-20 animate-pulse rounded" />
        <div className="bg-muted h-10 w-80 max-w-full animate-pulse rounded" />
        <div className="bg-muted h-5 w-full max-w-2xl animate-pulse rounded" />
      </div>
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, index) => <div key={index} className="bg-muted h-32 animate-pulse rounded-xl border" />)}
      </div>
      <span className="sr-only">Loading community activity...</span>
    </main>
  );
}