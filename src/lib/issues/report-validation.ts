import type { CreateIssuePayload } from "@/lib/api/types/issue";
import { isIssueCategory, isIssueSeverity } from "@/lib/issues/classification";

export interface IssueReportValues {
  title: string;
  description: string;
  latitude: string;
  longitude: string;
  /** Canonical category value, or "" for none. */
  category: string;
  /** Canonical severity value, or "" for none. */
  severity: string;
}

export type IssueReportField = keyof IssueReportValues;
export type IssueReportErrors = Partial<Record<IssueReportField, string>>;

export const EMPTY_ISSUE_REPORT: IssueReportValues = {
  title: "",
  description: "",
  latitude: "",
  longitude: "",
  category: "",
  severity: "",
};

function parseCoordinate(raw: string, min: number, max: number, label: string) {
  const value = raw.trim();
  if (!value) return { error: `${label} is required.` };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (n < min || n > max) {
    return { error: `${label} must be between ${min} and ${max}.` };
  }
  return { value: n };
}

/**
 * Frontend-boundary validation mirroring server createIssueSchema.
 * Advisory only — the backend remains authoritative.
 * GeoJSON order: coordinates are [longitude, latitude].
 */
export function validateIssueReport(
  values: IssueReportValues,
): { ok: true; payload: CreateIssuePayload } | { ok: false; errors: IssueReportErrors } {
  const errors: IssueReportErrors = {};
  const title = values.title.trim();
  const description = values.description.trim();
  if (!title) errors.title = "Title is required.";
  if (!description) errors.description = "Description is required.";

  const lat = parseCoordinate(values.latitude, -90, 90, "Latitude");
  const lon = parseCoordinate(values.longitude, -180, 180, "Longitude");
  if (values.category && !isIssueCategory(values.category)) {
    errors.category = "Choose a category from the list.";
  }
  if (values.severity && !isIssueSeverity(values.severity)) {
    errors.severity = "Choose a severity from the list.";
  }
  if (lat.error) errors.latitude = lat.error;
  if (lon.error) errors.longitude = lon.error;

  if (Object.keys(errors).length > 0 || lat.value === undefined || lon.value === undefined) {
    return { ok: false, errors };
  }

  const payload: CreateIssuePayload = {
    title,
    description,
    location: { type: "Point", coordinates: [lon.value, lat.value] },
  };
  if (values.category && isIssueCategory(values.category)) payload.category = values.category;
  if (values.severity && isIssueSeverity(values.severity)) payload.severity = values.severity;
  return { ok: true, payload };
}
