import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { changeStatus } from "../src/services/issue.service.js";
import {
  acceptRemediation,
  declineRemediation,
  grantRemediation,
  releaseRemediation,
  revokeRemediation,
  withdrawRemediation,
} from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  asActor,
  acknowledgedIssue,
  expectCode,
  inProgressIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  makeUser,
  makeWorld,
  raw,
  resolvedIssue,
  withInterleave,
} from "./helpers/lifecycleFixtures.js";

/**
 * ADR-0007 / ADR-0006 concurrency guarantees, proven against REAL MongoDB.
 *
 * Two techniques:
 *  - natural concurrency (`Promise.all`) for "exactly one wins" properties;
 *  - DETERMINISTIC interleaving: a hook runs between a service's pre-read and
 *    its write, i.e. inside the window a stale snapshot is exposed to. This is
 *    the only way to prove ABA-style races (state returns to a value the
 *    pre-read already saw) — a mock would prove nothing about atomicity.
 */

let w;
before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  w = await makeWorld();
});

const grantIdOf = async (id) => String((await raw(id)).remediation?.grantId);
const eventTypes = async (id) => (await raw(id)).remediationHistory.map((e) => e.type);

describe("natural concurrency: exactly one writer wins", () => {
  it("concurrent grants to different grantees: exactly one succeeds, one event, one grant", async () => {
    const issue = await acknowledgedIssue(w);
    const candidates = [];
    for (let i = 0; i < 8; i += 1) candidates.push(await makeUser("USER", "cand"));
    const results = await Promise.allSettled(candidates.map((c) => grantRemediation(asActor(w.expert1), issue._id, c.id)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1, "exactly one grant is created");
    for (const f of failed) assert.ok(["STATE_RACE", "INVALID_STATE"].includes(f.reason.code), f.reason.code);
    const stored = await raw(issue._id);
    assert.equal(stored.remediationHistory.length, 1);
    assert.equal(String(stored.remediation.actor), String(ok[0].value.remediation.actor));
  });

  it("concurrent double-accept by the grantee: exactly one succeeds, one accepted event", async () => {
    const issue = await issueWithPendingGrant(w);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => acceptRemediation(asActor(w.grantee), issue._id)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(await eventTypes(issue._id), ["granted", "accepted"]);
  });

  it("concurrent double-start by the grantee: exactly one transition, one history entry", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const results = await Promise.allSettled([1, 2, 3].map(() => changeStatus(asActor(w.grantee), issue._id, "in_progress")));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const stored = await raw(issue._id);
    assert.equal(stored.statusHistory.filter((h) => h.toStatus === "in_progress").length, 1);
  });

  it("withdraw racing start: outcomes are always consistent (never a start that the grant did not authorize)", async () => {
    for (let round = 0; round < 8; round += 1) {
      await clearCollections();
      w = await makeWorld();
      const issue = await issueWithAcceptedGrant(w);
      const [start, withdraw] = await Promise.allSettled([
        changeStatus(asActor(w.grantee), issue._id, "in_progress"),
        withdrawRemediation(asActor(w.expert2), issue._id, { note: "racing" }),
      ]);
      const stored = await raw(issue._id);
      const started = start.status === "fulfilled";
      assert.equal(stored.status, started ? "in_progress" : "acknowledged");
      assert.equal(stored.statusHistory.filter((h) => h.toStatus === "in_progress").length, started ? 1 : 0);
      if (withdraw.status === "fulfilled") assert.equal(stored.remediation, undefined);
      assert.ok(start.status === "fulfilled" || withdraw.status === "fulfilled", "at least one of them wins");
      if (start.status === "rejected") assert.equal(start.reason.code, "STATE_RACE");
    }
  });
});

describe("deterministic: a stale operation can never act on a REPLACEMENT grant (ABA, ADR-0007 §4)", () => {
  /**
   * Replace grant G1 with G2 (to the SAME user, the worst case for an
   * actor-only match) between a service's pre-read and its write.
   */
  async function replaceGrant(issueId, { accepted = false, removedBy = "withdraw" } = {}) {
    if (removedBy === "withdraw") await withdrawRemediation(asActor(w.expert2), issueId, { note: "reassigning" });
    else if (removedBy === "decline") await declineRemediation(asActor(w.grantee), issueId);
    else if (removedBy === "release") await releaseRemediation(asActor(w.grantee), issueId);
    await grantRemediation(asActor(w.expert2), issueId, w.grantee.id);
    if (accepted) await acceptRemediation(asActor(w.grantee), issueId);
  }

  it("stale withdraw (EXPERT) cannot remove the replacement grant", async () => {
    const issue = await issueWithPendingGrant(w);
    const g1 = await grantIdOf(issue._id);
    await withInterleave(
      () => replaceGrant(issue._id, { removedBy: "decline" }),
      () => expectCode(withdrawRemediation(asActor(w.expert1), issue._id, { note: "stale" }), "STATE_RACE"),
    );
    const g2 = await grantIdOf(issue._id);
    assert.notEqual(g1, g2);
    assert.equal(String((await raw(issue._id)).remediation.actor), w.grantee.id, "replacement grant intact");
    assert.ok(!(await eventTypes(issue._id)).includes("withdrawn") || (await eventTypes(issue._id)).filter((t) => t === "withdrawn").length === 0);
  });

  it("stale revoke (ADMIN) cannot remove the replacement grant", async () => {
    const issue = await issueWithPendingGrant(w);
    await withInterleave(
      () => replaceGrant(issue._id, { removedBy: "decline" }),
      () => expectCode(revokeRemediation(asActor(w.admin), issue._id, { note: "stale" }), "STATE_RACE"),
    );
    assert.ok((await raw(issue._id)).remediation, "replacement grant intact");
    assert.ok(!(await eventTypes(issue._id)).includes("revoked"));
  });

  it("stale accept cannot accept the replacement grant", async () => {
    const issue = await issueWithPendingGrant(w);
    await withInterleave(
      () => replaceGrant(issue._id, { removedBy: "withdraw" }),
      () => expectCode(acceptRemediation(asActor(w.grantee), issue._id), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).remediation.acceptedAt, null, "replacement grant is still pending");
  });

  it("stale decline cannot remove the replacement grant", async () => {
    const issue = await issueWithPendingGrant(w);
    await withInterleave(
      () => replaceGrant(issue._id, { removedBy: "withdraw" }),
      () => expectCode(declineRemediation(asActor(w.grantee), issue._id), "STATE_RACE"),
    );
    assert.ok((await raw(issue._id)).remediation);
    assert.ok(!(await eventTypes(issue._id)).includes("declined"));
  });

  it("stale release cannot remove the replacement (accepted) grant", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await withInterleave(
      () => replaceGrant(issue._id, { removedBy: "withdraw", accepted: true }),
      () => expectCode(releaseRemediation(asActor(w.grantee), issue._id), "STATE_RACE"),
    );
    assert.ok((await raw(issue._id)).remediation.acceptedAt, "replacement grant intact and accepted");
    assert.ok(!(await eventTypes(issue._id)).includes("released"));
  });

  for (const replacementAccepted of [false, true]) {
    it(`stale START by the grantee fails even when the replacement grant is ${replacementAccepted ? "accepted" : "pending"}`, async () => {
      const issue = await issueWithAcceptedGrant(w);
      await withInterleave(
        () => replaceGrant(issue._id, { removedBy: "release", accepted: replacementAccepted }),
        () => expectCode(changeStatus(asActor(w.grantee), issue._id, "in_progress"), "STATE_RACE"),
      );
      const stored = await raw(issue._id);
      assert.equal(stored.status, "acknowledged", "no transition happened");
      assert.equal(stored.statusHistory.filter((h) => h.toStatus === "in_progress").length, 0);
    });

    it(`stale RESOLVE by the grantee fails even when the replacement grant is ${replacementAccepted ? "accepted" : "pending"}`, async () => {
      const issue = await inProgressIssue(w);
      await withInterleave(
        () => replaceGrant(issue._id, { removedBy: "release", accepted: replacementAccepted }),
        () => expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "stale resolution" }), "STATE_RACE"),
      );
      const stored = await raw(issue._id);
      assert.equal(stored.status, "in_progress");
      assert.equal(stored.statusHistory.filter((h) => h.toStatus === "resolved").length, 0);
    });
  }
});

describe("deterministic: removing the grant between the pre-read and the write defeats the transition", () => {
  it("release between start's pre-read and write ⇒ STATE_RACE, never FORBIDDEN, no transition", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await withInterleave(
      () => releaseRemediation(asActor(w.grantee), issue._id),
      () => expectCode(changeStatus(asActor(w.grantee), issue._id, "in_progress"), "STATE_RACE"),
    );
    const stored = await raw(issue._id);
    assert.equal(stored.status, "acknowledged");
    assert.equal(stored.remediation, undefined);
    assert.deepEqual(await eventTypes(issue._id), ["granted", "accepted", "released"]);
  });

  it("withdraw between resolve's pre-read and write ⇒ STATE_RACE, no transition", async () => {
    const issue = await inProgressIssue(w);
    await withInterleave(
      () => withdrawRemediation(asActor(w.expert2), issue._id, { note: "stop work" }),
      () => expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "done" }), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).status, "in_progress");
  });

  it("revoke between start's pre-read and write ⇒ STATE_RACE", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await withInterleave(
      () => revokeRemediation(asActor(w.admin), issue._id, { note: "governance" }),
      () => expectCode(changeStatus(asActor(w.grantee), issue._id, "in_progress"), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).status, "acknowledged");
  });

  it("a zero-match write never reports FORBIDDEN, even though the actor is no longer authorized", async () => {
    const issue = await issueWithAcceptedGrant(w);
    let code;
    await withInterleave(
      () => releaseRemediation(asActor(w.grantee), issue._id),
      async () => {
        code = await changeStatus(asActor(w.grantee), issue._id, "in_progress").then(() => "ok", (e) => e.code);
      },
    );
    assert.equal(code, "STATE_RACE");
    // a FRESH attempt (new pre-read) is correctly FORBIDDEN
    await expectCode(changeStatus(asActor(w.grantee), issue._id, "in_progress"), "FORBIDDEN");
  });
});

describe("M2: status ABA race — the statusHistory length guard (concurrency correctness requirement)", () => {
  /** Direct writes simulate OTHER actors' committed transitions inside the race window. */
  const push = (id, from, to, actor) =>
    Issue.updateOne({ _id: id }, { $set: { status: to }, $push: { statusHistory: { fromStatus: from, toStatus: to, actor, timestamp: new Date() } } });

  it("REPRODUCES the self-verification race and proves it is closed: stale verify by the NEW resolver fails with STATE_RACE", async () => {
    // Resolver A resolved the issue (history says: resolver = A).
    const issue = await resolvedIssue(w, { grantee: w.grantee });
    const resolverA = w.grantee;
    const verifierB = w.expert1; // an independent EXPERT at pre-read time
    // Stale verification by B is based on "resolver is A". Before it writes:
    //  1. another EXPERT rejects the resolution (resolved -> in_progress),
    //  2. B ITSELF resolves it again (in_progress -> resolved)  => B is now the resolver.
    await withInterleave(
      async () => {
        await push(issue._id, "resolved", "in_progress", w.expert2.id);
        await push(issue._id, "in_progress", "resolved", verifierB.id);
      },
      () => expectCode(changeStatus(asActor(verifierB), issue._id, "verified", { note: "self-verification attempt" }), "STATE_RACE"),
    );
    const stored = await raw(issue._id);
    assert.equal(stored.status, "resolved", "must NOT become verified by its own resolver");
    assert.equal(stored.statusHistory.at(-1).toStatus, "resolved");
    assert.equal(String(stored.statusHistory.at(-1).actor), verifierB.id);
    assert.equal(stored.statusHistory.filter((h) => h.toStatus === "verified").length, 0);
    assert.notEqual(String(resolverA.id), verifierB.id);
  });

  it("the stale verification by an INDEPENDENT expert also fails: the guard is general, not a special case", async () => {
    const issue = await resolvedIssue(w);
    await withInterleave(
      async () => {
        await push(issue._id, "resolved", "in_progress", w.expert2.id);
        await push(issue._id, "in_progress", "resolved", w.grantee.id);
      },
      () => expectCode(changeStatus(asActor(w.expert1), issue._id, "verified", { note: "stale but independent" }), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).status, "resolved");
  });

  it("after the race a FRESH verification by the same actor is correctly judged against the NEW history", async () => {
    const issue = await resolvedIssue(w);
    await withInterleave(
      async () => {
        await push(issue._id, "resolved", "in_progress", w.expert2.id);
        await push(issue._id, "in_progress", "resolved", w.expert1.id); // expert1 is now the resolver
      },
      () => expectCode(changeStatus(asActor(w.expert1), issue._id, "verified", { note: "x" }), "STATE_RACE"),
    );
    await expectCode(changeStatus(asActor(w.expert1), issue._id, "verified", { note: "x" }), "FORBIDDEN"); // self-verification, now visible
    const ok = await changeStatus(asActor(w.expert2), issue._id, "verified", { note: "independent" });
    assert.equal(ok.status, "verified");
  });

  it("every transition pins the history length: stale resolve (status unchanged, history grew) ⇒ STATE_RACE", async () => {
    const issue = await inProgressIssue(w);
    await withInterleave(
      async () => {
        await push(issue._id, "in_progress", "resolved", w.grantee.id);
        await push(issue._id, "resolved", "in_progress", w.expert2.id); // back to in_progress: same status as the pre-read
      },
      () => expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "stale" }), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).status, "in_progress");
  });

  it("stale failed-verification (resolved -> in_progress) after a reject+resolve loop ⇒ STATE_RACE", async () => {
    const issue = await resolvedIssue(w);
    await withInterleave(
      async () => {
        await push(issue._id, "resolved", "in_progress", w.expert2.id);
        await push(issue._id, "in_progress", "resolved", w.grantee.id);
      },
      () => expectCode(changeStatus(asActor(w.expert1), issue._id, "in_progress", { note: "stale rejection" }), "STATE_RACE"),
    );
    assert.equal((await raw(issue._id)).status, "resolved");
  });

  it("start and acknowledge also pin the history length (any extra recorded transition defeats a stale write)", async () => {
    const open = await (await import("./helpers/lifecycleFixtures.js")).openIssue(w);
    await withInterleave(
      () => Issue.updateOne({ _id: open._id }, { $push: { statusHistory: { fromStatus: "open", toStatus: "open", actor: w.expert2.id, timestamp: new Date() } } }),
      () => expectCode(changeStatus(asActor(w.expert1), open._id, "acknowledged"), "STATE_RACE"),
    );
    assert.equal((await raw(open._id)).status, "open");

    const ack = await issueWithAcceptedGrant(w);
    await withInterleave(
      () => Issue.updateOne({ _id: ack._id }, { $push: { statusHistory: { fromStatus: "acknowledged", toStatus: "acknowledged", actor: w.expert2.id, timestamp: new Date() } } }),
      () => expectCode(changeStatus(asActor(w.grantee), ack._id, "in_progress"), "STATE_RACE"),
    );
    assert.equal((await raw(ack._id)).status, "acknowledged");
  });

  it("normal, uncontended transitions are unaffected by the guard", async () => {
    const issue = await resolvedIssue(w);
    const verified = await changeStatus(asActor(w.expert2), issue._id, "verified", { note: "fine" });
    assert.equal(verified.status, "verified");
  });
});
