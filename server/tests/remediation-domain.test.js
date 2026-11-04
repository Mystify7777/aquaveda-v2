import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GRANT_OPERATION_STATUSES,
  REMEDIATION_EVENT_TYPES,
  deriveResponsibilityState,
  isAcceptedGrantee,
  selfGrantPermitted,
} from "../src/domain/remediation.js";

describe("remediation domain rules", () => {
  it("grant operations are limited to acknowledged and in_progress", () => {
    assert.deepEqual([...GRANT_OPERATION_STATUSES], ["acknowledged", "in_progress"]);
  });

  it("defines exactly the six ADR-0007 event types", () => {
    assert.deepEqual([...REMEDIATION_EVENT_TYPES], ["granted", "accepted", "declined", "released", "withdrawn", "revoked"]);
  });

  it("derives unassigned / pending / accepted from the grant record only", () => {
    assert.equal(deriveResponsibilityState(undefined), "unassigned");
    assert.equal(deriveResponsibilityState(null), "unassigned");
    assert.equal(deriveResponsibilityState({ acceptedAt: null }), "pending");
    assert.equal(deriveResponsibilityState({ acceptedAt: new Date() }), "accepted");
  });

  it("only the grantee of an ACCEPTED grant is an accepted grantee (role is not an input)", () => {
    const pending = { actor: "u1", acceptedAt: null };
    const accepted = { actor: "u1", acceptedAt: new Date() };
    assert.equal(isAcceptedGrantee(accepted, "u1"), true);
    assert.equal(isAcceptedGrantee(accepted, "u2"), false);
    assert.equal(isAcceptedGrantee(pending, "u1"), false);
    assert.equal(isAcceptedGrantee(undefined, "u1"), false);
    assert.equal(isAcceptedGrantee({ actor: { toString: () => "u1" }, acceptedAt: new Date() }, "u1"), true);
  });

  it("self-grant is permitted iff expertCount < threshold (boundaries)", () => {
    const t = 5;
    assert.equal(selfGrantPermitted({ expertCount: t - 1, threshold: t }), true);
    assert.equal(selfGrantPermitted({ expertCount: t, threshold: t }), false);
    assert.equal(selfGrantPermitted({ expertCount: t + 1, threshold: t }), false);
    assert.equal(selfGrantPermitted({ expertCount: 0, threshold: 1 }), true);
  });

  it("threshold 0 disables self-grant for every pool size", () => {
    for (const expertCount of [0, 1, 2, 100]) {
      assert.equal(selfGrantPermitted({ expertCount, threshold: 0 }), false);
    }
  });

  it("is conservative about malformed inputs", () => {
    assert.equal(selfGrantPermitted({ expertCount: "1", threshold: 5 }), false);
    assert.equal(selfGrantPermitted({ expertCount: 1, threshold: undefined }), false);
    assert.equal(selfGrantPermitted({ expertCount: NaN, threshold: 5 }), false);
  });
});
