/**
 * Subprocess harness for bootstrap CLI orchestration tests (#111).
 *
 * Runs the REAL `main()` (real process.exitCode mapping, real stdout/stderr)
 * with fake connect/bootstrap/disconnect, selected by HARNESS_SCENARIO. It can
 * never reach a database: the real connectDB/disconnectDB are never wired in.
 * Secrets are synthetic and come from the parent test's environment.
 */
import { main } from "../../scripts/bootstrap-admin.js";

const scenario = process.env.HARNESS_SCENARIO;
const fail = (name, code, message) => () => {
  throw Object.assign(new Error(message), { name, ...(code ? { code } : {}) });
};
const rejectAfterTick = (name, message) => async () => {
  await new Promise((r) => setImmediate(r));
  throw Object.assign(new Error(message), { name });
};
const HOSTILE = `driver says ${process.env.MONGO_URI} password=${process.env.ADMIN_PASSWORD}`;

const ok = async () => ({ outcome: "created", email: process.env.ADMIN_EMAIL });
const deps = { connect: async () => {}, bootstrap: ok, disconnect: async () => { console.log("[harness] disconnect-done"); } };

switch (scenario) {
  case "success":
    break;
  case "connect-fails":
    deps.connect = rejectAfterTick("MongoServerSelectionError", HOSTILE);
    break;
  case "cleanup-fails":
    deps.disconnect = rejectAfterTick("CleanupBoom", HOSTILE);
    break;
  case "both-fail":
    deps.bootstrap = rejectAfterTick("PrimaryBoom", HOSTILE);
    deps.disconnect = rejectAfterTick("CleanupBoom", HOSTILE);
    break;
  case "sync-throw-cleanup":
    deps.disconnect = fail("SyncCleanupBoom", "EBOOM", HOSTILE);
    break;
  default:
    throw new Error("unknown HARNESS_SCENARIO");
}

await main({ deps });
