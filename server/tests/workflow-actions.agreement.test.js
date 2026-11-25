import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { WORKFLOW_ACTIONS, evaluateWorkflowActions } from "../src/domain/workflow-actions.js";
import { changeStatus, createIssue, disposeIssue, getIssueWorkflowView } from "../src/services/issue.service.js";
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
  acknowledgedIssue,
  asActor,
  inProgressIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  makeWorld,
  openIssue,
  resolvedIssue,
  verifiedIssue,
} from "./helpers/lifecycleFixtures.js";

/**
 * AGREEMENT: `workflow.actions` must equal what the real services permit.
 *
 * For every scenario (an Issue state) and every actor class, each of the eleven
 * operations is actually attempted against the real services (real MongoDB):
 *   - an operation NOT in `actions` must be refused (FORBIDDEN / INVALID_STATE)
 *     and must change nothing;
 *   - an operation IN `actions` must succeed (on a fresh copy of the scenario,
 *     since a success mutates).
 * Valid parameters are always supplied, so a refusal can only be authorization
 * or state, never validation. This is the drift detector between the capability
 * evaluator and the enforcement in the services.
 */

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

/** The operations exactly as the routes invoke them. */
const OPS = {
  "disposition.invalid": (a, id) => disposeIssue(a, id, "invalid", { note: "not valid" }),
  "disposition.duplicate": (a, id, w) =>
    disposeIssue(a, id, "duplicate", { note: "duplicate report", canonicalIssueId: w.canonical.id }),
  "disposition.withdraw": (a, id) => disposeIssue(a, id, "withdrawn", { note: "withdrawing" }),
  acknowledge: (a, id) => changeStatus(a, id, "acknowledged", { expectedFrom: "open" }),
  "remediation.grant": (a, id, w) => grantRemediation(a, id, w.other.id, { note: "n" }),
  "remediation.withdraw": (a, id) => withdrawRemediation(a, id, { note: "n" }),
  "remediation.revoke": (a, id) => revokeRemediation(a, id, { note: "n" }),
  "remediation.accept": (a, id) => acceptRemediation(a, id),
  "remediation.decline": (a, id) => declineRemediation(a, id, {}),
  "remediation.release": (a, id) => releaseRemediation(a, id, { note: "n" }),
  "remediation.start": (a, id) => changeStatus(a, id, "in_progress", { expectedFrom: "acknowledged" }),
  "remediation.resolve": (a, id) => changeStatus(a, id, "resolved", { note: "n", expectedFrom: "in_progress" }),
  "resolution.verify": (a, id) => changeStatus(a, id, "verified", { note: "n", expectedFrom: "resolved" }),
  "resolution.fail": (a, id) => changeStatus(a, id, "in_progress", { note: "n", expectedFrom: "resolved" }),
};

const CLASSES = ["reporter", "other", "grantee", "expert1", "expert2", "admin"];

/** A scenario builds a fresh world and Issue each time it is called. */
async function selfGrantedResolved() {
  // An EXPERT is the accepted grantee and the resolver (self-grant is policy-permitted below the threshold).
  const w = await makeWorld();
  const prev = process.env.SELF_GRANT_EXPERT_THRESHOLD;
  process.env.SELF_GRANT_EXPERT_THRESHOLD = "100";
  try {
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(w.expert1), issue._id, w.expert1.id, {});
    await acceptRemediation(asActor(w.expert1), issue._id);
    await changeStatus(asActor(w.expert1), issue._id, "in_progress", { expectedFrom: "acknowledged" });
    await changeStatus(asActor(w.expert1), issue._id, "resolved", { note: "done", expectedFrom: "in_progress" });
    return { w, id: issue._id };
  } finally {
    if (prev === undefined) delete process.env.SELF_GRANT_EXPERT_THRESHOLD;
    else process.env.SELF_GRANT_EXPERT_THRESHOLD = prev;
  }
}

/**
 * ADR-0007 section 2: the grantee may be ANY existing User, ADMIN included; the
 * grant (a record), not the role, confers the participation authority. These
 * scenarios put the ADMIN account in the grantee seat.
 */
async function adminGranteeAt(stage) {
  const w = await makeWorld();
  const issue = await acknowledgedIssue(w);
  await grantRemediation(asActor(w.expert1), issue._id, w.admin.id, {});
  if (stage === "pending") return { w, id: issue._id };
  await acceptRemediation(asActor(w.admin), issue._id);
  if (stage === "accepted") return { w, id: issue._id };
  await changeStatus(asActor(w.admin), issue._id, "in_progress", { expectedFrom: "acknowledged" });
  if (stage === "in_progress") return { w, id: issue._id };
  await changeStatus(asActor(w.admin), issue._id, "resolved", { note: "done", expectedFrom: "in_progress" });
  return { w, id: issue._id };
}

const viaFixture = (make) => async () => {
  const w = await makeWorld();
  const issue = await make(w);
  return { w, id: issue._id };
};

const SCENARIOS = {
  open: viaFixture(openIssue),
  "acknowledged, no grant": viaFixture(acknowledgedIssue),
  "acknowledged, grant pending": viaFixture(issueWithPendingGrant),
  "acknowledged, grant accepted": viaFixture(issueWithAcceptedGrant),
  "in_progress, grant accepted": viaFixture(inProgressIssue),
  "in_progress, grant released (none)": async () => {
    const w = await makeWorld();
    const issue = await inProgressIssue(w);
    await releaseRemediation(asActor(w.grantee), issue._id, { note: "cannot continue" });
    return { w, id: issue._id };
  },
  "in_progress, new grant pending": async () => {
    const w = await makeWorld();
    const issue = await inProgressIssue(w);
    await releaseRemediation(asActor(w.grantee), issue._id, { note: "cannot continue" });
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, {});
    return { w, id: issue._id };
  },
  "resolved (resolver is the grantee)": viaFixture(resolvedIssue),
  "resolved (resolver is an EXPERT)": selfGrantedResolved,
  verified: viaFixture(verifiedIssue),
  "acknowledged, ADMIN is the pending grantee": () => adminGranteeAt("pending"),
  "acknowledged, ADMIN is the accepted grantee": () => adminGranteeAt("accepted"),
  "in_progress, ADMIN is the accepted grantee": () => adminGranteeAt("in_progress"),
  "resolved (resolver is an ADMIN)": () => adminGranteeAt("resolved"),
  "acknowledged, accepted grantee LATER promoted to ADMIN (role change, ADR-0007 invariant 11)": async () => {
    const w = await makeWorld();
    const issue = await issueWithAcceptedGrant(w);
    await User.updateOne({ _id: w.grantee.id }, { $set: { role: "ADMIN" } });
    w.grantee.role = "ADMIN"; // the actor context the app would build from the current role
    return { w, id: issue._id };
  },
};

const REFUSALS = new Set(["FORBIDDEN", "INVALID_STATE"]);

for (const [name, build] of Object.entries(SCENARIOS)) {
  describe(`agreement: ${name}`, () => {
    for (const cls of CLASSES) {
      it(`${cls}: every listed action succeeds and every unlisted action is refused without effect`, async () => {
        const base = await build();
        base.w.canonical = await createIssue(asActor(base.w.other), {
          title: "Canonical issue",
          description: "Canonical report",
          location: { type: "Point", coordinates: [85, 25] },
        });
        const actor = asActor(base.w[cls]);
        const { actions } = await getIssueWorkflowView(actor, base.id);

        // (1) the unlisted operations are refused, and nothing changes
        const before = JSON.stringify(await Issue.findById(base.id).lean());
        for (const op of WORKFLOW_ACTIONS.filter((a) => !actions.includes(a))) {
          await assert.rejects(
            () => OPS[op](actor, base.id, base.w),
            (e) => REFUSALS.has(e.code),
            `${name} / ${cls}: "${op}" is not listed, so it must be refused`,
          );
        }
        assert.equal(JSON.stringify(await Issue.findById(base.id).lean()), before, "refused operations changed nothing");

        // (2) each listed operation really succeeds (on a fresh copy)
        for (const op of actions) {
          const fresh = await build();
          fresh.w.canonical = await createIssue(asActor(fresh.w.other), {
            title: "Canonical issue",
            description: "Canonical report",
            location: { type: "Point", coordinates: [85, 25] },
          });
          const result = await OPS[op](asActor(fresh.w[cls]), fresh.id, fresh.w);
          assert.ok(result, `${name} / ${cls}: "${op}" is listed, so it must succeed`);
        }
      });
    }

    it("anonymous: no actions, and every operation is refused as UNAUTHORIZED", async () => {
      const base = await build();
      base.w.canonical = await createIssue(asActor(base.w.other), {
        title: "Canonical issue",
        description: "Canonical report",
        location: { type: "Point", coordinates: [85, 25] },
      });
      const doc = (await Issue.findById(base.id)).toObject();
      assert.deepEqual(evaluateWorkflowActions(doc, null), []);
      for (const op of WORKFLOW_ACTIONS) {
        await assert.rejects(() => OPS[op](null, base.id, base.w), (e) => e.code === "UNAUTHORIZED", op);
      }
    });
  });
}

describe("agreement: privacy of the list", () => {
  it("an ordinary USER who is not the grantee has NO actions in any state, so a pending grant is invisible to them", async () => {
    for (const [name, build] of Object.entries(SCENARIOS)) {
      const base = await build();
      for (const cls of ["reporter", "other"]) {
        const { actions } = await getIssueWorkflowView(asActor(base.w[cls]), base.id);
        assert.deepEqual(actions, [], `${name} / ${cls}`);
      }
    }
  });

  it("grantee operations appear only for the grantee of the current grant", async () => {
    const base = await SCENARIOS["acknowledged, grant pending"]();
    const granteeView = await getIssueWorkflowView(asActor(base.w.grantee), base.id);
    assert.deepEqual(granteeView.actions, ["remediation.accept", "remediation.decline"]);
    for (const cls of CLASSES.filter((c) => c !== "grantee")) {
      const { actions } = await getIssueWorkflowView(asActor(base.w[cls]), base.id);
      assert.ok(!actions.some((a) => /accept|decline|release|start|resolve/.test(a)), `${cls} must not receive grantee actions`);
    }
  });
});

describe("ADMIN as a remediation grantee (ADR-0007 section 2): role governs, the grant confers participation", () => {
  const view = async (stage) => {
    const base = await adminGranteeAt(stage);
    return (await getIssueWorkflowView(asActor(base.w.admin), base.id)).actions;
  };

  it("pending: revoke by role, plus accept/decline by the record", async () => {
    assert.deepEqual(await view("pending"), ["remediation.revoke", "remediation.accept", "remediation.decline"]);
  });

  it("accepted (acknowledged): revoke, release, start", async () => {
    assert.deepEqual(await view("accepted"), ["remediation.revoke", "remediation.release", "remediation.start"]);
  });

  it("in_progress: revoke, release, resolve", async () => {
    assert.deepEqual(await view("in_progress"), ["remediation.revoke", "remediation.release", "remediation.resolve"]);
  });

  it("resolved by that ADMIN: nothing (no grant operations, and ADMIN can never verify or fail)", async () => {
    assert.deepEqual(await view("resolved"), []);
  });

  it("an ADMIN is never offered acknowledge, grant, withdraw, verify or fail, grantee or not", async () => {
    for (const stage of ["pending", "accepted", "in_progress", "resolved"]) {
      const actions = await view(stage);
      for (const forbidden of ["acknowledge", "remediation.grant", "remediation.withdraw", "resolution.verify", "resolution.fail"]) {
        assert.ok(!actions.includes(forbidden), `${stage}: ${forbidden}`);
      }
    }
  });
});
