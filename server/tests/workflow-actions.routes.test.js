import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { WORKFLOW_ACTIONS } from "../src/domain/workflow-actions.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  acknowledgedIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  openIssue,
  resolvedIssue,
} from "./helpers/lifecycleFixtures.js";
import { makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";

/** `workflow.actions` over real HTTP: the viewer-specific read, the mutation response, and where it must NOT appear. */

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

const workflow = (id, token) => app.request("GET", `/api/v1/issues/${id}/workflow`, { token });
const post = (id, path, token, body = {}) => app.request("POST", `/api/v1/issues/${id}${path}`, { token, body });
const actionsOf = async (id, user) => (await workflow(id, user.token)).json.data.actions;

describe("GET /:id/workflow carries the viewer's actions", () => {
  it("is a list of known action names in the stable vocabulary order, per viewer", async () => {
    const issue = await acknowledgedIssue(w);
    const res = await workflow(issue._id, w.expert1.token);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.data.actions));
    for (const a of res.json.data.actions) assert.ok(WORKFLOW_ACTIONS.includes(a), a);
    assert.deepEqual(res.json.data.actions, ["remediation.grant"]);
  });

  it("each role/participant sees only its own capabilities on the same Issue", async () => {
    const issue = await issueWithPendingGrant(w); // acknowledged, grant pending for w.grantee
    assert.deepEqual(await actionsOf(issue._id, w.expert1), ["remediation.withdraw"]);
    assert.deepEqual(await actionsOf(issue._id, w.expert2), ["remediation.withdraw"]);
    assert.deepEqual(await actionsOf(issue._id, w.admin), ["remediation.revoke"]);
    assert.deepEqual(await actionsOf(issue._id, w.grantee), ["remediation.accept", "remediation.decline"]);
    assert.deepEqual(await actionsOf(issue._id, w.reporter), []);
    assert.deepEqual(await actionsOf(issue._id, w.other), []);
  });

  it("an accepted grantee gets release/start, then release/resolve once in progress", async () => {
    const issue = await issueWithAcceptedGrant(w);
    assert.deepEqual(await actionsOf(issue._id, w.grantee), ["remediation.release", "remediation.start"]);
    assert.equal((await post(issue._id, "/start", w.grantee.token)).status, 200);
    assert.deepEqual(await actionsOf(issue._id, w.grantee), ["remediation.release", "remediation.resolve"]);
  });

  it("resolved: an independent EXPERT may verify or fail; ordinary viewers get nothing", async () => {
    const issue = await resolvedIssue(w);
    assert.deepEqual(await actionsOf(issue._id, w.expert1), ["resolution.verify", "resolution.fail"]);
    assert.deepEqual(await actionsOf(issue._id, w.grantee), []);
    assert.deepEqual(await actionsOf(issue._id, w.other), []);
  });

  it("anonymous callers still get 401 (no actions without an actor)", async () => {
    const issue = await openIssue(w);
    const res = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`);
    assert.equal(res.status, 401);
  });

  it("a pending grant is indistinguishable from none for an ordinary viewer", async () => {
    const pending = await issueWithPendingGrant(w);
    const w2 = await makeHttpWorld();
    const none = await acknowledgedIssue(w2);
    assert.deepEqual(await actionsOf(pending._id, w.other), await actionsOf(none._id, w2.other));
    const a = await workflow(pending._id, w.other.token);
    assert.ok(!a.text.includes(w.grantee.id));
  });
});

describe("mutation responses carry the viewer's post-mutation actions", () => {
  it("acknowledge by an EXPERT: the next capability is granting", async () => {
    const issue = await openIssue(w);
    const res = await post(issue._id, "/acknowledge", w.expert1.token, {});
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json.data.workflow.actions, ["remediation.grant"]);
  });

  it("accept by the grantee: release and start become available", async () => {
    const issue = await issueWithPendingGrant(w);
    const res = await post(issue._id, "/remediation/accept", w.grantee.token);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json.data.workflow.actions, ["remediation.release", "remediation.start"]);
  });

  it("the response is the PERFORMER's list, not a shared one", async () => {
    const issue = await acknowledgedIssue(w);
    const res = await post(issue._id, "/remediation/grant", w.expert1.token, { granteeId: w.grantee.id });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.deepEqual(res.json.data.workflow.actions, ["remediation.withdraw"]); // the grantor's view
    assert.deepEqual(await actionsOf(issue._id, w.grantee), ["remediation.accept", "remediation.decline"]);
  });
});

describe("where `actions` must not appear", () => {
  it("the public detail, the list and the create response never carry it", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const detail = await app.request("GET", `/api/v1/issues/${issue._id}`);
    assert.ok(!detail.text.includes('"actions"'));
    const list = await app.request("GET", "/api/v1/issues");
    assert.ok(!list.text.includes('"actions"'));
    const created = await app.request("POST", "/api/v1/issues", {
      token: w.reporter.token,
      body: { title: "T", description: "D", location: { type: "Point", coordinates: [85.1, 25.6] } },
    });
    assert.ok(!created.text.includes('"actions"'));
  });

  it("a listed action is not a security token: an unlisted operation is still refused by the service", async () => {
    const issue = await acknowledgedIssue(w);
    assert.ok(!(await actionsOf(issue._id, w.other)).includes("remediation.grant"));
    const res = await post(issue._id, "/remediation/grant", w.other.token, { granteeId: w.grantee.id });
    assert.equal(res.status, 403);
  });
});
