/**
 * Account-state backfill (#171). Idempotent; dry-run unless `--apply`.
 *
 *   MONGO_URI=... npm run backfill:account-state            # report only
 *   MONGO_URI=... npm run backfill:account-state -- --apply # write
 *
 * Why this exists: users created before #173 may lack `accountState` and/or
 * `accountStateVersion` in the stored document. Mongoose supplies defaults on
 * hydration, so most code is unaffected, but #173's atomic refresh reservation
 * filters on the STORED `accountStateVersion` (`{ accountStateVersion: 0 }`),
 * which does not match a missing field. Such users cannot refresh until the
 * fields are stored. See docs/architecture/account-state-persistence.md.
 *
 * Behavior: sets ONLY missing/null `accountState` -> "ACTIVE" and
 * `accountStateVersion` -> 0. Existing values are never changed, no restriction
 * fields are written, `updatedAt` is not touched (native driver, no
 * timestamps; the Expert-application queue orders by `updatedAt`), and output
 * contains counts only.
 */
import { pathToFileURL } from "node:url";
import { connectDB, disconnectDB } from "../src/config/db.js"; // loads .env
import { User } from "../src/models/User.js";
import { ACCOUNT_STATES } from "../src/domain/account-state.js";

const MISSING = { $or: [{ accountState: null }, { accountStateVersion: null }] };

export async function backfillAccountState({ apply = false } = {}) {
  const candidates = await User.collection.countDocuments(MISSING);
  if (!apply || candidates === 0) return { candidates, modified: 0, applied: false };
  const result = await User.collection.updateMany(MISSING, [
    {
      $set: {
        accountState: { $ifNull: ["$accountState", ACCOUNT_STATES.ACTIVE] },
        accountStateVersion: { $ifNull: ["$accountStateVersion", 0] },
      },
    },
  ]);
  return { candidates, modified: result.modifiedCount, applied: true };
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  try {
    const r = await backfillAccountState({ apply });
    console.log(
      apply
        ? `[backfill-account-state] users needing backfill: ${r.candidates}; updated: ${r.modified}`
        : `[backfill-account-state] dry run: ${r.candidates} user(s) would be updated (re-run with --apply)`,
    );
  } finally {
    await disconnectDB();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[backfill-account-state] failed: ${err?.name ?? "Error"}`);
    process.exitCode = 1;
  });
}
