import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { changeStatus, getIssueActivityLog, getIssueWorkflowView, listIssues } from "../src/services/issue.service.js";
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
  openIssue,
  raw,
  resolvedIssue,
  verifiedIssue,
} from "./helpers/lifecycleFixtures.js";

let w;
const savedThreshold = process.env.SELF_GRANT_EXPERT_THRESHOLD;
before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  w = await makeWorld();
  delete process.env.SELF_GRANT_EXPERT_THRESHOLD;
});
afterEach(() => {
  if (savedThreshold === undefined) delete process.env.SELF_GRANT_EXPERT_THRESHOLD;
  else process.env.SELF_GRANT_EXPERT_THRESHOLD = savedThreshold;
});

const tick = () => new Promise((r) => setTimeout(r, 4));
const types = async (id) => (await raw(id)).remediationHistory.map((e) => e.type);

describe("who may perform each grant operation (ADR-0007 §2)", () => {
  it("grant: EXPERT only — USER, ADMIN and anonymous are rejected", async () => {
    const issue = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.other), issue._id, w.grantee.id), "FORBIDDEN");
    await expectCode(grantRemediation(asActor(w.admin), issue._id, w.grantee.id), "FORBIDDEN");
    await expectCode(grantRemediation(asActor(w.reporter), issue._id, w.grantee.id), "FORBIDDEN");
    await expectCode(grantRemediation(null, issue._id, w.grantee.id), "UNAUTHORIZED");
    assert.equal((await raw(issue._id)).remediation, undefined);
  });

  it("accept/decline/release: only the CURRENT grantee; everyone else (EXPERT, ADMIN, bystander) FORBIDDEN, with or without a grant", async () => {
    const pending = await issueWithPendingGrant(w);
    const none = await acknowledgedIssue(w);
    for (const fn of [acceptRemediation, declineRemediation, releaseRemediation]) {
      for (const who of [w.expert1, w.expert2, w.admin, w.other, w.reporter]) {
        await expectCode(fn(asActor(who), pending._id), "FORBIDDEN");
        await expectCode(fn(asActor(who), none._id), "FORBIDDEN"); // identical: existence of a grant is not revealed
      }
      await expectCode(fn(null, pending._id), "UNAUTHORIZED");
    }
    assert.equal((await raw(pending._id)).remediation.acceptedAt, null);
  });

  it("withdraw: any EXPERT (not the grantee, not ADMIN, not USER); revoke: ADMIN only", async () => {
    const issue = await issueWithPendingGrant(w);
    for (const who of [w.grantee, w.other, w.admin]) {
      await expectCode(withdrawRemediation(asActor(who), issue._id, { note: "x" }), "FORBIDDEN");
    }
    for (const who of [w.expert1, w.expert2, w.grantee, w.other]) {
      await expectCode(revokeRemediation(asActor(who), issue._id, { note: "x" }), "FORBIDDEN");
    }
    assert.ok((await raw(issue._id)).remediation, "nothing was removed");
    await withdrawRemediation(asActor(w.expert2), issue._id, { note: "Reassigning." }); // any EXPERT, not only the grantor
    assert.equal((await raw(issue._id)).remediation, undefined);
  });

  it("ADMIN can revoke a pending or accepted grant, and nothing else in the lifecycle", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await expectCode(changeStatus(asActor(w.admin), issue._id, "in_progress"), "FORBIDDEN");
    const revoked = await revokeRemediation(asActor(w.admin), issue._id, { note: "Abuse report #12." });
    assert.equal(revoked.remediation, undefined);
    assert.equal((await raw(issue._id)).remediationHistory.at(-1).type, "revoked");
  });
});

describe("status constraints (grant operations only in acknowledged / in_progress)", () => {
  it("every operation is INVALID_STATE in open, resolved and verified", async () => {
    const open = await openIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), open._id, w.grantee.id), "INVALID_STATE");

    const resolved = await resolvedIssue(w); // keeps the accepted grant as a record
    const verified = await verifiedIssue(w);
    for (const issue of [resolved, verified]) {
      await expectCode(acceptRemediation(asActor(w.grantee), issue._id), "INVALID_STATE");
      await expectCode(declineRemediation(asActor(w.grantee), issue._id), "INVALID_STATE");
      await expectCode(releaseRemediation(asActor(w.grantee), issue._id), "INVALID_STATE");
      await expectCode(withdrawRemediation(asActor(w.expert1), issue._id, { note: "x" }), "INVALID_STATE");
      await expectCode(revokeRemediation(asActor(w.admin), issue._id, { note: "x" }), "INVALID_STATE");
      await expectCode(grantRemediation(asActor(w.expert1), issue._id, w.other.id), "INVALID_STATE");
      const stored = await raw(issue._id);
      assert.ok(stored.remediation, "the grant is retained unchanged as the record of who was responsible");
    }
  });

  it("grant is allowed in in_progress (re-assignment after the grant was removed)", async () => {
    const issue = await inProgressIssue(w);
    await releaseRemediation(asActor(w.grantee), issue._id);
    assert.equal((await raw(issue._id)).status, "in_progress");
    const regranted = await grantRemediation(asActor(w.expert1), issue._id, w.other.id);
    assert.equal(String(regranted.remediation.actor), w.other.id);
  });

  it("an in_progress issue with no grant cannot be resolved until a new grant is accepted", async () => {
    const issue = await inProgressIssue(w);
    await releaseRemediation(asActor(w.grantee), issue._id);
    await expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "done" }), "FORBIDDEN");
    await grantRemediation(asActor(w.expert1), issue._id, w.other.id);
    await acceptRemediation(asActor(w.other), issue._id);
    const resolved = await changeStatus(asActor(w.other), issue._id, "resolved", { note: "done by new assignee" });
    assert.equal(resolved.status, "resolved");
  });
});

describe("grant lifecycle and the acceptedAt contract", () => {
  it("grant creates a pending grant: acceptedAt null, new grantId, grantedBy/at recorded", async () => {
    const issue = await acknowledgedIssue(w);
    const updated = await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, { note: "  Please take this on. " });
    const stored = await raw(issue._id);
    assert.equal(stored.remediation.acceptedAt, null);
    assert.equal(String(stored.remediation.actor), w.grantee.id);
    assert.equal(String(stored.remediation.grantedBy), w.expert1.id);
    assert.ok(stored.remediation.grantId && stored.remediation.grantedAt);
    assert.equal(stored.remediationHistory.length, 1);
    assert.equal(stored.remediationHistory[0].note, "Please take this on.");
    assert.equal(updated.status, "acknowledged");
  });

  it("accept is one-time and never rewrites grantId, actor, grantedBy or grantedAt", async () => {
    const issue = await issueWithPendingGrant(w);
    const before = (await raw(issue._id)).remediation;
    await acceptRemediation(asActor(w.grantee), issue._id);
    const after = (await raw(issue._id)).remediation;
    assert.ok(after.acceptedAt instanceof Date);
    for (const k of ["grantId", "actor", "grantedBy", "grantedAt"]) assert.deepEqual(after[k], before[k], k);
    await expectCode(acceptRemediation(asActor(w.grantee), issue._id), "INVALID_STATE", { reason: "GRANT_ALREADY_ACCEPTED" });
    assert.equal((await raw(issue._id)).remediationHistory.length, 2, "the failed repeat added no event");
  });

  it("only one grant may exist; unknown/malformed grantee and issue ids are rejected", async () => {
    const issue = await issueWithPendingGrant(w);
    await expectCode(grantRemediation(asActor(w.expert1), issue._id, w.other.id), "INVALID_STATE", { reason: "GRANT_EXISTS" });
    const fresh = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), fresh._id, "507f1f77bcf86cd799439011"), "NOT_FOUND", { resource: "user" });
    await expectCode(grantRemediation(asActor(w.expert1), fresh._id, "not-an-id"), "VALIDATION_FAILED", { field: "granteeId" });
    await expectCode(grantRemediation(asActor(w.expert1), fresh._id, undefined), "VALIDATION_FAILED");
    await expectCode(grantRemediation(asActor(w.expert1), "garbage", w.grantee.id), "VALIDATION_FAILED");
    await expectCode(grantRemediation(asActor(w.expert1), "507f1f77bcf86cd799439011", w.grantee.id), "NOT_FOUND");
  });

  it("decline removes a pending grant; release removes an accepted one; each keeps its event; wrong-state calls are INVALID_STATE", async () => {
    const a = await issueWithPendingGrant(w);
    await expectCode(releaseRemediation(asActor(w.grantee), a._id), "INVALID_STATE", { reason: "GRANT_NOT_ACCEPTED" });
    await declineRemediation(asActor(w.grantee), a._id, { note: "No capacity." });
    assert.equal((await raw(a._id)).remediation, undefined);
    assert.deepEqual(await types(a._id), ["granted", "declined"]);

    const b = await issueWithAcceptedGrant(w);
    await expectCode(declineRemediation(asActor(w.grantee), b._id), "INVALID_STATE", { reason: "GRANT_ALREADY_ACCEPTED" });
    await releaseRemediation(asActor(w.grantee), b._id);
    assert.equal((await raw(b._id)).remediation, undefined);
    assert.deepEqual(await types(b._id), ["granted", "accepted", "released"]);
  });

  it("a replacement grant gets a NEW grantId, and removal never reverts status", async () => {
    const issue = await issueWithPendingGrant(w);
    const first = (await raw(issue._id)).remediation.grantId;
    await declineRemediation(asActor(w.grantee), issue._id);
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id);
    const second = (await raw(issue._id)).remediation.grantId;
    assert.notDeepEqual(first, second);
    assert.equal((await raw(issue._id)).status, "acknowledged");
  });

  it("withdraw and revoke require a reason (server-side) and record the removed grantee and performer", async () => {
    const issue = await issueWithAcceptedGrant(w);
    for (const note of [undefined, "", "  \n ", 7]) {
      await expectCode(withdrawRemediation(asActor(w.expert2), issue._id, { note }), "VALIDATION_FAILED", { field: "note" });
      await expectCode(revokeRemediation(asActor(w.admin), issue._id, { note }), "VALIDATION_FAILED", { field: "note" });
    }
    assert.ok((await raw(issue._id)).remediation, "failed validation removed nothing");
    await withdrawRemediation(asActor(w.expert2), issue._id, { note: "Moving to a closer team." });
    const e = (await raw(issue._id)).remediationHistory.at(-1);
    assert.equal(e.type, "withdrawn");
    assert.equal(String(e.actor), w.expert2.id);
    assert.equal(String(e.grantee), w.grantee.id);
    assert.equal(e.note, "Moving to a closer team.");
    await expectCode(withdrawRemediation(asActor(w.expert2), issue._id, { note: "again" }), "INVALID_STATE", { reason: "NO_GRANT" });
  });

  it("every operation appends exactly one event in the same write and never edits earlier events", async () => {
    const issue = await acknowledgedIssue(w);
    let prev = [];
    const ops = [
      () => grantRemediation(asActor(w.expert1), issue._id, w.grantee.id),
      () => acceptRemediation(asActor(w.grantee), issue._id),
      () => releaseRemediation(asActor(w.grantee), issue._id),
      () => grantRemediation(asActor(w.expert1), issue._id, w.other.id),
      () => declineRemediation(asActor(w.other), issue._id),
      () => grantRemediation(asActor(w.expert2), issue._id, w.grantee.id),
      () => withdrawRemediation(asActor(w.expert1), issue._id, { note: "n" }),
      () => grantRemediation(asActor(w.expert2), issue._id, w.grantee.id),
      () => revokeRemediation(asActor(w.admin), issue._id, { note: "n" }),
    ];
    for (const op of ops) {
      await op();
      const now = (await raw(issue._id)).remediationHistory;
      assert.deepEqual(now.slice(0, prev.length), prev);
      assert.equal(now.length, prev.length + 1);
      prev = now;
    }
    assert.deepEqual(prev.map((e) => e.type), ["granted", "accepted", "released", "granted", "declined", "granted", "withdrawn", "granted", "revoked"]);
  });

  it("optional notes are normalized and bounded; an over-long note is rejected", async () => {
    const issue = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, { note: "x".repeat(2001) }), "VALIDATION_FAILED");
    await expectCode(grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, { note: ["a"] }), "VALIDATION_FAILED");
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, { note: "   " });
    assert.equal((await raw(issue._id)).remediationHistory[0].note, undefined);
  });
});

describe("adaptive self-grant (ADR-0007 §2)", () => {
  async function addExperts(n) {
    for (let i = 0; i < n; i += 1) await makeUser("EXPERT");
  }

  it("allowed iff expertCount < threshold — boundaries at threshold-1, threshold, threshold+1", async () => {
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "4";
    // world has 2 experts -> 2 < 4 allowed
    const a = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), a._id, w.expert1.id);
    // 3 experts (threshold-1): still allowed
    await addExperts(1);
    const b = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), b._id, w.expert1.id);
    // 4 experts (== threshold): forbidden
    await addExperts(1);
    const c = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), c._id, w.expert1.id), "FORBIDDEN", { reason: "SELF_GRANT_NOT_PERMITTED", expertCount: 4, threshold: 4 });
    // 5 experts (threshold+1): forbidden
    await addExperts(1);
    await expectCode(grantRemediation(asActor(w.expert1), c._id, w.expert1.id), "FORBIDDEN", { reason: "SELF_GRANT_NOT_PERMITTED" });
    assert.equal((await raw(c._id)).remediation, undefined);
  });

  it("a grant to a DIFFERENT user is never affected by the threshold", async () => {
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "0";
    await addExperts(10);
    const issue = await acknowledgedIssue(w);
    const g = await grantRemediation(asActor(w.expert1), issue._id, w.expert2.id); // another EXPERT
    assert.equal(String(g.remediation.actor), w.expert2.id);
  });

  it("threshold 0 disables self-grant even for a pool of one", async () => {
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "0";
    await User.deleteOne({ _id: w.expert2.id });
    const issue = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), issue._id, w.expert1.id), "FORBIDDEN", { reason: "SELF_GRANT_NOT_PERMITTED" });
  });

  it("default threshold is 5 when unset", async () => {
    await addExperts(2); // 4 experts total: allowed
    const a = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), a._id, w.expert1.id);
    await addExperts(1); // 5 experts: forbidden
    const b = await acknowledgedIssue(w);
    await expectCode(grantRemediation(asActor(w.expert1), b._id, w.expert1.id), "FORBIDDEN", { reason: "SELF_GRANT_NOT_PERMITTED" });
  });

  it("the self-grant event records its basis privately; ordinary grants record none", async () => {
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "3";
    const a = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), a._id, w.expert1.id);
    const self = (await raw(a._id)).remediationHistory[0];
    assert.equal(self.selfGrant, true);
    assert.equal(self.expertCount, 2);
    assert.equal(self.threshold, 3);
    const b = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), b._id, w.grantee.id);
    const ordinary = (await raw(b._id)).remediationHistory[0];
    assert.equal("selfGrant" in ordinary, false);
    assert.equal("expertCount" in ordinary, false);
  });

  it("acceptance is still a separate explicit step: a self-grant cannot start work until accepted", async () => {
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.expert1.id);
    await expectCode(changeStatus(asActor(w.expert1), issue._id, "in_progress"), "INVALID_STATE", { reason: "GRANT_NOT_ACCEPTED" });
    await acceptRemediation(asActor(w.expert1), issue._id);
    assert.equal((await changeStatus(asActor(w.expert1), issue._id, "in_progress")).status, "in_progress");
  });

  it("changing the threshold or the expert count never affects an existing grant", async () => {
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.expert1.id); // allowed under the default
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "0";
    await addExperts(8);
    await acceptRemediation(asActor(w.expert1), issue._id);
    await changeStatus(asActor(w.expert1), issue._id, "in_progress");
    const resolved = await changeStatus(asActor(w.expert1), issue._id, "resolved", { note: "Done." });
    assert.equal(resolved.status, "resolved");
  });
});

describe("public activity log and workflow views against a real database (ADR-0007 §7–§8)", () => {
  async function fullLifecycle() {
    const issue = await openIssue(w);
    await tick();
    await changeStatus(asActor(w.expert1), issue._id, "acknowledged", { note: "Credible report." });
    await tick();
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, { note: "PRIVATE grant reason" });
    await tick();
    await withdrawRemediation(asActor(w.expert2), issue._id, { note: "PRIVATE withdraw reason" });
    await tick();
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id);
    await tick();
    await acceptRemediation(asActor(w.grantee), issue._id);
    await tick();
    await changeStatus(asActor(w.grantee), issue._id, "in_progress");
    await tick();
    await changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "First repair." });
    await tick();
    await changeStatus(asActor(w.expert2), issue._id, "in_progress", { note: "Not fixed." });
    await tick();
    await changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "Second repair." });
    await tick();
    await changeStatus(asActor(w.expert2), issue._id, "verified", { note: "Confirmed." });
    return issue;
  }

  it("one entry per successful operation, in order, with stable ids and the redaction table applied", async () => {
    const issue = await fullLifecycle();
    const log = await getIssueActivityLog(issue._id);
    assert.deepEqual(
      log.map((e) => e.type),
      [
        "report_submitted",
        "status_changed", // acknowledged
        "responsibility_offered",
        "responsibility_withdrawn",
        "responsibility_offered",
        "responsibility_accepted",
        "status_changed", // started
        "status_changed", // resolved
        "status_changed", // verification failed
        "status_changed", // resolved again
        "status_changed", // verified
      ],
    );
    assert.deepEqual(log.map((e) => e.id), ["h:0", "h:1", "r:0", "r:1", "r:2", "r:3", "h:2", "h:3", "h:4", "h:5", "h:6"]);
    assert.deepEqual(log, await getIssueActivityLog(issue._id), "deterministic and repeatable");

    const text = JSON.stringify(log);
    for (const secret of ["PRIVATE grant reason", "PRIVATE withdraw reason", "grantId", "selfGrant", "expertCount", "threshold"]) {
      assert.ok(!text.includes(secret), `public log must not contain ${secret}`);
    }
    const stored = await raw(issue._id);
    assert.ok(!text.includes(String(stored.remediation.grantId)));
    assert.equal(log[1].note, "Credible report."); // status notes are public
    assert.equal(log[1].actor.name, w.expert1.name);
    assert.equal(log[2].actor, null); // grantee not named before acceptance
    assert.equal(log[5].actor.name, w.grantee.name); // named on acceptance
    assert.equal(log.length, stored.statusHistory.length + stored.remediationHistory.length, "agrees with the histories");
  });

  it("rejected operations produce no log entries", async () => {
    const issue = await acknowledgedIssue(w);
    const before = (await getIssueActivityLog(issue._id)).length;
    await assert.rejects(changeStatus(asActor(w.other), issue._id, "in_progress"));
    await assert.rejects(grantRemediation(asActor(w.other), issue._id, w.grantee.id));
    await assert.rejects(withdrawRemediation(asActor(w.expert1), issue._id, { note: "x" })); // no grant
    assert.equal((await getIssueActivityLog(issue._id)).length, before);
  });

  it("getIssueActivityLog: unknown issue is NOT_FOUND, malformed id is VALIDATION_FAILED; legacy issues work", async () => {
    await expectCode(getIssueActivityLog("507f1f77bcf86cd799439011"), "NOT_FOUND");
    await expectCode(getIssueActivityLog("nope"), "VALIDATION_FAILED");
    const issue = await openIssue(w);
    assert.equal((await getIssueActivityLog(issue._id)).length, 1);
  });

  it("workflow view: participant sees own events (withdraw note hidden), bystander nothing, EXPERT everything, promotion/demotion apply immediately", async () => {
    const issue = await fullLifecycle();
    const view = (viewer) => getIssueWorkflowView(viewer, issue._id);

    const asGrantee = await view(asActor(w.grantee));
    assert.deepEqual(asGrantee.events.map((e) => e.type), ["granted", "withdrawn", "granted", "accepted"]);
    assert.deepEqual(asGrantee.events[1], { type: "withdrawn", performerRole: "EXPERT", timestamp: asGrantee.events[1].timestamp });
    assert.ok(!JSON.stringify(asGrantee).includes("PRIVATE withdraw reason"));
    assert.equal(asGrantee.state, "accepted");

    const asBystander = await view(asActor(w.other));
    assert.deepEqual(asBystander.events, []);
    assert.equal(asBystander.assignee.actor.name, w.grantee.name, "accepted assignee is public");

    const asExpert = await view({ id: w.other.id, role: "EXPERT" }); // promoted
    assert.equal(asExpert.events.length, 4);
    assert.ok(JSON.stringify(asExpert).includes("PRIVATE withdraw reason"));

    const asDemoted = await view({ id: w.expert2.id, role: "USER" }); // performed the withdrawal, now demoted
    assert.deepEqual(asDemoted.events.map((e) => e.type), ["withdrawn"]);
    assert.ok(!JSON.stringify(asDemoted).includes("PRIVATE withdraw reason"));

    await expectCode(getIssueWorkflowView(null, issue._id), "UNAUTHORIZED");
  });

  it("workflow view does not reveal a PENDING grant to an unrelated user, and participants never get grantId or policy basis", async () => {
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "5";
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.expert1.id); // self-grant: carries the private policy basis
    const stored = await raw(issue._id);
    assert.equal(stored.remediationHistory[0].selfGrant, true, "precondition: the stored event has the private basis");

    const unrelated = await getIssueWorkflowView(asActor(w.other), issue._id);
    assert.equal(unrelated.state, "unassigned");
    assert.equal(unrelated.pending, null);
    assert.deepEqual(unrelated.events, []);
    const none = await getIssueWorkflowView(asActor(w.other), (await acknowledgedIssue(w))._id);
    assert.deepEqual(unrelated, none, "indistinguishable from an issue with no grant");

    const asGrantor = await getIssueWorkflowView({ id: w.expert1.id, role: "USER" }, issue._id); // participation only
    assert.equal(asGrantor.state, "pending");
    const text = JSON.stringify(asGrantor);
    for (const field of ["grantId", "selfGrant", "expertCount", "threshold"]) assert.ok(!text.includes(`"${field}"`), field);

    const asExpert = await getIssueWorkflowView(asActor(w.expert2), issue._id); // role-based
    assert.equal(asExpert.events[0].selfGrant, true);
    assert.ok(asExpert.events[0].grantId);
  });

  it("list payloads and serialized issues never carry remediation fields", async () => {
    const issue = await fullLifecycle();
    await Issue.updateOne({ _id: issue._id }, { $set: { remediationHistory: (await raw(issue._id)).remediationHistory } });
    const list = await listIssues({});
    const text = JSON.stringify(list);
    assert.ok(!text.includes("remediation"), "no remediation key in the public list payload");
    assert.ok(!text.includes("PRIVATE"));
    assert.ok(text.includes("Second repair."), "status notes remain public");
  });
});
