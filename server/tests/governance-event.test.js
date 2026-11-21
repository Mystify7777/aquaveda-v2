import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { GovernanceEvent, IMMUTABLE_ERROR_CODE } from "../src/models/GovernanceEvent.js";
import { User } from "../src/models/User.js";
import { ACCOUNT_STATES } from "../src/domain/account-state.js";
import {
  ACTION_SPECS,
  ACTOR_TYPES,
  GOVERNANCE_ACTIONS,
  MAX_REFERENCES,
  REASON_MAX_LENGTH,
  SAFE_REASON_MAX_LENGTH,
  validateGovernanceEventInput,
} from "../src/domain/governance-event.js";
import * as governanceService from "../src/services/governance-event.service.js";
import { toAffectedUserGovernanceEvent } from "../src/services/governance-event.dto.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

const { recordGovernanceEvent, getGovernanceEvent } = governanceService;
const { ACTIVE, MUTED, HARD_SUSPENDED, DELETION_PENDING, PERMANENTLY_DELETED } = ACCOUNT_STATES;

before(async () => {
  await setupTestDb();
  await GovernanceEvent.init();
});
after(teardownTestDb);
beforeEach(clearCollections);

const oid = () => new mongoose.Types.ObjectId();
let n = 0;
const key = () => `test:${Date.now()}:${n++}`;

/** A valid input for each action. */
const VALID = {
  MUTE: { previousState: ACTIVE, resultingState: MUTED },
  MUTE_LIFTED: { previousState: MUTED, resultingState: ACTIVE },
  HARD_SUSPEND: { previousState: ACTIVE, resultingState: HARD_SUSPENDED },
  SUSPENSION_LIFTED: { previousState: HARD_SUSPENDED, resultingState: ACTIVE },
  APPEAL_SUBMITTED: { previousState: HARD_SUSPENDED, resultingState: HARD_SUSPENDED },
  APPEAL_RESOLVED: { previousState: HARD_SUSPENDED, resultingState: ACTIVE },
  ACCOUNT_DELETION_REQUESTED: { previousState: ACTIVE, resultingState: DELETION_PENDING },
  ACCOUNT_RECOVERED: { previousState: DELETION_PENDING, resultingState: ACTIVE },
  ACCOUNT_PERMANENTLY_DELETED: { previousState: DELETION_PENDING, resultingState: PERMANENTLY_DELETED },
  EXPERT_REVOKED: { previousState: "EXPERT", resultingState: "USER", reason: "Credentials lapsed" },
  EXPERT_RESTORED: { previousState: "USER", resultingState: "EXPERT" },
};
const make = (action, extra = {}) => ({
  idempotencyKey: key(),
  action,
  actorType: ACTOR_TYPES.USER,
  actor: oid(),
  target: oid(),
  ...VALID[action],
  ...extra,
});

describe("validateGovernanceEventInput (pure)", () => {
  it("covers exactly the eleven required event families", () => {
    assert.deepEqual(Object.keys(GOVERNANCE_ACTIONS).sort(), Object.keys(VALID).sort());
    assert.deepEqual(Object.keys(ACTION_SPECS).sort(), Object.keys(VALID).sort());
    assert.equal(Object.keys(GOVERNANCE_ACTIONS).length, 11);
  });

  it("validates event shape only, NOT lifecycle legality (that is the mutation services' job)", () => {
    // Well-formed events that the account lifecycle would never permit. The
    // audit validator deliberately accepts them: it records facts and does not
    // decide whether they were allowed. #174-#180 must not generate them.
    assert.deepEqual(validateGovernanceEventInput(make("HARD_SUSPEND", { previousState: PERMANENTLY_DELETED })), []);
    assert.deepEqual(validateGovernanceEventInput(make("MUTE_LIFTED", { resultingState: PERMANENTLY_DELETED })), []);
    // ...while facts that follow from the action's own name are still enforced.
    assert.ok(validateGovernanceEventInput(make("HARD_SUSPEND", { resultingState: ACTIVE })).length > 0);
  });

  for (const action of Object.keys(VALID)) {
    it(`accepts a valid ${action}`, () => assert.deepEqual(validateGovernanceEventInput(make(action)), []));
  }

  it("accepts system-performed events (server-side expiry / worker) without an actor", () => {
    assert.deepEqual(
      validateGovernanceEventInput(make("MUTE_LIFTED", { actorType: ACTOR_TYPES.SYSTEM, actor: undefined })),
      [],
    );
  });

  const INVALID = [
    ["unknown action", make("MUTE", { action: "BAN" })],
    ["missing idempotencyKey", make("MUTE", { idempotencyKey: undefined })],
    ["idempotencyKey with spaces", make("MUTE", { idempotencyKey: "a b" })],
    ["missing actorType", make("MUTE", { actorType: undefined })],
    ["USER without actor", make("MUTE", { actor: undefined })],
    ["SYSTEM with an actor", make("MUTE", { actorType: ACTOR_TYPES.SYSTEM })],
    ["missing target", make("MUTE", { target: undefined })],
    ["malformed target", make("MUTE", { target: "nope" })],
    ["missing previousState", make("MUTE", { previousState: undefined })],
    ["unknown account state", make("MUTE", { previousState: "BANNED" })],
    ["MUTE not resulting in MUTED", make("MUTE", { resultingState: HARD_SUSPENDED })],
    ["MUTE_LIFTED not from MUTED", make("MUTE_LIFTED", { previousState: ACTIVE })],
    ["HARD_SUSPEND not resulting in HARD_SUSPENDED", make("HARD_SUSPEND", { resultingState: MUTED })],
    ["SUSPENSION_LIFTED not from HARD_SUSPENDED", make("SUSPENSION_LIFTED", { previousState: MUTED })],
    ["ACCOUNT_RECOVERED not from DELETION_PENDING", make("ACCOUNT_RECOVERED", { previousState: ACTIVE })],
    ["ACCOUNT_PERMANENTLY_DELETED wrong result", make("ACCOUNT_PERMANENTLY_DELETED", { resultingState: ACTIVE })],
    ["EXPERT_REVOKED with an account state", make("EXPERT_REVOKED", { previousState: ACTIVE })],
    ["EXPERT_REVOKED without a reason", make("EXPERT_REVOKED", { reason: undefined })],
    ["EXPERT_REVOKED with a whitespace reason", make("EXPERT_REVOKED", { reason: "   " })],
    ["over-long reason", make("MUTE", { reason: "x".repeat(REASON_MAX_LENGTH + 1) })],
    ["over-long safeReason", make("MUTE", { safeReason: "x".repeat(SAFE_REASON_MAX_LENGTH + 1) })],
    ["whitespace safeReason", make("MUTE", { safeReason: " " })],
    ["too many references", make("MUTE", { references: Array.from({ length: MAX_REFERENCES + 1 }, () => ({ type: "EVENT", id: oid() })) })],
    ["malformed reference type", make("MUTE", { references: [{ type: "event", id: oid() }] })],
    ["malformed reference id", make("MUTE", { references: [{ type: "EVENT", id: "x" }] })],
    ["invalid occurredAt", make("MUTE", { occurredAt: "yesterday" })],
  ];
  for (const [name, input] of INVALID) {
    it(`rejects: ${name}`, () => assert.ok(validateGovernanceEventInput(input).length > 0));
  }
});

describe("recordGovernanceEvent — creation", () => {
  it("persists every event family with all required fields", async () => {
    for (const action of Object.keys(VALID)) {
      const input = make(action, { reason: "private-reason", safeReason: "safe", occurredAt: new Date("2026-06-01T00:00:00Z") });
      const { event, created } = await recordGovernanceEvent(input);
      assert.equal(created, true);
      const raw = await GovernanceEvent.collection.findOne({ _id: event._id });
      assert.equal(raw.action, action);
      assert.equal(raw.actorType, "USER");
      assert.equal(String(raw.actor), String(input.actor));
      assert.equal(String(raw.target), String(input.target));
      assert.equal(raw.previousState, input.previousState);
      assert.equal(raw.resultingState, input.resultingState);
      assert.equal(raw.reason, "private-reason");
      assert.equal(raw.safeReason, "safe");
      assert.deepEqual(raw.occurredAt, new Date("2026-06-01T00:00:00Z"));
      assert.ok(raw.createdAt);
      assert.equal("updatedAt" in raw, false, "events are never updated, so carry no updatedAt");
    }
    assert.equal(await GovernanceEvent.collection.countDocuments(), 11);
  });

  it("stores a system event without an actor, and defaults occurredAt", async () => {
    const { event } = await recordGovernanceEvent(make("MUTE_LIFTED", { actorType: ACTOR_TYPES.SYSTEM, actor: undefined }));
    const raw = await GovernanceEvent.collection.findOne({ _id: event._id });
    assert.equal(raw.actorType, "SYSTEM");
    assert.equal("actor" in raw, false);
    assert.ok(raw.occurredAt instanceof Date);
  });

  it("rejects invalid input with VALIDATION_FAILED and stores nothing", async () => {
    await assert.rejects(() => recordGovernanceEvent(make("EXPERT_REVOKED", { reason: undefined })), {
      code: DomainErrorCode.VALIDATION_FAILED,
    });
    assert.equal(await GovernanceEvent.collection.countDocuments(), 0);
  });

  it("a governance action can reference its audit event (id returned, resolvable, referenceable)", async () => {
    const target = oid();
    const { event: suspend } = await recordGovernanceEvent(make("HARD_SUSPEND", { target }));
    const { event: lift } = await recordGovernanceEvent(
      make("SUSPENSION_LIFTED", { target, references: [{ type: "EVENT", id: suspend._id }] }),
    );
    const resolved = await getGovernanceEvent(suspend._id);
    assert.equal(resolved.action, "HARD_SUSPEND");
    assert.equal(String(lift.references[0].id), String(suspend._id));
    await assert.rejects(() => getGovernanceEvent(oid()), { code: DomainErrorCode.NOT_FOUND });
    await assert.rejects(() => getGovernanceEvent("not-an-id"), { code: DomainErrorCode.VALIDATION_FAILED });
  });
});

describe("recordGovernanceEvent — retry / duplicate behavior", () => {
  it("same key + same content returns the original and stores one event (occurredAt of the first wins)", async () => {
    const input = make("MUTE", { reason: "r", occurredAt: new Date("2026-01-01T00:00:00Z") });
    const first = await recordGovernanceEvent(input);
    const retry = await recordGovernanceEvent({ ...input, occurredAt: new Date("2026-09-09T00:00:00Z") });
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(String(retry.event._id), String(first.event._id));
    assert.deepEqual(retry.event.occurredAt, new Date("2026-01-01T00:00:00Z"));
    assert.equal(await GovernanceEvent.collection.countDocuments(), 1);
  });

  it("same key with different content is rejected and the stored event is unchanged", async () => {
    const input = make("MUTE", { reason: "original" });
    await recordGovernanceEvent(input);
    await assert.rejects(
      () => recordGovernanceEvent({ ...input, reason: "different" }),
      (err) => err.code === DomainErrorCode.INVALID_STATE && err.details.reason === "IDEMPOTENCY_KEY_CONFLICT",
    );
    await assert.rejects(
      () => recordGovernanceEvent({ ...input, target: oid() }),
      (err) => err.details?.reason === "IDEMPOTENCY_KEY_CONFLICT",
    );
    const raw = await GovernanceEvent.collection.findOne({ idempotencyKey: input.idempotencyKey });
    assert.equal(raw.reason, "original");
    assert.equal(await GovernanceEvent.collection.countDocuments(), 1);
  });

  it("different keys for otherwise identical actions are distinct events", async () => {
    const base = make("MUTE");
    await recordGovernanceEvent(base);
    await recordGovernanceEvent({ ...base, idempotencyKey: key() });
    assert.equal(await GovernanceEvent.collection.countDocuments(), 2);
  });

  it("concurrent identical retries (real race) produce exactly one event", async () => {
    const input = make("HARD_SUSPEND", { reason: "race" });
    const results = await Promise.all(Array.from({ length: 12 }, () => recordGovernanceEvent(input)));
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(new Set(results.map((r) => String(r.event._id))).size, 1);
    assert.equal(await GovernanceEvent.collection.countDocuments(), 1);
  });
});

describe("immutability at the application boundary", () => {
  async function seed() {
    const { event } = await recordGovernanceEvent(make("MUTE", { reason: "orig", safeReason: "orig-safe" }));
    return { id: event._id, before: await GovernanceEvent.collection.findOne({ _id: event._id }) };
  }
  const unchanged = async ({ id, before }) => {
    assert.deepEqual(await GovernanceEvent.collection.findOne({ _id: id }), before);
  };
  const immutable = (err) => err.code === IMMUTABLE_ERROR_CODE;

  const ATTEMPTS = {
    "save of a modified existing event": async (id) => {
      const doc = await GovernanceEvent.findById(id);
      doc.reason = "tampered";
      doc.action = "HARD_SUSPEND";
      return doc.save();
    },
    "save of an unmodified existing event": async (id) => (await GovernanceEvent.findById(id)).save(),
    "updateOne": (id) => GovernanceEvent.updateOne({ _id: id }, { $set: { reason: "x" } }),
    "updateMany": () => GovernanceEvent.updateMany({}, { $set: { reason: "x" } }),
    "findOneAndUpdate": (id) => GovernanceEvent.findOneAndUpdate({ _id: id }, { $set: { reason: "x" } }),
    "replaceOne": (id) => GovernanceEvent.replaceOne({ _id: id }, { action: "MUTE" }),
    "findOneAndReplace": (id) => GovernanceEvent.findOneAndReplace({ _id: id }, { action: "MUTE" }),
    "deleteOne (query)": (id) => GovernanceEvent.deleteOne({ _id: id }),
    "deleteMany": () => GovernanceEvent.deleteMany({}),
    "findOneAndDelete": (id) => GovernanceEvent.findOneAndDelete({ _id: id }),
    "findByIdAndDelete": (id) => GovernanceEvent.findByIdAndDelete(id),
    "document.deleteOne()": async (id) => (await GovernanceEvent.findById(id)).deleteOne(),
    "document.updateOne()": async (id) => (await GovernanceEvent.findById(id)).updateOne({ $set: { reason: "x" } }),
    "bulkWrite update": (id) => GovernanceEvent.bulkWrite([{ updateOne: { filter: { _id: id }, update: { $set: { reason: "x" } } } }]),
    "bulkWrite delete": (id) => GovernanceEvent.bulkWrite([{ deleteOne: { filter: { _id: id } } }]),
  };
  for (const [name, attempt] of Object.entries(ATTEMPTS)) {
    it(`rejects ${name} and leaves the event untouched`, async () => {
      const s = await seed();
      await assert.rejects(() => attempt(s.id), immutable);
      await unchanged(s);
    });
  }

  it("assigning to an immutable path on a loaded document is ignored", async () => {
    const s = await seed();
    const doc = await GovernanceEvent.findById(s.id);
    doc.reason = "tampered";
    assert.equal(doc.reason, "orig");
  });

  it("the service exposes only append and read-by-id (no update/delete API)", () => {
    assert.deepEqual(Object.keys(governanceService).sort(), ["getGovernanceEvent", "recordGovernanceEvent"]);
  });

  it("appending (create / insertMany) remains allowed", async () => {
    await GovernanceEvent.insertMany([
      { ...make("MUTE"), occurredAt: new Date() },
      { ...make("HARD_SUSPEND"), occurredAt: new Date() },
    ]);
    assert.equal(await GovernanceEvent.collection.countDocuments(), 2);
  });
});

describe("privacy and separation from account state", () => {
  it("toJSON never exposes the private reason or idempotency key", async () => {
    const { event } = await recordGovernanceEvent(make("HARD_SUSPEND", { reason: "PRIVATE-NOTE", safeReason: "visible" }));
    const json = JSON.parse(JSON.stringify(await GovernanceEvent.findById(event._id)));
    assert.equal("reason" in json, false);
    assert.equal("idempotencyKey" in json, false);
    assert.equal(json.safeReason, "visible");
  });

  it("the affected-user projection is an explicit allowlist with no private data", async () => {
    const input = make("HARD_SUSPEND", { reason: "PRIVATE-NOTE", safeReason: "Please review the guidelines." });
    const { event } = await recordGovernanceEvent(input);
    const view = toAffectedUserGovernanceEvent(event);
    assert.deepEqual(Object.keys(view).sort(), ["action", "id", "occurredAt", "safeReason"]);
    const wire = JSON.stringify(view);
    for (const secret of ["PRIVATE-NOTE", String(input.actor), input.idempotencyKey, "previousState", "references"]) {
      assert.equal(wire.includes(secret), false, secret);
    }
    const noSafe = await recordGovernanceEvent(make("MUTE", { reason: "x" }));
    assert.equal(toAffectedUserGovernanceEvent(noSafe.event).safeReason, null);
  });

  it("recording an event never touches the target's User document, and User stores no history", async () => {
    const user = await User.create({ name: "T", email: `ev-${Date.now()}@example.test`, passwordHash: "h" });
    const before = await User.collection.findOne({ _id: user._id });
    await recordGovernanceEvent(make("HARD_SUSPEND", { target: user._id }));
    assert.deepEqual(await User.collection.findOne({ _id: user._id }), before);
    const governanceLike = Object.keys(User.schema.paths).filter(
      (path) => !path.startsWith("expertApplication") && /history|audit|event/i.test(path),
    );
    assert.deepEqual(governanceLike, [], "governance history must not live on User");
  });
});

describe("indexes", () => {
  it("has a unique idempotencyKey index and a target-history index that serves history queries", async () => {
    const byName = Object.fromEntries((await GovernanceEvent.collection.indexes()).map((i) => [i.name, i]));
    assert.equal(byName.governance_event_idempotency.unique, true);
    assert.deepEqual(byName.governance_event_target_history.key, { target: 1, occurredAt: -1, _id: -1 });
    for (let i = 0; i < 20; i += 1) await recordGovernanceEvent(make("MUTE"));
    const plan = await GovernanceEvent.find({ target: oid() }).sort({ occurredAt: -1, _id: -1 }).explain("queryPlanner");
    assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /governance_event_target_history/);
  });
});
