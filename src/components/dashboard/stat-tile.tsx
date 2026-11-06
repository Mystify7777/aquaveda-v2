/** Fixed locale so the same number renders identically everywhere. */
export const formatCount = (n: number) => n.toLocaleString("en-US");

/**
 * One labelled number. Rendered inside a `<dl>` (see DashboardView): the
 * label is the term and the value its description, so a screen reader
 * announces them together.
 */
export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card text-card-foreground rounded-xl border p-5 shadow-sm">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-display mt-2 text-3xl font-semibold tracking-tight">{formatCount(value)}</dd>
    </div>
  );
}
