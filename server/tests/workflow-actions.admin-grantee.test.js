import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { changeStatus, getIssueWorkflowView } from "../src/services/issue.service.js";
import { acceptRemediation, declineRemediation, grantRemediation, releaseRemediation } from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { acknowledgedIssue, asActor, issueWithAcceptedGrant, makeUser, makeWorld, openIssue } from "./helpers/lifecycleFixtures.js";

/**
 * ADMIN as a remediation grantee, proved against the REAL services in sequence
 * (ADR-0007 section 2: any existing user may be the grantee; invariant 11: a
 * role change never voids a grant). Complements the state x actor agreement
 * matrix (workflow-actions.agreement.test.js) with what a snapshot matrix
 * cannot show:
 *   - the grant operation's TARGET (granting TO an ADMIN, not only to a USER);
 *   - one ADMIN carried through grant -> accept -> start -> resolve, where
 *     before EVERY real mutation the operation must be listed in
 *     `workflow.actions`, and after it the list must be what the new state
 *     predicts;
 *   - a USER grantee promoted to ADMIN mid-flight who keeps working.
 * Parameters are always valid, so a refusal is authorization or state only.
 */

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const actionsFor = async (actor, id) => (await getIssueWorkflowView(actor, id)).actions;

/** The next operation must be listed first, then really succeed. */
async function listedThenPerformed(actor, id, action, perform) {
  const listed = await actionsFor(actor, id);
  assert.ok(listed.includes(action), `"${action}" must be listed before it is performed (listed: ${listed.join(", ") || "none"})`);
  const result = await perform();
  assert.ok(result, `"${action}" was listed, so it must succeed`);
  return result;
}

/**
 * An ADMIN who is NOT the resolver. Resolver independence would refuse the
 * resolving ADMIN anyway, so only a different ADMIN proves that the ROLE alone
 * confers no verification authority.
 */
async function assertAdminBystanderCannotVerifyOrFail(id) {
  const bystander = asActor(await makeUser("ADMIN", "bystander-admin"));
  assert.deepEqual(await actionsFor(bystander, id), [], "a bystander ADMIN holds nothing on a resolved issue");
  for (const target of ["verified", "in_progress"]) {
    await assert.rejects(
      () => changeStatus(bystander, id, target, { note: "n", expectedFrom: "resolved" }),
      (e) => e.code === "FORBIDDEN",
      `a bystander ADMIN must be refused ${target}`,
    );
  }
}

describe("grant TARGET agreement: remediation.grant is listed for an EXPERT whatever the grantee's role", () => {
  for (const target of ["reporter", "other", "expert2", "admin"]) {
    it(`an EXPERT is offered "remediation.grant" and it succeeds when the grantee is the ${target}`, async () => {
      const w = await makeWorld();
      const issue = await acknowledgedIssue(w);
      const expert = asActor(w.expert1);
      await listedThenPerformed(expert, issue._id, "remediation.grant", () =>
        grantRemediation(expert, issue._id, w[target].id, { note: "please take this" }),
      );
      // the grant now exists: grantor view moves to withdraw, grant is no longer offered
      assert.deepEqual(await actionsFor(expert, issue._id), ["remediation.withdraw"]);
    });
  }

  it("granting to an ADMIN leaves the ADMIN with revoke (role) plus accept/decline (the record), and nobody else with grantee actions", async () => {
    const w = await makeWorld();
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.admin.id, {});
    assert.deepEqual(await actionsFor(asActor(w.admin), issue._id), ["remediation.revoke", "remediation.accept", "remediation.decline"]);
    for (const cls of ["reporter", "other", "grantee"]) {
      assert.deepEqual(await actionsFor(asActor(w[cls]), issue._id), [], cls);
    }
  });
});

describe("one ADMIN carried through the whole lifecycle: every step listed, then performed, then re-derived", () => {
  it("acknowledge -> grant to ADMIN -> accept -> start -> resolve -> independent EXPERT verifies", async () => {
    const w = await makeWorld();
    const issue = await openIssue(w);
    const id = issue._id;
    const expert = asActor(w.expert1);
    const admin = asActor(w.admin);

    await listedThenPerformed(expert, id, "acknowledge", () => changeStatus(expert, id, "acknowledged", { expectedFrom: "open" }));
    assert.deepEqual(await actionsFor(admin, id), [], "ADMIN holds nothing before any grant");

    await listedThenPerformed(expert, id, "remediation.grant", () => grantRemediation(expert, id, w.admin.id, { note: "take this" }));
    assert.deepEqual(await actionsFor(admin, id), ["remediation.revoke", "remediation.accept", "remediation.decline"]);

    await listedThenPerformed(admin, id, "remediation.accept", () => acceptRemediation(admin, id));
    assert.deepEqual(await actionsFor(admin, id), ["remediation.revoke", "remediation.release", "remediation.start"]);

    await listedThenPerformed(admin, id, "remediation.start", () => changeStatus(admin, id, "in_progress", { expectedFrom: "acknowledged" }));
    assert.deepEqual(await actionsFor(admin, id), ["remediation.revoke", "remediation.release", "remediation.resolve"]);

    await listedThenPerformed(admin, id, "remediation.resolve", () =>
      changeStatus(admin, id, "resolved", { note: "Replaced the section.", expectedFrom: "in_progress" }),
    );
    assert.deepEqual(await actionsFor(admin, id), [], "once resolved, ADMIN has no grant operation and can never verify or fail");

    // the ADMIN really is refused the EXPERT-only operations the list withholds
    for (const attempt of [
      () => changeStatus(admin, id, "verified", { note: "n", expectedFrom: "resolved" }),
      () => changeStatus(admin, id, "in_progress", { note: "n", expectedFrom: "resolved" }),
    ]) {
      await assert.rejects(attempt, (e) => e.code === "FORBIDDEN");
    }

    await assertAdminBystanderCannotVerifyOrFail(id);

    // an independent EXPERT is offered and performs verification
    const verifier = asActor(w.expert2);
    await listedThenPerformed(verifier, id, "resolution.verify", () =>
      changeStatus(verifier, id, "verified", { note: "Checked on site.", expectedFrom: "resolved" }),
    );
    assert.equal((await Issue.findById(id).lean()).status, "verified");
    for (const actor of [admin, verifier, expert]) assert.deepEqual(await actionsFor(actor, id), []);
  });

  it("decline path: an ADMIN who declines loses the grantee actions; granting is offered again", async () => {
    const w = await makeWorld();
    const issue = await acknowledgedIssue(w);
    const expert = asActor(w.expert1);
    const admin = asActor(w.admin);
    await grantRemediation(expert, issue._id, w.admin.id, {});
    await listedThenPerformed(admin, issue._id, "remediation.decline", () => declineRemediation(admin, issue._id, {}));
    assert.deepEqual(await actionsFor(admin, issue._id), []);
    assert.deepEqual(await actionsFor(expert, issue._id), ["remediation.grant"]);
  });

  it("release path: an ADMIN who releases an accepted grant loses the grantee actions", async () => {
    const w = await makeWorld();
    const issue = await acknowledgedIssue(w);
    const admin = asActor(w.admin);
    await grantRemediation(asActor(w.expert1), issue._id, w.admin.id, {});
    await acceptRemediation(admin, issue._id);
    await listedThenPerformed(admin, issue._id, "remediation.release", () => releaseRemediation(admin, issue._id, { note: "cannot continue" }));
    assert.deepEqual(await actionsFor(admin, issue._id), []);
  });
});

describe("a grantee promoted to ADMIN mid-flight keeps working (ADR-0007 invariant 11)", () => {
  it("accepted USER grantee -> promoted to ADMIN -> start -> resolve, each listed then performed under the ADMIN role", async () => {
    const w = await makeWorld();
    const issue = await issueWithAcceptedGrant(w); // acknowledged, grant accepted by w.grantee (a USER)
    const id = issue._id;

    assert.deepEqual(await actionsFor(asActor(w.grantee), id), ["remediation.release", "remediation.start"]);

    // promotion happens out of band; the app now builds the actor context from the CURRENT role
    await User.updateOne({ _id: w.grantee.id }, { $set: { role: "ADMIN" } });
    const promoted = { id: String(w.grantee.id), role: "ADMIN" };

    assert.deepEqual(
      await actionsFor(promoted, id),
      ["remediation.revoke", "remediation.release", "remediation.start"],
      "role confers revoke; the unchanged grant still confers release/start",
    );
    await listedThenPerformed(promoted, id, "remediation.start", () => changeStatus(promoted, id, "in_progress", { expectedFrom: "acknowledged" }));
    assert.deepEqual(await actionsFor(promoted, id), ["remediation.revoke", "remediation.release", "remediation.resolve"]);
    await listedThenPerformed(promoted, id, "remediation.resolve", () =>
      changeStatus(promoted, id, "resolved", { note: "Done after promotion.", expectedFrom: "in_progress" }),
    );

    // still an ADMIN, still no verification authority, and the history shows the resolver
    assert.deepEqual(await actionsFor(promoted, id), []);
    await assertAdminBystanderCannotVerifyOrFail(id);
    await assert.rejects(() => changeStatus(promoted, id, "verified", { note: "n", expectedFrom: "resolved" }), (e) => e.code === "FORBIDDEN");
    assert.equal((await Issue.findById(id).lean()).statusHistory.at(-1).actor.toString(), String(w.grantee.id));
  });

  it("a PENDING grantee promoted to ADMIN can still accept (the grant, not the role, decides)", async () => {
    const w = await makeWorld();
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, {});
    await User.updateOne({ _id: w.grantee.id }, { $set: { role: "ADMIN" } });
    const promoted = { id: String(w.grantee.id), role: "ADMIN" };
    assert.deepEqual(await actionsFor(promoted, issue._id), ["remediation.revoke", "remediation.accept", "remediation.decline"]);
    await listedThenPerformed(promoted, issue._id, "remediation.accept", () => acceptRemediation(promoted, issue._id));
  });
});
