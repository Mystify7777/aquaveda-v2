import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { acceptRemediation, grantRemediation, withdrawRemediation } from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { acknowledgedIssue, asActor, issueWithPendingGrant } from "./helpers/lifecycleFixtures.js";
import { assertNoPrivateKeys, makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";

/**
 * ADR-0007 section 7/8 access matrix over REAL HTTP (#142, invariant 14).
 * Scenario events (all on the same issue), grantee = G:
 *   granted(note G1, by E1) -> withdrawn(note W, by E2) -> granted(note G2, by E1) -> accepted(by G)
 */

const G1 = "PRIVATE-grant-note-one";
const W = "PRIVATE-withdraw-note";
const G2 = "PRIVATE-grant-note-two";

let app;
let w;
let issueId;

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
  const issue = await acknowledgedIssue(w);
  issueId = issue._id;
  await grantRemediation(asActor(w.expert1), issueId, w.grantee.id, { note: G1 });
  await withdrawRemediation(asActor(w.expert2), issueId, { note: W });
  await grantRemediation(asActor(w.expert1), issueId, w.grantee.id, { note: G2 });
  await acceptRemediation(asActor(w.grantee), issueId);
});

const workflow = (token) => app.request("GET", `/api/v1/issues/${issueId}/workflow`, { token });
const setRole = (u, role) => User.updateOne({ _id: u.id }, { $set: { role } });

describe("public detail (anonymous)", () => {
  it("shows the accepted assignee and the redacted activity log only", async () => {
    const res = await app.request("GET", `/api/v1/issues/${issueId}`);
    assert.equal(res.status, 200);
    for (const secret of [G1, W, G2]) assert.ok(!res.text.includes(secret), `public response leaks ${secret}`);
    assertNoPrivateKeys(assert, res.json);
    const types = res.json.data.activity.map((e) => e.type);
    assert.deepEqual(types, [
      "report_submitted", "status_changed", "responsibility_offered", "responsibility_withdrawn",
      "responsibility_offered", "responsibility_accepted",
    ]);
    for (const e of res.json.data.activity.filter((x) => x.type.startsWith("responsibility_"))) {
      assert.equal(e.note, null);
      if (e.type !== "responsibility_accepted") assert.equal(e.actor, null);
    }
    assert.equal(res.json.data.assignee.actor._id, w.grantee.id);
  });

  it("a PENDING grant: grantee identity is absent from the public detail and indistinguishable from unassigned", async () => {
    const w2 = await makeHttpWorld();
    const issue = await issueWithPendingGrant(w2);
    const res = await app.request("GET", `/api/v1/issues/${issue._id}`);
    assert.equal(res.json.data.assignee, null);
    assert.ok(!res.text.includes(w2.grantee.id));
    const outsider = await app.request("GET", `/api/v1/issues/${issue._id}/workflow`, { token: w2.other.token });
    assert.equal(outsider.json.data.state, "unassigned");
    assert.equal(outsider.json.data.pending, null);
  });
});

describe("workflow view per viewer class", () => {
  it("an unrelated user: accepted assignee is public, but no events", async () => {
    const res = await workflow(w.other.token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.state, "accepted");
    assert.equal(res.json.data.assignee.actor._id, w.grantee.id);
    assert.deepEqual(res.json.data.events, []);
    assertNoPrivateKeys(assert, res.json);
  });

  it("the grantee (participant): own events and notes, withdrawn shows type/role/time only", async () => {
    const res = await workflow(w.grantee.token);
    const events = res.json.data.events;
    assert.equal(events.length, 4);
    assert.ok(res.text.includes(G1) && res.text.includes(G2));
    assert.ok(!res.text.includes(W), "withdrawn note is role-based only");
    const withdrawn = events.find((e) => e.type === "withdrawn");
    assert.deepEqual(Object.keys(withdrawn).sort(), ["performerRole", "timestamp", "type"]);
    assert.equal(withdrawn.performerRole, "EXPERT");
    assertNoPrivateKeys(assert, res.json);
  });

  it("a current EXPERT (role-based) sees every event including withdraw notes, but never grantId/policy metadata", async () => {
    const res = await workflow(w.expert1.token);
    assert.equal(res.json.data.events.length, 4);
    assert.ok(res.text.includes(W));
    assertNoPrivateKeys(assert, res.json);
  });

  it("promotion grants role-based access immediately; demotion removes it but keeps participation access", async () => {
    // bystander promoted -> sees all events
    assert.equal((await workflow(w.other.token)).json.data.events.length, 0);
    await setRole(w.other, "EXPERT");
    const promoted = await workflow(w.other.token);
    assert.equal(promoted.json.data.events.length, 4);
    assert.ok(promoted.text.includes(W));

    // expert2 performed only the withdrawal; demoted -> sees just that event, without its note
    await setRole(w.expert2, "USER");
    const demoted = await workflow(w.expert2.token);
    assert.equal(demoted.json.data.events.length, 1);
    assert.deepEqual(Object.keys(demoted.json.data.events[0]).sort(), ["performerRole", "timestamp", "type"]);
    assert.ok(!demoted.text.includes(W));

    // expert1 performed both grants; demoted -> keeps participation in those two (notes visible), loses the rest
    await setRole(w.expert1, "USER");
    const demoted1 = await workflow(w.expert1.token);
    assert.equal(demoted1.json.data.events.length, 2);
    assert.ok(demoted1.text.includes(G1) && demoted1.text.includes(G2));
    assert.ok(!demoted1.text.includes(W));
  });

  it("each response is built for its own viewer (back-to-back requests never share a projection)", async () => {
    const privileged = await workflow(w.expert1.token);
    const outsider = await workflow(w.reporter.token);
    const privilegedAgain = await workflow(w.expert1.token);
    assert.equal(privileged.json.data.events.length, 4);
    assert.equal(outsider.json.data.events.length, 0);
    assert.deepEqual(privilegedAgain.json.data, privileged.json.data);
  });
});

describe("mutation responses return only the approved DTO", () => {
  it("an EXPERT's withdraw response contains the workflow for that EXPERT and no private keys", async () => {
    const res = await app.request("POST", `/api/v1/issues/${issueId}/remediation/withdraw`, {
      token: w.expert2.token,
      body: { note: "Reassigning." },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(Object.keys(res.json.data).sort(), ["issue", "workflow"]);
    assertNoPrivateKeys(assert, res.json);
    assert.equal(res.json.data.workflow.state, "unassigned");
  });

  it("a grantee's start response never reveals withdraw notes or other participants' events", async () => {
    const res = await app.request("POST", `/api/v1/issues/${issueId}/start`, { token: w.grantee.token, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(!res.text.includes(W));
    assertNoPrivateKeys(assert, res.json);
  });
});

