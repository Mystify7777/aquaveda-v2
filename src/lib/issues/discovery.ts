import type { IssueListQuery, IssueStatus } from "@/lib/api/types/issue";
import {
  isIssueCategory,
  isIssueSeverity,
  type IssueCategory,
  type IssueSeverity,
} from "@/lib/issues/classification";
import { parseIssueStatus } from "@/lib/issues/status";
// The single definition of the #41 `q` / `bbox` rules (see that file);
// client validation can never drift from the API.
import {
  BBOX_MAX_SPAN_DEGREES,
  bboxProblem,
  parseBbox,
  searchTextProblem,
} from "@/lib/issues/discovery-contract";

/**
 * URL <-> API state for /explore (Issue #82). The URL is the only state:
 * every active filter is a query parameter, inactive ones are omitted, and
 * serialization order is fixed, so equal state always yields equal URLs.
 * Contract: docs/architecture/issue-discovery-contract.md.
 */

export { BBOX_MAX_SPAN_DEGREES };

/** [west, south, east, north], decimal degrees, longitude first (contract order). */
export type Bbox = [west: number, south: number, east: number, north: number];

export interface ExploreFilters {
  status?: IssueStatus;
  category?: IssueCategory;
  severity?: IssueSeverity;
  /** Trimmed, contract-valid search text. */
  q?: string;
  /** Contract-valid "west,south,east,north", exactly as written in the URL. */
  bbox?: string;
}

export interface InvalidParam {
  value: string;
  /** Backend wording from issue-search.js (same text the API would 400 with). */
  problem: string;
}

export interface ExploreQuery {
  filters: ExploreFilters;
  /** `q`/`bbox` present in the URL but violating the contract. Never sent to the API. */
  invalid: { q?: InvalidParam; bbox?: InvalidParam };
}

type RawParams = Record<string, string | string[] | undefined>;

const KEY_ORDER = ["status", "category", "severity", "q", "bbox"] as const;

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

/**
 * Reads filters from URL params. Unrecognized status/category/severity
 * values are ignored (as `status` always was); `q`/`bbox` that break the
 * contract are reported in `invalid` instead of being silently dropped.
 */
export function parseExploreQuery(sp: RawParams): ExploreQuery {
  const filters: ExploreFilters = {};
  const invalid: ExploreQuery["invalid"] = {};

  const status = parseIssueStatus(sp.status);
  if (status) filters.status = status;

  const category = first(sp.category);
  if (category && isIssueCategory(category)) filters.category = category;

  const severity = first(sp.severity);
  if (severity && isIssueSeverity(severity)) filters.severity = severity;

  const q = first(sp.q)?.trim();
  if (q) {
    const problem = searchTextProblem(q);
    if (problem) invalid.q = { value: q, problem };
    else filters.q = q;
  }

  const bbox = first(sp.bbox)?.trim();
  if (bbox) {
    const tuple = parseBbox(bbox);
    const problem = bboxProblem(tuple ?? []);
    if (problem) invalid.bbox = { value: bbox, problem };
    else filters.bbox = bbox;
  }

  return { filters, invalid };
}

/** Active filters as query params, in fixed order (usable as PaginationNav `params`). */
export function filterParams(filters: ExploreFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of KEY_ORDER) {
    const value = filters[key];
    if (value) out[key] = value;
  }
  return out;
}

/** Canonical /explore URL. Page 1 and inactive filters are omitted. */
export function exploreHref(filters: ExploreFilters, page = 1): string {
  const search = new URLSearchParams(filterParams(filters));
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `/explore?${qs}` : "/explore";
}

/** The GET /api/v1/issues query for this state: only active parameters are present. */
export function toIssueListQuery(filters: ExploreFilters, page: number): IssueListQuery {
  return { page, ...filterParams(filters) } as IssueListQuery;
}

/** Discovery filters (everything except `status`, which has its own nav). */
export function hasDiscoveryFilters(filters: ExploreFilters): boolean {
  return !!(filters.category || filters.severity || filters.q || filters.bbox);
}

/** Same state without discovery filters; `status` is kept (it has its own "All"). */
export function withoutDiscoveryFilters(filters: ExploreFilters): ExploreFilters {
  return filters.status ? { status: filters.status } : {};
}

/**
 * True when a discovery param is blank (`?q=&category=`, exactly what a
 * native GET form submits for empty fields) or padded with whitespace
 * (`?q=%20pump`). The page redirects those to the canonical URL so
 * inactive or untrimmed filters never appear in shareable links. Only
 * blank/whitespace is detected; unrecognized values are not "non-canonical"
 * here (they are ignored by parseExploreQuery, as `status` always was).
 */
export function hasNonCanonicalFilterParams(sp: RawParams): boolean {
  return (["q", "category", "severity", "bbox"] as const).some((key) => {
    const raw = first(sp[key]);
    return raw !== undefined && raw !== raw.trim() ? true : raw === "";
  });
}

/** Parses an already-validated bbox string into bounds; null if absent/invalid. */
export function bboxToBounds(raw: string | undefined): Bbox | null {
  const tuple = raw ? parseBbox(raw) : null;
  return tuple && !bboxProblem(tuple) ? (tuple as Bbox) : null;
}

export type ViewportBbox =
  | { ok: true; bbox: string }
  | { ok: false; reason: "too-large" | "out-of-range" };

/**
 * Turns a map viewport (Leaflet `getBounds()` as [w,s,e,n]) into a contract
 * bbox, validated with the backend's own rules *after* rounding to 5
 * decimals (~1 m). Never clamps: a viewport the API would reject is
 * reported, not adjusted, so the user never searches an area they did not see.
 */
export function viewportToBbox(bounds: Bbox): ViewportBbox {
  const rounded = bounds.map((n) => Math.round(n * 1e5) / 1e5) as Bbox;
  if (!bboxProblem(rounded)) return { ok: true, bbox: rounded.join(",") };
  const [west, south, east, north] = rounded;
  const tooLarge = east - west > BBOX_MAX_SPAN_DEGREES || north - south > BBOX_MAX_SPAN_DEGREES;
  return { ok: false, reason: tooLarge ? "too-large" : "out-of-range" };
}
