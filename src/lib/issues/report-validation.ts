import type { CreateIssuePayload } from "@/lib/api/types/issue";

export interface IssueReportValues {
  title: string;
  description: string;
  latitude: string;
  longitude: string;
}

export type IssueReportField = keyof IssueReportValues;
export type IssueReportErrors = Partial<Record<IssueReportField, string>>;

export const EMPTY_ISSUE_REPORT: IssueReportValues = {
  title: "",
  description: "",
  latitude: "",
  longitude: "",
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
  return { ok: true, payload };
}
