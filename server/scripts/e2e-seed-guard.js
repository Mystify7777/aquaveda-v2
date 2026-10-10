/**
 * Safety guard for the destructive E2E seed (server/scripts/seed-e2e.js, #85).
 *
 * The seed wipes every collection, so it must only ever touch a throwaway
 * local database: loopback host AND a database name ending `_e2e`. The
 * checks live in local-db-guard.js, shared with admin provisioning (#89).
 */
import { assertLocalDatabase } from "./local-db-guard.js";

export function assertE2eDatabase(uri) {
  assertLocalDatabase(uri, { suffix: "_e2e", action: "seed", subject: "The E2E seed" });
}
