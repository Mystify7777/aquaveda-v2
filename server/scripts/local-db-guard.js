/**
 * Shared safety guard for scripts that write to a developer's local MongoDB.
 *
 * Extracted from the E2E seed guard (#85) so every destructive/dev-only
 * script enforces the SAME boundary. BOTH conditions are required:
 *   1. the host is a loopback host (127.0.0.1, localhost, ::1);
 *   2. the database name ends with the caller's dedicated suffix
 *      (`_e2e` for the browser-suite seed, `_dev` for admin provisioning).
 * A name check alone is insufficient (a remote DB can be named `x_dev`) and
 * a host check alone is insufficient (a local DB may be real data). There is
 * deliberately no override or bypass.
 *
 * Pure and dependency-free so it can be tested without MongoDB.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function assertLocalDatabase(uri, { suffix, action, subject }) {
  const refuse = (reason) => new Error(`Refusing to ${action}: ${reason}`);

  if (typeof uri !== "string" || uri.trim() === "") {
    throw refuse("MONGO_URI is missing.");
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    throw refuse("MONGO_URI is not a valid URI.");
  }

  // `mongodb+srv:` resolves hosts via DNS, i.e. never a local loopback target.
  if (url.protocol !== "mongodb:") {
    throw refuse(`MONGO_URI scheme "${url.protocol}" is not allowed; use mongodb://.`);
  }

  // Non-special schemes keep the host's original case; also rejects multi-host
  // seed lists (e.g. "localhost,remote.example") since they are not one loopback host.
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw refuse(
      `MONGO_URI host "${host}" is not local. ${subject} only permits a local ` +
        "MongoDB (127.0.0.1, localhost or ::1).",
    );
  }

  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (dbName.includes("/") || !dbName.endsWith(suffix)) {
    throw refuse(`MONGO_URI database "${dbName}" must end with "${suffix}".`);
  }
}
