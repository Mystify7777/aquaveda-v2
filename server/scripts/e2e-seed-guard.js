/**
 * Safety guard for the destructive E2E seed (server/scripts/seed-e2e.js, #85).
 *
 * The seed wipes every collection, so it must only ever touch a throwaway
 * local database. BOTH conditions are required:
 *   1. the database name ends with `_e2e`;
 *   2. the host is a loopback host (127.0.0.1, localhost, ::1).
 * A name check alone is insufficient: a remote database could be named
 * `something_e2e`. There is deliberately no override or bypass.
 *
 * Pure and dependency-free so it can be tested without MongoDB.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function assertE2eDatabase(uri) {
  if (typeof uri !== "string" || uri.trim() === "") {
    throw new Error("Refusing to seed: MONGO_URI is missing.");
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Refusing to seed: MONGO_URI is not a valid URI.");
  }

  // `mongodb+srv:` resolves hosts via DNS, i.e. never a local loopback target.
  if (url.protocol !== "mongodb:") {
    throw new Error(
      `Refusing to seed: MONGO_URI scheme "${url.protocol}" is not allowed; use mongodb://.`,
    );
  }

  // Non-special schemes keep the host's original case; also rejects multi-host
  // seed lists (e.g. "localhost,remote.example") since they are not one loopback host.
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed: MONGO_URI host "${host}" is not local. ` +
        "The E2E seed only permits a local MongoDB (127.0.0.1, localhost or ::1).",
    );
  }

  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (dbName.includes("/") || !dbName.endsWith("_e2e")) {
    throw new Error(
      `Refusing to seed: MONGO_URI database "${dbName}" must end with "_e2e".`,
    );
  }
}
