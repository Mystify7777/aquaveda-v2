const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** Deterministic (UTC) medium date; returns "" for an unparsable value. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
}
