import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  acknowledgedIssue,
  inProgressIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  openIssue,
  resolvedIssue,
} from "./helpers/lifecycleFixtures.js";
import { assertNoPrivateKeys, makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";

/**
 * HTTP contract for the explicit Issue lifecycle + remediation routes (#142).
 * Domain policy is NOT re-tested here (remediation.service / lifecycle suites
 * own it); this proves exposure: routing, envelope, status codes, exact edge,
 * response allowlists, and that no authorization lives in the route layer.
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
const ENVELOPE = ["data", "message", "success"];
const MUTATION_KEYS = ["issue", "workflow"];
const WORKFLOW_KEYS = ["assignee", "events", "pending", "state"];

function assertMutationShape(res) {
  assert.deepEqual(Object.keys(res.json).sort(), ENVELOPE);
  assert.deepEqual(Object.keys(res.json.data).sort(), MUTATION_KEYS);
  assert.deepEqual(Object.keys(res.json.data.workflow).sort(), WORKFLOW_KEYS);
  assert.ok(!("activity" in res.json.data.issue), "mutation responses omit activity");
  // acceptedAt is public on `assignee` once accepted; everything else private stays private.
  assertNoPrivateKeys(assert, res.json);
}

describe("lifecycle transitions", () => {
  it("acknowledge: EXPERT 200, exact response shape; history gains one entry", async () => {
    const issue = await openIssue(w);
    const res = await post(issue._id, "/acknowledge", w.expert1.token, { note: "On it" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assertMutationShape(res);
    assert.equal(res.json.data.issue.status, "acknowledged");
    assert.equal(res.json.data.issue.statusHistory.length, 2);
    assert.equal(res.json.data.issue.statusHistory[1].actor, w.expert1.id);
    assert.equal(res.json.data.issue.statusHistory[1].note, "On it");
  });

  it("acknowledge: USER is 403 and nothing changes", async () => {
    const issue = await openIssue(w);
    const res = await post(issue._id, "/acknowledge", w.reporter.token);
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
    assert.equal((await Issue.findById(issue._id)).status, "open");
  });

  it("start -> resolve -> verify happy path through HTTP, with required notes enforced", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const start = await post(issue._id, "/start", w.grantee.token);
    assert.equal(start.status, 200, JSON.stringify(start.json));
    assertMutationShape(start);
    assert.equal(start.json.data.issue.status, "in_progress");
    assert.equal(start.json.data.issue.assignee.actor._id, w.grantee.id);

    const noNote = await post(issue._id, "/resolve", w.grantee.token);
    assert.equal(noNote.status, 400);
    assert.equal(noNote.json.code, "VALIDATION_FAILED");

    const resolve = await post(issue._id, "/resolve", w.grantee.token, { note: "Replaced the pipe." });
    assert.equal(resolve.status, 200, JSON.stringify(resolve.json));
    assert.equal(resolve.json.data.issue.status, "resolved");

    const verifyNoNote = await post(issue._id, "/verify", w.expert1.token);
    assert.equal(verifyNoNote.status, 400);

    const verify = await post(issue._id, "/verify", w.expert1.token, { note: "Checked on site." });
    assert.equal(verify.status, 200, JSON.stringify(verify.json));
    assert.equal(verify.json.data.issue.status, "verified");
    assert.equal(verify.json.data.issue.statusHistory.length, 5);
  });

  it("start: an EXPERT without an accepted grant is 403, and the pending grantee gets 409 + reason", async () => {
    const issue = await issueWithPendingGrant(w);
    const expert = await post(issue._id, "/start", w.expert2.token);
    assert.equal(expert.status, 403);
    assert.ok(!("reason" in expert.json));

    const pendingGrantee = await post(issue._id, "/start", w.grantee.token);
    assert.equal(pendingGrantee.status, 409);
    assert.equal(pendingGrantee.json.code, "INVALID_STATE");
    assert.equal(pendingGrantee.json.reason, "GRANT_NOT_ACCEPTED");
    assert.equal((await Issue.findById(issue._id)).status, "acknowledged");
  });

  it("fail-verification: EXPERT, note required, returns to in_progress and keeps the accepted grant", async () => {
    const issue = await resolvedIssue(w);
    const noNote = await post(issue._id, "/fail-verification", w.expert2.token);
    assert.equal(noNote.status, 400);

    const res = await post(issue._id, "/fail-verification", w.expert2.token, { note: "Still leaking." });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.issue.status, "in_progress");
    assert.equal(res.json.data.issue.assignee.actor._id, w.grantee.id);
    assert.ok((await Issue.findById(issue._id)).remediation, "grant stays active");
  });

  it("exact source edge: start cannot drive resolved->in_progress; fail-verification cannot drive acknowledged->in_progress", async () => {
    const resolved = await resolvedIssue(w);
    const wrongStart = await post(resolved._id, "/start", w.grantee.token);
    assert.equal(wrongStart.status, 409);
    assert.equal(wrongStart.json.code, "INVALID_STATE");
    const after1 = await Issue.findById(resolved._id);
    assert.equal(after1.status, "resolved");
    assert.equal(after1.statusHistory.length, 4);

    const w2 = await makeHttpWorld();
    const ack = await acknowledgedIssue(w2);
    const wrongFail = await post(ack._id, "/fail-verification", w2.expert1.token, { note: "x" });
    assert.equal(wrongFail.status, 409);
    assert.equal((await Issue.findById(ack._id)).status, "acknowledged");
  });

  it("edge guard is evaluated before authorization and before note validation (no information leak)", async () => {
    const issue = await openIssue(w);
    const res = await post(issue._id, "/verify", w.reporter.token); // wrong edge + wrong role + missing note
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });

  it("verify: the resolver is rejected even if later promoted to EXPERT (resolver != verifier)", async () => {
    const issue = await resolvedIssue(w);
    await (await import("../src/models/User.js")).User.updateOne({ _id: w.grantee.id }, { $set: { role: "EXPERT" } });
    const res = await post(issue._id, "/verify", w.grantee.token, { note: "self" });
    assert.equal(res.status, 403);
    assert.equal((await Issue.findById(issue._id)).status, "resolved");
  });
});

describe("remediation operations", () => {
  it("grant: EXPERT 201 with exact shape; a pending grant is visible to the grantor but not public", async () => {
    const issue = await acknowledgedIssue(w);
    const res = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.grantee.id, note: "please" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assertMutationShape(res);
    assert.equal(res.json.data.workflow.state, "pending");
    assert.equal(res.json.data.workflow.pending.actor._id, w.grantee.id);
    assert.equal(res.json.data.workflow.pending.grantor._id, w.expert1.id);
    assert.equal(res.json.data.issue.assignee, null);
  });

  it("grant: validation (400) for a missing/invalid granteeId, 403 for a non-EXPERT, 404 for an unknown grantee", async () => {
    const issue = await acknowledgedIssue(w);
    assert.equal((await post(issue._id, "/remediation/grant", w.expert1.token, {})).status, 400);
    assert.equal((await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: "nope" })).status, 400);
    assert.equal((await post(issue._id, "/remediation/grant", w.reporter.token, { granteeId: w.grantee.id })).status, 403);
    const unknown = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: "507f1f77bcf86cd799439011" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.code, "NOT_FOUND");
  });

  it("grant: a second grant is 409 with reason GRANT_EXISTS", async () => {
    const issue = await issueWithPendingGrant(w);
    const res = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.other.id });
    assert.equal(res.status, 409);
    assert.equal(res.json.reason, "GRANT_EXISTS");
    assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "reason", "success"]);
  });

  it("self-grant above the threshold is 403 with reason SELF_GRANT_NOT_PERMITTED and no policy numbers", async () => {
    const prev = process.env.SELF_GRANT_EXPERT_THRESHOLD;
    process.env.SELF_GRANT_EXPERT_THRESHOLD = "0";
    try {
      const issue = await acknowledgedIssue(w);
      const res = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.expert1.id });
      assert.equal(res.status, 403);
      assert.equal(res.json.reason, "SELF_GRANT_NOT_PERMITTED");
      assert.ok(!res.text.includes("expertCount") && !res.text.includes("threshold"));
    } finally {
      if (prev === undefined) delete process.env.SELF_GRANT_EXPERT_THRESHOLD;
      else process.env.SELF_GRANT_EXPERT_THRESHOLD = prev;
    }
  });

  it("accept / decline / release: grantee only (others 403); each 200 with the viewer's workflow", async () => {
    let issue = await issueWithPendingGrant(w);
    assert.equal((await post(issue._id, "/remediation/accept", w.other.token)).status, 403);
    assert.equal((await post(issue._id, "/remediation/accept", w.expert1.token)).status, 403);
    const accept = await post(issue._id, "/remediation/accept", w.grantee.token);
    assert.equal(accept.status, 200, JSON.stringify(accept.json));
    assert.equal(accept.json.data.workflow.state, "accepted");
    assert.equal(accept.json.data.issue.assignee.actor._id, w.grantee.id);

    const again = await post(issue._id, "/remediation/accept", w.grantee.token);
    assert.equal(again.status, 409);
    assert.equal(again.json.reason, "GRANT_ALREADY_ACCEPTED");

    const release = await post(issue._id, "/remediation/release", w.grantee.token, { note: "no time" });
    assert.equal(release.status, 200);
    assert.equal(release.json.data.workflow.state, "unassigned");
    assert.equal(release.json.data.issue.assignee, null);

    issue = await issueWithPendingGrant(await makeHttpWorld().then((x) => (w = x)));
    const decline = await post(issue._id, "/remediation/decline", w.grantee.token);
    assert.equal(decline.status, 200);
    assert.equal((await Issue.findById(issue._id)).remediation, undefined);
  });

  it("withdraw: EXPERT with required note; ADMIN cannot withdraw; revoke: ADMIN only, note required", async () => {
    const issue = await issueWithAcceptedGrant(w);
    assert.equal((await post(issue._id, "/remediation/withdraw", w.admin.token, { note: "n" })).status, 403);
    assert.equal((await post(issue._id, "/remediation/revoke", w.expert2.token, { note: "n" })).status, 403);

    const noNote = await post(issue._id, "/remediation/revoke", w.admin.token);
    assert.equal(noNote.status, 400);

    const revoke = await post(issue._id, "/remediation/revoke", w.admin.token, { note: "Governance." });
    assert.equal(revoke.status, 200, JSON.stringify(revoke.json));
    assert.equal(revoke.json.data.issue.assignee, null);

    const none = await post(issue._id, "/remediation/withdraw", w.expert2.token, { note: "n" });
    assert.equal(none.status, 409);
    assert.equal(none.json.reason, "NO_GRANT");
  });

  it("grant operations in `open` are 409 and never change status", async () => {
    const issue = await openIssue(w);
    const res = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.grantee.id });
    assert.equal(res.status, 409);
    assert.equal((await Issue.findById(issue._id)).status, "open");
  });
});

describe("common route behavior", () => {
  const ROUTES = [
    "/acknowledge", "/start", "/resolve", "/verify", "/fail-verification",
    "/remediation/accept", "/remediation/decline", "/remediation/release",
    "/remediation/withdraw", "/remediation/revoke",
  ];

  it("every action route: anonymous 401, malformed id 400 (service CastError translation), unknown id 404", async () => {
    const issue = await acknowledgedIssue(w);
    for (const path of ROUTES) {
      const anon = await app.request("POST", `/api/v1/issues/${issue._id}${path}`, { body: {} });
      assert.equal(anon.status, 401, `${path} anonymous`);
      assert.equal(anon.json.code, "UNAUTHORIZED");
      // ADMIN-only `revoke` checks the role before it loads the issue (ADR-0007 order).
      const token = path.endsWith("/revoke") ? w.admin.token : w.expert1.token;
      const bad = await post("not-an-id", path, token);
      assert.equal(bad.status, 400, `${path} malformed id`);
      assert.equal(bad.json.code, "VALIDATION_FAILED");
      const missing = await post("507f1f77bcf86cd799439011", path, token);
      assert.equal(missing.status, 404, `${path} unknown id`);
      assert.equal(missing.json.code, "NOT_FOUND");
    }
    const grantAnon = await app.request("POST", `/api/v1/issues/${issue._id}/remediation/grant`, { body: { granteeId: w.grantee.id } });
    assert.equal(grantAnon.status, 401);
  });

  it("a non-string note is a 400 shape error; an over-long note is a 400 from the domain", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await post(issue._id, "/start", w.grantee.token);
    assert.equal((await post(issue._id, "/resolve", w.grantee.token, { note: 42 })).status, 400);
    const long = await post(issue._id, "/resolve", w.grantee.token, { note: "x".repeat(2001) });
    assert.equal(long.status, 400);
    assert.equal(long.json.code, "VALIDATION_FAILED");
    assert.equal((await Issue.findById(issue._id)).status, "in_progress");
  });

  it("a body-supplied target status or actor is ignored (the route names the edge)", async () => {
    const issue = await acknowledgedIssue(w);
    const res = await post(issue._id, "/start", w.expert1.token, { targetStatus: "verified", actor: w.grantee.id });
    assert.equal(res.status, 403);
    assert.equal((await Issue.findById(issue._id)).status, "acknowledged");
  });

  it("in_progress issue helper sanity: a started issue is reachable only via the grantee", async () => {
    const issue = await inProgressIssue(w);
    const res = await post(issue._id, "/resolve", w.expert1.token, { note: "mine" });
    assert.equal(res.status, 403);
  });
});

describe("workflow read and public detail", () => {
  it("GET /:id/workflow: anonymous 401; authenticated viewer gets only their own view", async () => {
    const issue = await issueWithPendingGrant(w);
    const anon = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`);
    assert.equal(anon.status, 401);

    const outsider = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`, { token: w.other.token });
    assert.equal(outsider.status, 200);
    assert.equal(outsider.json.data.state, "unassigned");
    assert.deepEqual(outsider.json.data.events, []);

    const expert = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`, { token: w.expert2.token });
    assert.equal(expert.json.data.state, "pending");
    assert.deepEqual(Object.keys(expert.json.data).sort(), WORKFLOW_KEYS);
    assertNoPrivateKeys(assert, expert.json);
  });

  it("GET /:id (anonymous) includes activity, assignee, and string `actor` compatibility", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const res = await app.request("GET", `/api/v1/issues/${issue._id}`);
    assert.equal(res.status, 200);
    const d = res.json.data;
    assert.ok(Array.isArray(d.activity) && d.activity.length >= 4);
    assert.equal(d.assignee.actor._id, w.grantee.id);
    for (const h of d.statusHistory) {
      assert.equal(typeof h.actor, "string");
      assert.equal(typeof h._id, "string");
      assert.ok("actorProfile" in h);
    }
    assertNoPrivateKeys(assert, res.json);
  });

  it("GET / (list, anonymous) keeps its page shape, has no activity/assignee, and no private keys", async () => {
    await issueWithAcceptedGrant(w);
    const res = await app.request("GET", "/api/v1/issues");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.data).sort(), ["items", "limit", "page", "total", "totalPages"]);
    assert.ok(!("activity" in res.json.data.items[0]) && !("assignee" in res.json.data.items[0]));
    assertNoPrivateKeys(assert, res.json);
  });

  it("route order: /:id/workflow does not shadow or get shadowed by /:id", async () => {
    const issue = await openIssue(w);
    const detail = await app.request("GET", `/api/v1/issues/${issue._id}`);
    const wf = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`, { token: w.other.token });
    assert.equal(detail.json.data._id, String(issue._id));
    assert.equal(wf.json.data.state, "unassigned");
  });
});
