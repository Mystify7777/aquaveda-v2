import { formatCount } from "@/components/dashboard/stat-tile";

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
}

/**
 * A card listing a total and its per-status counts. Every status is a
 * text label with its number (nothing is conveyed by color or position
 * alone), and zero rows are kept so the card's shape never changes.
 */
export function StatusBreakdown({
  title,
  total,
  totalLabel,
  rows,
}: {
  title: string;
  total: number;
  totalLabel: string;
  rows: readonly BreakdownRow[];
}) {
  return (
    <div className="bg-card text-card-foreground rounded-xl border p-5 shadow-sm">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <dl className="mt-4 divide-y text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-medium tabular-nums">{formatCount(row.count)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 pt-3 font-semibold">
          <dt>{totalLabel}</dt>
          <dd className="tabular-nums">{formatCount(total)}</dd>
        </div>
      </dl>
    </div>
  );
}
