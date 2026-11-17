import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { ACCOUNT_STATES } from "../src/domain/account-state.js";
import {
  RESTRICTION_KINDS,
  SAFE_REASON_MAX_LENGTH,
  isRestrictionExpired,
  isTerminalAccountState,
  validateAccountRecord,
} from "../src/domain/account-restriction.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #171 — persistence of authoritative account state and CURRENT restriction
 * metadata (ADR-0010 §1–§3). Governance history (#172), mutation APIs
 * (#174/#175), appeals, deletion workflows and Expert revocation are out of
 * scope and not exercised here.
 */

before(async () => {
  await setupTestDb();
  await User.init();
});
after(teardownTestDb);
beforeEach(clearCollections);

const { ACTIVE, MUTED, HARD_SUSPENDED, DELETION_PENDING, PERMANENTLY_DELETED } = ACCOUNT_STATES;
const { TEMPORARY, INDEFINITE } = RESTRICTION_KINDS;

const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-06-02T00:00:00.000Z");
let n = 0;
const base = (extra = {}) => ({
  name: "Acct Test",
  email: `acct-${Date.now()}-${n++}@example.test`,
  passwordHash: "hash",
  ...extra,
});

/** A valid persisted record for each state. */
const VALID = {
  [ACTIVE]: {},
  [MUTED]: {
    accountState: MUTED,
    accountStateChangedAt: T0,
    accountRestriction: { kind: TEMPORARY, expiresAt: T1, safeReason: "Please review the guidelines." },
  },
  [HARD_SUSPENDED]: {
    accountState: HARD_SUSPENDED,
    accountStateChangedAt: T0,
    accountRestriction: { kind: INDEFINITE },
  },
  [DELETION_PENDING]: { accountState: DELETION_PENDING, accountStateChangedAt: T0 },
  [PERMANENTLY_DELETED]: { accountState: PERMANENTLY_DELETED, accountStateChangedAt: T0 },
};

/** Apply a state's valid record onto a document, clearing the previous one. */
function applyRecord(doc, state) {
  doc.accountState = state;
  doc.accountStateChangedAt = VALID[state].accountStateChangedAt;
  doc.accountRestriction = VALID[state].accountRestriction;
}

describe("validateAccountRecord (pure)", () => {
  it("accepts a valid record for every state, including both HARD_SUSPENDED shapes", () => {
    for (const state of Object.values(ACCOUNT_STATES)) {
      assert.deepEqual(validateAccountRecord({ accountState: state, ...VALID[state] }), [], state);
    }
    assert.deepEqual(
      validateAccountRecord({
        accountState: HARD_SUSPENDED,
        accountStateChangedAt: T0,
        accountRestriction: { kind: TEMPORARY, expiresAt: T1 },
      }),
      [],
    );
  });

  const INVALID = [
    ["ACTIVE with a restriction", { accountState: ACTIVE, accountRestriction: { kind: INDEFINITE } }],
    ["MUTED without a restriction", { accountState: MUTED, accountStateChangedAt: T0 }],
    ["MUTED INDEFINITE", { accountState: MUTED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE } }],
    ["MUTED TEMPORARY without expiresAt", { accountState: MUTED, accountStateChangedAt: T0, accountRestriction: { kind: TEMPORARY } }],
    ["HARD_SUSPENDED without a restriction", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0 }],
    ["HARD_SUSPENDED TEMPORARY without expiresAt", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: TEMPORARY } }],
    ["HARD_SUSPENDED INDEFINITE with expiresAt", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE, expiresAt: T1 } }],
    ["expiresAt equal to accountStateChangedAt", { accountState: MUTED, accountStateChangedAt: T0, accountRestriction: { kind: TEMPORARY, expiresAt: T0 } }],
    ["expiresAt before accountStateChangedAt", { accountState: MUTED, accountStateChangedAt: T1, accountRestriction: { kind: TEMPORARY, expiresAt: T0 } }],
    ["DELETION_PENDING with a restriction (representation deferred)", { accountState: DELETION_PENDING, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE } }],
    ["PERMANENTLY_DELETED with a restriction", { accountState: PERMANENTLY_DELETED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE } }],
    ["non-ACTIVE without accountStateChangedAt", { accountState: DELETION_PENDING }],
    ["unknown kind", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: "FOREVER" } }],
    ["whitespace-only safeReason", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE, safeReason: "   " } }],
    ["over-long safeReason", { accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE, safeReason: "x".repeat(SAFE_REASON_MAX_LENGTH + 1) } }],
    ["unknown state", { accountState: "BANNED" }],
  ];
  for (const [name, record] of INVALID) {
    it(`rejects: ${name}`, () => {
      assert.ok(validateAccountRecord(record).length > 0);
    });
  }

  it("expiry semantics: TEMPORARY expires at expiresAt; INDEFINITE and absent never expire", () => {
    const r = { kind: TEMPORARY, expiresAt: T1 };
    assert.equal(isRestrictionExpired(r, new Date(T1.getTime() - 1)), false);
    assert.equal(isRestrictionExpired(r, T1), true);
    assert.equal(isRestrictionExpired({ kind: INDEFINITE }, new Date("2999-01-01")), false);
    assert.equal(isRestrictionExpired(undefined, new Date()), false);
    assert.equal(isRestrictionExpired({ kind: TEMPORARY }, new Date()), false, "missing expiresAt is invalid, never 'expired'");
  });

  it("PERMANENTLY_DELETED is the only terminal state", () => {
    assert.deepEqual(Object.values(ACCOUNT_STATES).filter(isTerminalAccountState), [PERMANENTLY_DELETED]);
  });
});

describe("User model boundary", () => {
  it("persists every state with its restriction, and round-trips temporary vs indefinite", async () => {
    for (const state of Object.values(ACCOUNT_STATES)) {
      const user = await User.create(base(VALID[state]));
      const raw = await User.collection.findOne({ _id: user._id });
      assert.equal(raw.accountState, state);
      if (state === MUTED) {
        assert.equal(raw.accountRestriction.kind, TEMPORARY);
        assert.deepEqual(raw.accountRestriction.expiresAt, T1);
        assert.equal(raw.accountRestriction.safeReason, "Please review the guidelines.");
      } else if (state === HARD_SUSPENDED) {
        assert.equal(raw.accountRestriction.kind, INDEFINITE);
        assert.equal("expiresAt" in raw.accountRestriction, false, "indefinite is explicit, not a null expiry");
      } else {
        assert.equal("accountRestriction" in raw, false);
      }
    }
  });

  it("persists a TEMPORARY hard suspension", async () => {
    const u = await User.create(base({ ...VALID[HARD_SUSPENDED], accountRestriction: { kind: TEMPORARY, expiresAt: T1 } }));
    const re = await User.findById(u._id);
    assert.equal(re.accountRestriction.kind, TEMPORARY);
    assert.deepEqual(re.accountRestriction.expiresAt, T1);
  });

  // These are persistence COMBINATIONS (non-terminal source state x target
  // state), not transitions. Each case proves only that a valid TARGET record
  // persists over a document that was previously stored in the source state
  // (and that a stale restriction is cleared). Nothing here asserts that the
  // move is permitted. The model boundary deliberately does NOT encode a
  // transition graph (ADR-0010 defers several transitions, and
  // authority/ordering belong to #174-#180 via conditional atomic updates).
  // PERMANENTLY_DELETED is terminal; terminal enforcement is a service-level
  // conditional filter (accountState != PERMANENTLY_DELETED), not a schema rule.
  const FROM = Object.values(ACCOUNT_STATES).filter((s) => !isTerminalAccountState(s));
  for (const from of FROM) {
    for (const to of Object.values(ACCOUNT_STATES)) {
      it(`persists a valid ${to} record over a document stored as ${from} (no transition policy asserted)`, async () => {
        const user = await User.create(base(VALID[from]));
        const doc = await User.findById(user._id);
        applyRecord(doc, to);
        await doc.save();
        const raw = await User.collection.findOne({ _id: user._id });
        assert.equal(raw.accountState, to);
        assert.equal(Boolean(raw.accountRestriction), to === MUTED || to === HARD_SUSPENDED, "stale restriction must be cleared");
      });
    }
  }

  it("rejects a transition that leaves a stale restriction behind (MUTED → ACTIVE without clearing)", async () => {
    const user = await User.create(base(VALID[MUTED]));
    const doc = await User.findById(user._id);
    doc.accountState = ACTIVE;
    await assert.rejects(() => doc.save(), /accountRestriction must be absent/);
  });

  it("rejects invalid combinations on create and on update", async () => {
    await assert.rejects(() => User.create(base({ accountState: MUTED, accountStateChangedAt: T0 })), /accountRestriction is required/);
    await assert.rejects(
      () => User.create(base({ accountState: HARD_SUSPENDED, accountStateChangedAt: T0, accountRestriction: { kind: INDEFINITE, expiresAt: T1 } })),
      /INDEFINITE restriction must not have expiresAt/,
    );
    const ok = await User.create(base());
    const doc = await User.findById(ok._id);
    doc.accountState = DELETION_PENDING; // no accountStateChangedAt
    await assert.rejects(() => doc.save(), /accountStateChangedAt is required/);
  });

  it("does not expose the restriction through toJSON", async () => {
    const u = await User.create(base(VALID[MUTED]));
    const json = JSON.parse(JSON.stringify(await User.findById(u._id)));
    assert.equal("accountRestriction" in json, false);
    assert.equal("passwordHash" in json, false);
  });
});

describe("compatibility with existing users (#173 behavior preserved)", () => {
  it("a legacy raw user with no governance fields loads as ACTIVE, validates, and saves unrelated changes", async () => {
    const _id = (await User.collection.insertOne({
      name: "Legacy", email: `legacy-${Date.now()}@example.test`, passwordHash: "h", role: "USER", bio: "",
      createdAt: T0, updatedAt: T0,
    })).insertedId;
    const doc = await User.findById(_id);
    assert.equal(doc.accountState, ACTIVE);
    assert.equal(doc.accountStateVersion, 0);
    assert.equal(doc.accountRestriction, undefined);
    assert.equal(doc.accountStateChangedAt, undefined);
    await doc.validate();
    doc.bio = "updated";
    await doc.save();
    const raw = await User.collection.findOne({ _id });
    assert.equal("accountRestriction" in raw, false, "ACTIVE users stay shape-identical: no new fields written");
    assert.equal("accountStateChangedAt" in raw, false);
  });

  it("new ACTIVE users persist no restriction fields", async () => {
    const u = await User.create(base());
    const raw = await User.collection.findOne({ _id: u._id });
    assert.equal(raw.accountState, ACTIVE);
    assert.equal("accountRestriction" in raw, false);
    assert.equal("accountStateChangedAt" in raw, false);
  });

  it("an invalid raw governance record never blocks an unrelated save, and partial selections skip the check", async () => {
    const _id = (await User.collection.insertOne({
      name: "Bad Raw", email: `bad-${Date.now()}@example.test`, passwordHash: "h", role: "USER",
      accountState: HARD_SUSPENDED, accountStateVersion: 1, // invalid: no restriction / changedAt
    })).insertedId;
    const doc = await User.findById(_id);
    doc.bio = "unrelated";
    await doc.save();
    const partial = await User.findById(_id).select("name");
    partial.name = "Renamed";
    await partial.save();
    assert.equal((await User.collection.findOne({ _id })).name, "Renamed");
  });
});

describe("indexes (partial: ACTIVE users carry no entries)", () => {
  it("declares both account-governance indexes as partial", async () => {
    const idx = await User.collection.indexes();
    const byName = Object.fromEntries(idx.map((i) => [i.name, i]));
    assert.deepEqual(byName.account_state_changed.key, { accountState: 1, accountStateChangedAt: 1 });
    assert.deepEqual(
      [...byName.account_state_changed.partialFilterExpression.accountState.$in].sort(),
      [DELETION_PENDING, HARD_SUSPENDED, MUTED].sort(),
      "PERMANENTLY_DELETED is intentionally not indexed (terminal; no specified access path)",
    );
    assert.deepEqual(byName.account_restriction_expiry.key, { "accountRestriction.expiresAt": 1 });
    assert.ok(byName.account_restriction_expiry.partialFilterExpression);
  });

  const winning = (plan) => JSON.stringify(plan.queryPlanner.winningPlan);

  it("the deletion-worker access path and the restriction-expiry sweep use their indexes", async () => {
    for (let i = 0; i < 30; i += 1) await User.create(base());
    await User.create(base(VALID[DELETION_PENDING]));
    await User.create(base(VALID[MUTED]));
    const d = await User.find({ accountState: DELETION_PENDING, accountStateChangedAt: { $lte: T1 } })
      .explain("queryPlanner");
    assert.match(winning(d), /account_state_changed/);
    const e = await User.find({ "accountRestriction.expiresAt": { $lte: T1 } }).explain("queryPlanner");
    assert.match(winning(e), /account_restriction_expiry/);
  });
});
