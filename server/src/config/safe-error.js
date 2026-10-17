/**
 * Restrictive error-metadata formatter for operator-facing output (#110).
 *
 * Error `name`/`code` are conventionally identifiers but are not guaranteed to
 * be: a library or hostile input can put arbitrary text (including secrets or
 * control characters) in them. Only tokens matching a strict allowlist, or safe
 * integers, are ever rendered; everything else falls back to a fixed label.
 * Error messages are never rendered here.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/** @param {unknown} error @returns {string} e.g. "MongoServerSelectionError (code ENOTFOUND)" */
export function safeErrorTag(error) {
  const name = typeof error?.name === "string" && SAFE_TOKEN.test(error.name) ? error.name : "Error";
  const rawCode = error?.code;
  const hasCode =
    (typeof rawCode === "string" && SAFE_TOKEN.test(rawCode)) || Number.isSafeInteger(rawCode);
  return hasCode ? `${name} (code ${rawCode})` : name;
}
