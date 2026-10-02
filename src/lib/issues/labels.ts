import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";

/** Display label for a stored category/severity, or null when unclassified ("") or unrecognized. */
export function categoryLabel(value: string): string | null {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}

export function severityLabel(value: string): string | null {
  return ISSUE_SEVERITIES.find((s) => s.value === value)?.label ?? null;
}
