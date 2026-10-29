/**
 * Issue.locationLabel contract (#134) — pure module, no imports.
 *
 * A location label is a short, human-readable place name shown next to an
 * Issue. It is UNTRUSTED display text supplied by the reporter (typically
 * chosen from a geocoder result, but the server cannot verify that):
 *   - never an address verification, never evidence the coordinates match it;
 *   - never used for authorization, project eligibility, search or geo logic
 *     (the canonical `location` GeoJSON Point is the only geometry);
 *   - only ever rendered as plain text (React text node), never as HTML.
 *
 * The frontend re-exports this module (src/lib/issues/location-contract.ts),
 * same boundary pattern as issue-search.js (#82). Do not copy these rules.
 */

export const LOCATION_LABEL_MAX_LENGTH = 200;

// After whitespace collapsing: remaining C0/C1 controls, zero-width space,
// BOM, and bidi embedding/override/isolate characters (display spoofing).
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u001F\u007F-\u009F\u200B\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Canonical form: NFC, every whitespace run (incl. newlines/tabs/NBSP)
 * collapsed to one space, invisible/control characters removed, trimmed.
 * Returns undefined for non-strings and for strings that normalize to "".
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizeLocationLabel(raw) {
  if (typeof raw !== "string") return undefined;
  const normalized = raw
    .normalize("NFC")
    .replace(/[\s\u0085]+/g, " ")
    .replace(INVISIBLE_OR_CONTROL, "")
    .trim();
  return normalized === "" ? undefined : normalized;
}

/**
 * Validation problem for an ALREADY-NORMALIZED label, or null if usable
 * (including `undefined`, meaning "no label").
 *
 * @param {string | undefined} normalized
 * @returns {string | null}
 */
export function locationLabelProblem(normalized) {
  if (normalized === undefined) return null;
  if (normalized.length > LOCATION_LABEL_MAX_LENGTH) {
    return `locationLabel must be at most ${LOCATION_LABEL_MAX_LENGTH} characters`;
  }
  if (/[<>]/.test(normalized)) {
    return "locationLabel must not contain '<' or '>'";
  }
  return null;
}

/**
 * Shortens a provider-supplied name to a valid label: normalized, angle
 * brackets removed, cut at a ", " boundary (else hard cut) with an ellipsis
 * when over the limit. Returns undefined if nothing usable remains.
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function compactLocationLabel(raw) {
  const base = normalizeLocationLabel(
    typeof raw === "string" ? raw.replace(/[<>]/g, " ") : raw,
  );
  if (base === undefined || base.length <= LOCATION_LABEL_MAX_LENGTH) return base;
  const room = base.slice(0, LOCATION_LABEL_MAX_LENGTH - 1);
  const cut = room.lastIndexOf(", ");
  const head = cut > LOCATION_LABEL_MAX_LENGTH / 2 ? room.slice(0, cut) : room;
  return `${head.trimEnd()}…`;
}
