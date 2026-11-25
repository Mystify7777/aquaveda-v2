import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasRole } from "../src/domain/actor.js";
import { isGrantee } from "../src/domain/remediation.js";
import { resolverOf } from "../src/domain/issue-lifecycle.js";
import { WORKFLOW_ACTIONS, evaluateWorkflowActions } from "../src/domain/workflow-actions.js";

/** Pure evaluator tests (#workflow-actions): no database. Positive AND negative cases. */

const EXPERT = { id: "e1", role: "EXPERT" };
const EXPERT2 = { id: "e2", role: "EXPERT" };
const ADMIN = { id: "a1", role: "ADMIN" };
const USER = { id: "u1", role: "USER" };
const GRANTEE = { id: "g1", role: "USER" };

const grant = (over = {}) => ({ grantId: "G", actor: "g1", grantedBy: "e1", acceptedAt: null, ...over });
const T = new Date("2026-01-01T00:00:00Z");
const hist = (...entries) => entries.map(([toStatus, actor]) => ({ toStatus, actor, timestamp: T }));
const issue = (status, over = {}) => ({ status, statusHistory: [], ...over });
const acts = (i, a) => evaluateWorkflowActions(i, a);

describe("evaluateWorkflowActions: the action vocabulary", () => {
  it("is exactly the fourteen operations that exist today, in a stable order", () => {
    assert.deepEqual([...WORKFLOW_ACTIONS], [
      "acknowledge", "remediation.grant", "remediation.withdraw", "remediation.revoke",
      "remediation.accept", "remediation.decline", "remediation.release",
      "remediation.start", "remediation.resolve", "resolution.verify", "resolution.fail",
      "disposition.invalid", "disposition.duplicate", "disposition.withdraw",
    ]);
  });

  it("never returns an action outside the vocabulary, and always in vocabulary order", () => {
    for (const status of ["open", "acknowledged", "in_progress", "resolved", "verified"]) {
      for (const actor of [EXPERT, ADMIN, USER, GRANTEE]) {
        for (const remediation of [undefined, grant(), grant({ acceptedAt: T })]) {
          const out = acts(issue(status, { remediation, statusHistory: hist(["resolved", "g1"]) }), actor);
          assert.deepEqual(out, WORKFLOW_ACTIONS.filter((a) => out.includes(a)));
        }
      }
    }
  });
});

describe("disposed Issues expose no workflow capabilities", () => {
  it("terminal disposition suppresses lifecycle, remediation, and disposition actions", () => {
    const disposed = issue("open", {
      reportedBy: "u1",
      disposition: { type: "invalid" },
    });
    for (const actor of [EXPERT, ADMIN, USER, { id: "u1", role: "USER" }]) {
      assert.deepEqual(acts(disposed, actor), []);
    }
  });
});

describe("no actor, no capabilities", () => {
  it("anonymous / malformed actors get an empty list", () => {
    for (const actor of [null, undefined, {}, { role: "EXPERT" }, { id: "" , role: "EXPERT" }]) {
      assert.deepEqual(acts(issue("open"), actor), [], JSON.stringify(actor));
    }
    assert.deepEqual(acts(null, EXPERT), []);
  });

  it("an ordinary USER with no grant has no actions in any status", () => {
    for (const status of ["open", "acknowledged", "in_progress", "resolved", "verified"]) {
      assert.deepEqual(acts(issue(status), USER), [], status);
    }
  });
});

describe("EXPERT actions follow the status and the grant", () => {
  it("open: acknowledge only", () => assert.deepEqual(acts(issue("open"), EXPERT), ["acknowledge"]));

  it("acknowledged, no grant: grant; with a pending or accepted grant: withdraw (never grant)", () => {
    assert.deepEqual(acts(issue("acknowledged"), EXPERT), ["remediation.grant"]);
    assert.deepEqual(acts(issue("acknowledged", { remediation: grant() }), EXPERT), ["remediation.withdraw"]);
    assert.deepEqual(acts(issue("in_progress", { remediation: grant({ acceptedAt: T }) }), EXPERT), ["remediation.withdraw"]);
  });

  it("an EXPERT never gets the grantee operations or revoke, even for their own grant being absent", () => {
    const out = acts(issue("acknowledged", { remediation: grant({ actor: "e1", acceptedAt: T }) }), EXPERT);
    // e1 IS the accepted grantee here: grantee operations are by record, and withdraw by role
    assert.deepEqual(out, ["remediation.withdraw", "remediation.release", "remediation.start"]);
    assert.ok(!out.includes("remediation.revoke"));
  });

  it("resolved: verify and fail, but verify never for the resolver", () => {
    const resolvedBy = (id) => issue("resolved", { statusHistory: hist(["open", "r"], ["resolved", id]) });
    assert.deepEqual(acts(resolvedBy("g1"), EXPERT), ["resolution.verify", "resolution.fail"]);
    assert.deepEqual(acts(resolvedBy("e1"), EXPERT), ["resolution.fail"]);
    assert.deepEqual(acts(resolvedBy("e1"), EXPERT2), ["resolution.verify", "resolution.fail"]);
  });

  it("resolved with an unreadable resolver grants no verify (the service treats it as an invalid state)", () => {
    assert.deepEqual(acts(issue("resolved", { statusHistory: [] }), EXPERT), ["resolution.fail"]);
    assert.deepEqual(acts(issue("resolved", { statusHistory: hist(["in_progress", "g1"]) }), EXPERT), ["resolution.fail"]);
  });

  it("verified: nothing", () => assert.deepEqual(acts(issue("verified"), EXPERT), []));
});

describe("ADMIN governs, it does not substitute for an EXPERT (Invariant 9)", () => {
  it("only revoke, only while a grant exists in a grant-operation status", () => {
    assert.deepEqual(acts(issue("acknowledged", { remediation: grant() }), ADMIN), ["remediation.revoke"]);
    assert.deepEqual(acts(issue("in_progress", { remediation: grant({ acceptedAt: T }) }), ADMIN), ["remediation.revoke"]);
    for (const [status, remediation] of [["open", undefined], ["acknowledged", undefined], ["resolved", grant({ acceptedAt: T })], ["verified", undefined]]) {
      assert.deepEqual(acts(issue(status, { remediation, statusHistory: hist(["resolved", "g1"]) }), ADMIN), [], status);
    }
  });
});

describe("an ADMIN who is the grantee holds the grant's participation actions as well as revoke (ADR-0007 section 2)", () => {
  const ADMIN_GRANTEE = { id: "g1", role: "ADMIN" };

  it("pending, accepted and in-progress states", () => {
    assert.deepEqual(acts(issue("acknowledged", { remediation: grant() }), ADMIN_GRANTEE), [
      "remediation.revoke", "remediation.accept", "remediation.decline",
    ]);
    assert.deepEqual(acts(issue("acknowledged", { remediation: grant({ acceptedAt: T }) }), ADMIN_GRANTEE), [
      "remediation.revoke", "remediation.release", "remediation.start",
    ]);
    assert.deepEqual(acts(issue("in_progress", { remediation: grant({ acceptedAt: T }) }), ADMIN_GRANTEE), [
      "remediation.revoke", "remediation.release", "remediation.resolve",
    ]);
  });

  it("but never an EXPERT-only action, whatever the grant", () => {
    const out = acts(issue("resolved", { remediation: grant({ acceptedAt: T }), statusHistory: hist(["resolved", "g1"]) }), ADMIN_GRANTEE);
    assert.deepEqual(out, []);
  });
});

describe("grantee operations come from the grant RECORD, never from role", () => {
  it("pending: accept and decline for the grantee only", () => {
    const i = issue("acknowledged", { remediation: grant() });
    assert.deepEqual(acts(i, GRANTEE), ["remediation.accept", "remediation.decline"]);
    for (const other of [USER, ADMIN]) assert.deepEqual(acts(i, other).filter((a) => /accept|decline|release|start|resolve/.test(a)), []);
  });

  it("accepted, acknowledged: release and start; accepted, in_progress: release and resolve", () => {
    assert.deepEqual(acts(issue("acknowledged", { remediation: grant({ acceptedAt: T }) }), GRANTEE), ["remediation.release", "remediation.start"]);
    assert.deepEqual(acts(issue("in_progress", { remediation: grant({ acceptedAt: T }) }), GRANTEE), ["remediation.release", "remediation.resolve"]);
  });

  it("assigned is not enough: a PENDING grantee cannot start or resolve", () => {
    for (const status of ["acknowledged", "in_progress"]) {
      const out = acts(issue(status, { remediation: grant() }), GRANTEE);
      assert.ok(!out.includes("remediation.start") && !out.includes("remediation.resolve"), status);
    }
  });

  it("a non-grantee never sees grantee operations, and a pending grant is invisible to them (same list as no grant)", () => {
    for (const status of ["acknowledged", "in_progress"]) {
      assert.deepEqual(acts(issue(status, { remediation: grant() }), USER), acts(issue(status), USER));
      assert.deepEqual(acts(issue(status, { remediation: grant({ acceptedAt: T }) }), USER), acts(issue(status), USER));
    }
  });

  it("grant operations are unavailable once the issue is resolved or verified", () => {
    for (const status of ["resolved", "verified"]) {
      const out = acts(issue(status, { remediation: grant({ acceptedAt: T }), statusHistory: hist(["resolved", "g1"]) }), GRANTEE);
      assert.deepEqual(out, [], status);
    }
  });
});

describe("shared predicates", () => {
  it("hasRole is strict, single-role equality", () => {
    assert.equal(hasRole({ role: "EXPERT" }, "EXPERT"), true);
    for (const role of ["expert", "EXPERT ", "ADMIN", "", undefined]) assert.equal(hasRole({ role }, "EXPERT"), false, String(role));
    assert.equal(hasRole(null, "EXPERT"), false);
  });

  it("isGrantee needs a grant and a matching actor, pending or accepted", () => {
    assert.equal(isGrantee(undefined, "g1"), false);
    assert.equal(isGrantee(null, "g1"), false);
    assert.equal(isGrantee(grant(), "g1"), true);
    assert.equal(isGrantee(grant({ acceptedAt: T }), "g1"), true);
    assert.equal(isGrantee(grant(), "someone"), false);
    assert.equal(isGrantee(grant(), undefined), false);
  });

  it("resolverOf reads the latest history entry only when it is the resolution", () => {
    assert.equal(resolverOf({ statusHistory: hist(["open", "r"], ["resolved", "g1"]) }), "g1");
    assert.equal(resolverOf({ statusHistory: hist(["resolved", "g1"], ["in_progress", "e1"]) }), null);
    assert.equal(resolverOf({ statusHistory: [] }), null);
    assert.equal(resolverOf({}), null);
    assert.equal(resolverOf(null), null);
  });
});
