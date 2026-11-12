const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** Deterministic (UTC) medium date; returns "" for an unparsable value. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** Deterministic (UTC) medium date and short time, e.g. "Mar 5, 2026, 10:00 AM UTC"; "" when unparsable. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${dateTimeFormatter.format(date)} UTC`;
}
