import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { requireActor, requireRole } from "../src/services/authorization.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { fakeActor } from "./helpers/testDb.js";

/**
 * Pure unit tests for the shared authorization primitives
 * (docs/architecture/decision-register.md, AUTH-L1/AUTH-L2). Neither
 * function touches Mongoose or the network, so no DB setup/teardown is
 * needed here — unlike every other tests/*.test.js file in this repo.
 */

describe("requireActor", () => {
  it("throws UNAUTHORIZED for null", () => {
    assert.throws(
      () => requireActor(null),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("throws UNAUTHORIZED for undefined", () => {
    assert.throws(
      () => requireActor(undefined),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("throws UNAUTHORIZED for an empty object", () => {
    assert.throws(
      () => requireActor({}),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("throws UNAUTHORIZED when id is null", () => {
    assert.throws(
      () => requireActor({ id: null, role: "USER" }),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("does not throw for a valid actorContext", () => {
    assert.doesNotThrow(() => requireActor(fakeActor("USER")));
  });
});

describe("requireRole", () => {
  it("throws FORBIDDEN when the role does not match", () => {
    const actor = fakeActor("USER");
    assert.throws(
      () => requireRole(actor, "EXPERT"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });

  it("does not throw when the role matches exactly", () => {
    const actor = fakeActor("EXPERT");
    assert.doesNotThrow(() => requireRole(actor, "EXPERT"));
  });

  it("throws with the canonical message, not a per-call-site sentence", () => {
    const actor = fakeActor("USER");
    assert.throws(
      () => requireRole(actor, "EXPERT"),
      (err) => err.message === "Forbidden: insufficient role privileges",
    );
  });

  it("carries requiredRole and actualRole in details, not in prose", () => {
    const actor = fakeActor("USER");
    try {
      requireRole(actor, "EXPERT");
      assert.fail("expected requireRole to throw");
    } catch (err) {
      assert.equal(err.details.requiredRole, "EXPERT");
      assert.equal(err.details.actualRole, "USER");
    }
  });

  it("ADMIN does not satisfy an EXPERT requirement (Invariant 9)", () => {
    const actor = fakeActor("ADMIN");
    assert.throws(
      () => requireRole(actor, "EXPERT"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });

  it("EXPERT does not satisfy an ADMIN requirement (Invariant 9)", () => {
    const actor = fakeActor("EXPERT");
    assert.throws(
      () => requireRole(actor, "ADMIN"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });
});
