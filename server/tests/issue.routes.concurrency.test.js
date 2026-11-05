import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { changeStatus } from "../src/services/issue.service.js";
import { acceptRemediation, grantRemediation, withdrawRemediation } from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  acknowledgedIssue,
  asActor,
  inProgressIssue,
  resolvedIssue,
  withInterleave,
} from "./helpers/lifecycleFixtures.js";
import { makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";

/**
 * Concurrency through the HTTP boundary, against REAL MongoDB (#142).
 * Atomicity itself is owned by the domain (ADR-0006/0007, REM-L4/L12); these
 * prove the routes expose it faithfully: a stale request fails with 409 and
 * mutates nothing, and a zero-match write is never reported as 403.
 */

let app;
let w;

before(async () => {
  await setupTestDb();
  app = await startIssueHttpApp();
});
after(async () => {
  await app.close();
  await teardownTestDb();
});
beforeEach(async () => {
  await clearCollections();
  w = await makeHttpWorld();
});

const post = (id, path, token, body = {}) => app.request("POST", `/api/v1/issues/${id}${path}`, { token, body });

describe("HTTP concurrency", () => {
  it("two simultaneous grant requests: exactly one 201, the other 409; exactly one history event", async () => {
    const issue = await acknowledgedIssue(w);
    const [a, b] = await Promise.all([
      post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.grantee.id }),
      post(issue._id, "/remediation/grant", w.expert2.token, { granteeId: w.other.id }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const stored = await Issue.findById(issue._id);
    assert.equal(stored.remediationHistory.length, 1);
    assert.ok(stored.remediation);
  });

  it("withdraw racing resolve: never both succeed, and the end state is consistent", async () => {
    const issue = await inProgressIssue(w);
    const [withdraw, resolve] = await Promise.all([
      post(issue._id, "/remediation/withdraw", w.expert2.token, { note: "Reassign." }),
      post(issue._id, "/resolve", w.grantee.token, { note: "Done." }),
    ]);
    assert.ok(!(withdraw.status === 200 && resolve.status === 200), "both cannot win");
    const stored = await Issue.findById(issue._id);
    if (resolve.status === 200) {
      assert.equal(stored.status, "resolved");
      assert.ok(stored.remediation, "a resolved issue retains the grant record");
    } else {
      assert.equal(withdraw.status, 200);
      assert.equal(stored.status, "in_progress");
      assert.equal(stored.remediation, undefined);
    }
  });

  it("stale resolve after the grant was withdrawn and re-issued to the SAME user (ABA): 409 STATE_RACE, nothing written", async () => {
    const issue = await inProgressIssue(w);
    const before = await Issue.findById(issue._id);
    const res = await withInterleave(
      async () => {
        await withdrawRemediation(asActor(w.expert2), issue._id, { note: "Swap." });
        await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id);
        await acceptRemediation(asActor(w.grantee), issue._id);
      },
      () => post(issue._id, "/resolve", w.grantee.token, { note: "Done." }),
    );
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json.code, "STATE_RACE");
    const stored = await Issue.findById(issue._id);
    assert.equal(stored.status, "in_progress");
    assert.equal(stored.statusHistory.length, before.statusHistory.length);
  });

  it("withdrawal between pre-read and write: a concurrent start fails 409 STATE_RACE, never 403 and never success", async () => {
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id);
    await acceptRemediation(asActor(w.grantee), issue._id);
    const res = await withInterleave(
      () => withdrawRemediation(asActor(w.expert2), issue._id, { note: "Pulled." }),
      () => post(issue._id, "/start", w.grantee.token),
    );
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json.code, "STATE_RACE");
    assert.equal((await Issue.findById(issue._id)).status, "acknowledged");
  });

  it("stale verify after fail-verification and a re-resolve by another user (REM-L12 via HTTP): 409, status unchanged", async () => {
    await User.updateOne({ _id: w.other.id }, { $set: { role: "EXPERT" } });
    const issue = await resolvedIssue(w); // resolver = grantee
    const res = await withInterleave(
      async () => {
        await changeStatus(asActor(w.expert1), issue._id, "in_progress", { note: "Still leaking.", expectedFrom: "resolved" });
        await withdrawRemediation(asActor(w.expert2), issue._id, { note: "Swap." });
        await grantRemediation(asActor(w.expert1), issue._id, w.other.id);
        await acceptRemediation({ id: w.other.id, role: "EXPERT" }, issue._id);
        await changeStatus({ id: w.other.id, role: "EXPERT" }, issue._id, "resolved", { note: "Fixed properly." });
      },
      // `other` looks independent of the observed resolver (grantee) but is the NEW resolver.
      () => post(issue._id, "/verify", w.other.token, { note: "Looks fine." }),
    );
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.equal(res.json.code, "STATE_RACE");
    const stored = await Issue.findById(issue._id);
    assert.equal(stored.status, "resolved");
    assert.notEqual(stored.statusHistory.at(-1).toStatus, "verified");
  });

  it("two simultaneous verify requests: exactly one 200", async () => {
    const issue = await resolvedIssue(w);
    const [a, b] = await Promise.all([
      post(issue._id, "/verify", w.expert1.token, { note: "ok-1" }),
      post(issue._id, "/verify", w.expert2.token, { note: "ok-2" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const stored = await Issue.findById(issue._id);
    assert.equal(stored.status, "verified");
    assert.equal(stored.statusHistory.filter((h) => h.toStatus === "verified").length, 1);
  });
});
