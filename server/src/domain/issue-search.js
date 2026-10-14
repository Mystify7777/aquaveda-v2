/**
 * Issue discovery search rules (Issue #41).
 *
 * Pure (no Mongoose, no Express) so the route-level Zod schema and the
 * service layer enforce *one* definition. Contract:
 * docs/architecture/issue-discovery-contract.md.
 */

export const SEARCH_TEXT_MIN_LENGTH = 2;
export const SEARCH_TEXT_MAX_LENGTH = 100;
export const SEARCH_TEXT_MAX_TERMS = 10;

/** Web Mercator's latitude limit — the viewport this API serves. */
export const BBOX_MAX_LATITUDE = 85;
export const BBOX_MAX_LONGITUDE = 180;
/** Maximum extent of a bounding box, per axis, in degrees. */
export const BBOX_MAX_SPAN_DEGREES = 10;

/**
 * Parses "west,south,east,north" into a 4-number tuple, or returns null
 * when the shape is wrong (not exactly four comma-separated finite
 * numbers). Range/bounds rules are checked by `bboxProblem`.
 */
export function parseBbox(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
  return nums.every(Number.isFinite) ? /** @type {[number, number, number, number]} */ (nums) : null;
}

/**
 * Returns a human-readable problem with a [west, south, east, north]
 * tuple, or null when it is valid under the contract.
 */
export function bboxProblem(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    return "bbox must be four numbers: west,south,east,north";
  }
  const [west, south, east, north] = bbox;
  if (west < -BBOX_MAX_LONGITUDE || east > BBOX_MAX_LONGITUDE) {
    return `bbox longitudes must be between -${BBOX_MAX_LONGITUDE} and ${BBOX_MAX_LONGITUDE}`;
  }
  if (south < -BBOX_MAX_LATITUDE || north > BBOX_MAX_LATITUDE) {
    return `bbox latitudes must be between -${BBOX_MAX_LATITUDE} and ${BBOX_MAX_LATITUDE}`;
  }
  if (!(west < east)) return "bbox west must be less than east (antimeridian crossing is not supported)";
  if (!(south < north)) return "bbox south must be less than north";
  if (east - west > BBOX_MAX_SPAN_DEGREES || north - south > BBOX_MAX_SPAN_DEGREES) {
    return `bbox must not span more than ${BBOX_MAX_SPAN_DEGREES} degrees in either direction`;
  }
  return null;
}

/**
 * Splits search text into terms. Whitespace and double quotes separate
 * terms (quotes carry no query-syntax meaning in this contract and would
 * otherwise be a way to inject MongoDB phrase syntax); empties are dropped.
 */
export function searchTerms(text) {
  return String(text).split(/[\s"]+/).filter(Boolean);
}

/** Returns a human-readable problem with search text, or null when valid. */
export function searchTextProblem(text) {
  if (typeof text !== "string") return "q must be a string";
  const trimmed = text.trim();
  if (trimmed.length < SEARCH_TEXT_MIN_LENGTH) {
    return `q must be at least ${SEARCH_TEXT_MIN_LENGTH} characters`;
  }
  if (trimmed.length > SEARCH_TEXT_MAX_LENGTH) {
    return `q must be at most ${SEARCH_TEXT_MAX_LENGTH} characters`;
  }
  const terms = searchTerms(trimmed);
  if (terms.length === 0) return "q must contain at least one search term";
  if (terms.length > SEARCH_TEXT_MAX_TERMS) {
    return `q must contain at most ${SEARCH_TEXT_MAX_TERMS} terms`;
  }
  return null;
}
