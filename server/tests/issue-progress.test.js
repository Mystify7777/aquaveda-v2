import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ATTENTION_QUEUES,
  NEXT_ACTIONS,
  deriveNextAction,
  deriveProgress,
  deriveResolutionDisputed,
  deriveWaitingSince,
  responsibilityOf,
} from "../src/domain/issue-progress.js";

/** Pure derivation tests (#148 / ADR-0008 §6): no database, no I/O. */

const T = (n) => new Date(Date.UTC(2026, 0, 1, 0, n));
const GRANT = { grantId: "g1", actor: "u1", grantedBy: "u2", grantedAt: T(2) };
const NONE = undefined;
const PENDING = { ...GRANT, acceptedAt: null };
const ACCEPTED = { ...GRANT, acceptedAt: T(3) };

describe("responsibilityOf", () => {
  it("none / pending / accepted from the grant record only", () => {
    assert.equal(responsibilityOf({}), "none");
    assert.equal(responsibilityOf({ remediation: null }), "none");
    assert.equal(responsibilityOf({ remediation: {} }), "none");
    assert.equal(responsibilityOf({ remediation: PENDING }), "pending");
    assert.equal(responsibilityOf({ remediation: ACCEPTED }), "accepted");
    assert.equal(responsibilityOf(null), "none");
  });
});

describe("deriveNextAction", () => {
  const cases = [
    // status, grant, expected
    ["open", NONE, "awaiting_acknowledgement"],
    ["acknowledged", NONE, "awaiting_responsible_party"],
    ["acknowledged", PENDING, "awaiting_responsible_party"],
    ["acknowledged", ACCEPTED, "awaiting_start"],
    ["in_progress", NONE, "awaiting_responsible_party"],
    ["in_progress", PENDING, "awaiting_responsible_party"],
    ["in_progress", ACCEPTED, "work_in_progress"],
    ["resolved", NONE, "awaiting_verification"],
    ["resolved", ACCEPTED, "awaiting_verification"],
    ["verified", NONE, "verified"],
    ["verified", ACCEPTED, "verified"],
  ];
  for (const [status, remediation, expected] of cases) {
    it(`${status} + ${responsibilityOf({ remediation })} grant -> ${expected}`, () => {
      assert.equal(deriveNextAction({ status, remediation }), expected);
    });
  }

  it("a PENDING grant is indistinguishable from NO grant in every status (ADR-0007 section 7)", () => {
    for (const status of ["open", "acknowledged", "in_progress", "resolved", "verified"]) {
      assert.equal(
        deriveNextAction({ status, remediation: PENDING }),
        deriveNextAction({ status, remediation: NONE }),
        status,
      );
    }
  });

  it("every code it can return is a documented code, and each documented code is reachable", () => {
    const seen = new Set();
    for (const [status, remediation] of cases) seen.add(deriveNextAction({ status, remediation }));
    assert.deepEqual([...seen].sort(), [...NEXT_ACTIONS].sort());
  });

  it("an unknown status yields null instead of throwing (and never a lifecycle code)", () => {
    assert.equal(deriveNextAction({ status: "legacy" }), null);
    assert.equal(deriveNextAction(undefined), null);
  });

  it("does not depend on who the grantee is", () => {
    const a = deriveNextAction({ status: "in_progress", remediation: { ...ACCEPTED, actor: "alice" } });
    const b = deriveNextAction({ status: "in_progress", remediation: { ...ACCEPTED, actor: "bob" } });
    assert.equal(a, b);
  });
});

describe("deriveWaitingSince", () => {
  it("is the latest statusHistory timestamp", () => {
    const issue = {
      createdAt: T(0),
      statusHistory: [
        { fromStatus: null, toStatus: "open", timestamp: T(0) },
        { fromStatus: "open", toStatus: "acknowledged", timestamp: T(5) },
        { fromStatus: "acknowledged", toStatus: "in_progress", timestamp: T(9) },
      ],
    };
    assert.equal(deriveWaitingSince(issue), issue.statusHistory[2].timestamp);
  });

  it("for an open Issue it is the report itself (the initial history entry)", () => {
    const issue = { createdAt: T(0), statusHistory: [{ fromStatus: null, toStatus: "open", timestamp: T(1) }] };
    assert.equal(deriveWaitingSince(issue), issue.statusHistory[0].timestamp);
  });

  it("is not moved by a grant: only a status change moves it", () => {
    const base = { createdAt: T(0), statusHistory: [{ toStatus: "acknowledged", timestamp: T(4) }] };
    assert.equal(deriveWaitingSince({ ...base, remediation: ACCEPTED }), base.statusHistory[0].timestamp);
  });

  it("falls back to createdAt without history, and to null without either", () => {
    assert.deepEqual(deriveWaitingSince({ createdAt: T(7) }), T(7));
    assert.deepEqual(deriveWaitingSince({ createdAt: T(7), statusHistory: [] }), T(7));
    assert.equal(deriveWaitingSince({}), null);
    assert.equal(deriveWaitingSince(null), null);
  });
});

describe("deriveResolutionDisputed / deriveProgress", () => {
  it("is false for every Issue until disputes exist (ADR-0008 slice 6/7)", () => {
    for (const status of ["open", "acknowledged", "in_progress", "resolved", "verified"]) {
      assert.equal(deriveResolutionDisputed({ status }), false);
    }
    assert.equal(typeof deriveResolutionDisputed({}), "boolean");
  });

  it("deriveProgress returns exactly the three contract fields", () => {
    const out = deriveProgress({ status: "resolved", createdAt: T(0), statusHistory: [{ timestamp: T(3) }] });
    assert.deepEqual(Object.keys(out).sort(), ["nextAction", "resolutionDisputed", "waitingSince"]);
    assert.deepEqual(out, { nextAction: "awaiting_verification", waitingSince: T(3), resolutionDisputed: false });
  });

  it("is pure: the input is not mutated and equal inputs give equal outputs", () => {
    const issue = Object.freeze({
      status: "in_progress",
      createdAt: T(0),
      statusHistory: Object.freeze([Object.freeze({ timestamp: T(2) })]),
      remediation: Object.freeze({ ...ACCEPTED }),
    });
    assert.deepEqual(deriveProgress(issue), deriveProgress(issue));
  });
});

describe("queue identifiers", () => {
  it("are the three documented queues", () => {
    assert.deepEqual([...ATTENTION_QUEUES], ["unacknowledged", "unassigned", "awaiting_verification"]);
  });
});
