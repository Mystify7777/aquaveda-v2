import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { register, refresh } from "../src/services/auth.service.js";
import { backfillAccountState } from "../scripts/backfill-account-state.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const T = new Date("2026-01-01T00:00:00.000Z");
const raw = (extra) => ({
  name: "Legacy", passwordHash: "h", role: "USER", createdAt: T, updatedAt: T,
  email: `bf-${Date.now()}-${Math.random()}@example.test`, ...extra,
});

describe("backfill:account-state (#171)", () => {
  // Characterization of CURRENT #173 behavior. If the refresh reservation is
  // later hardened to tolerate missing stored fields, delete this test; the
  // backfill remains a harmless one-time normalization.
  it("documents the defect it fixes: a legacy user without stored governance fields cannot refresh", async () => {
    const r = await register({ name: "L", email: "legacy-refresh@example.test", password: "password123" });
    await User.collection.updateOne({ email: "legacy-refresh@example.test" }, { $unset: { accountState: "", accountStateVersion: "" } });
    await assert.rejects(() => refresh(r.refreshToken), { code: "REFRESH_FAILED" });
  });

  it("after the backfill the same legacy user refreshes normally", async () => {
    const r = await register({ name: "L", email: "legacy-fixed@example.test", password: "password123" });
    await User.collection.updateOne({ email: "legacy-fixed@example.test" }, { $unset: { accountState: "", accountStateVersion: "" } });
    await backfillAccountState({ apply: true });
    const out = await refresh(r.refreshToken);
    assert.ok(out.accessToken && out.refreshToken);
  });

  it("dry run reports and writes nothing", async () => {
    await User.collection.insertMany([raw({}), raw({ accountState: "ACTIVE" })]);
    const res = await backfillAccountState({ apply: false });
    assert.deepEqual(res, { candidates: 2, modified: 0, applied: false });
    assert.equal(await User.collection.countDocuments({ accountState: { $exists: true } }), 1);
  });

  it("sets only missing/null fields, preserves existing values, leaves updatedAt alone, is idempotent", async () => {
    await User.collection.insertMany([
      raw({ email: "a@example.test" }),                                       // both missing
      raw({ email: "b@example.test", accountState: "ACTIVE" }),               // version missing
      raw({ email: "c@example.test", accountState: null, accountStateVersion: null }),
      raw({ email: "d@example.test", accountState: "ACTIVE", accountStateVersion: 7 }), // untouched
    ]);
    const res = await backfillAccountState({ apply: true });
    assert.equal(res.candidates, 3);
    assert.equal(res.modified, 3);

    const byEmail = Object.fromEntries((await User.collection.find({}).toArray()).map((u) => [u.email, u]));
    for (const e of ["a", "b", "c"]) {
      assert.equal(byEmail[`${e}@example.test`].accountState, "ACTIVE");
      assert.equal(byEmail[`${e}@example.test`].accountStateVersion, 0);
    }
    assert.equal(byEmail["d@example.test"].accountStateVersion, 7, "existing version never reset");
    for (const u of Object.values(byEmail)) {
      assert.deepEqual(u.updatedAt, T, "updatedAt untouched");
      assert.equal("accountRestriction" in u, false, "no restriction fields written");
    }

    assert.deepEqual(await backfillAccountState({ apply: true }), { candidates: 0, modified: 0, applied: false });
  });

  it("never rewrites a restricted user's existing state", async () => {
    await User.collection.insertOne(raw({
      email: "m@example.test", accountState: "MUTED", accountStateVersion: 3, accountStateChangedAt: T,
      accountRestriction: { kind: "TEMPORARY", expiresAt: new Date("2026-02-01") },
    }));
    assert.equal((await backfillAccountState({ apply: true })).candidates, 0);
    const u = await User.collection.findOne({ email: "m@example.test" });
    assert.equal(u.accountState, "MUTED");
    assert.equal(u.accountStateVersion, 3);
  });
});
