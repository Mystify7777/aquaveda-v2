/**
 * Lifecycle `note` contract (ADR-0007 §6) — pure module, no imports.
 *
 * A note is the free-text explanation attached to a status transition
 * (`statusHistory[].note`) or a responsibility event
 * (`remediationHistory[].note`): a resolution statement, a verification
 * rationale, a withdrawal/revocation reason. It is UNTRUSTED plain text:
 *   - normalized and bounded here, server-side, regardless of client checks;
 *   - rendered only through the user-content policy (#88), never as HTML;
 *   - never used for authorization or any lifecycle decision.
 *
 * Unlike a location label (single line), a note keeps line breaks, so it has
 * its own normalizer.
 */

export const NOTE_MAX_LENGTH = 2000;

// C0/C1 controls except TAB (9) and LF (10), plus zero-width and bidi
// embedding/override/isolate characters (display spoofing). CR is converted
// to LF before this runs; TAB is turned into a space by the whitespace pass.
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Canonical form: NFC; every line ending becomes "\n"; runs of horizontal
 * whitespace collapse to one space; invisible/control characters are
 * removed; spaces around line breaks are dropped; 3+ consecutive newlines
 * collapse to 2; trimmed. Returns undefined for non-strings and for text
 * that normalizes to "".
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizeNote(raw) {
  if (typeof raw !== "string") return undefined;
  const normalized = raw
    .normalize("NFC")
    .replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(INVISIBLE_OR_CONTROL, "")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized === "" ? undefined : normalized;
}

/**
 * Validates and normalizes a caller-supplied note.
 *
 * - `raw === undefined` / `null` means "no note supplied".
 * - A supplied non-string is a problem.
 * - Required + (absent or blank after normalization) is a problem.
 * - Optional + blank after normalization is treated as absent.
 * - Longer than NOTE_MAX_LENGTH after normalization is a problem (never truncated).
 *
 * @param {unknown} raw
 * @param {{ required?: boolean }} [options]
 * @returns {{ ok: true, value: string | undefined } | { ok: false, problem: string }}
 */
export function parseNote(raw, { required = false } = {}) {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, problem: "note must be a string" };
  }
  const value = normalizeNote(raw);
  if (value === undefined) {
    return required ? { ok: false, problem: "note is required" } : { ok: true, value: undefined };
  }
  if (value.length > NOTE_MAX_LENGTH) {
    return { ok: false, problem: `note must be at most ${NOTE_MAX_LENGTH} characters` };
  }
  return { ok: true, value };
}
