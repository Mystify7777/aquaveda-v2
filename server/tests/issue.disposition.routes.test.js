import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";
import { openIssue } from "./helpers/lifecycleFixtures.js";

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

const post = (id, token, body) =>
  app.request("POST", `/api/v1/issues/${id}/disposition`, { token, body });

describe("Issue #199 disposition routes", () => {
  it("EXPERT can mark an Issue invalid and the public detail exposes the disposition", async () => {
    const issue = await openIssue(w);

    const res = await post(issue._id, w.expert1.token, {
      type: "invalid",
      note: "Not an environmental issue.",
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.issue.disposition.type, "invalid");

    const detail = await app.request("GET", `/api/v1/issues/${issue._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.disposition.type, "invalid");
    assert.equal(detail.json.data.status, "open");
  });

  it("reporter can withdraw, while another USER and ADMIN cannot", async () => {
    const issue = await openIssue(w);

    assert.equal((await post(issue._id, w.other.token, { type: "withdrawn" })).status, 403);
    assert.equal((await post(issue._id, w.admin.token, { type: "withdrawn" })).status, 403);
    assert.equal((await post(issue._id, w.reporter.token, { type: "withdrawn" })).status, 200);
  });

  it("duplicate requires a canonical Issue and preserves the canonical Issue", async () => {
    const duplicate = await openIssue(w);
    const canonical = await openIssue(w);

    const res = await post(duplicate._id, w.expert1.token, {
      type: "duplicate",
      note: "Same report.",
      canonicalIssueId: canonical._id,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.issue.disposition.type, "duplicate");
    assert.equal(res.json.data.issue.disposition.canonicalIssueId, String(canonical._id));

    const canonicalDetail = await app.request("GET", `/api/v1/issues/${canonical._id}`);
    assert.equal(canonicalDetail.json.data.disposition, undefined);
  });

  it("disposed Issues expose no workflow capabilities", async () => {
    const issue = await openIssue(w);
    await post(issue._id, w.expert1.token, { type: "invalid", note: "Not actionable." });

    const workflow = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`, {
      token: w.expert1.token,
    });
    assert.equal(workflow.status, 200);
    assert.deepEqual(workflow.json.data.actions, []);
  });
});
