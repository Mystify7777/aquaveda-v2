import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sendSuccess, sendError, sendValidationError } from "../src/http/respond.js";
import {
  notFound,
  unauthorized,
  forbidden,
  invalidState,
  invalidParent,
  targetNotFound,
  stateRace,
  invalidCredentials,
  emailAlreadyRegistered,
  refreshFailed,
  authorizationPolicyUnresolved,
  DomainError,
} from "../src/services/errors.js";

/**
 * Pure unit tests for the shared HTTP response utility (ROUTE-L4/L6).
 * No Mongoose, no MongoDB, no Express server — a fake `res` object is
 * enough, mirroring authorization.service.test.js's no-DB pattern.
 */

function fakeRes() {
  const calls = { status: undefined, json: undefined };
  return {
    status(code) {
      calls.status = code;
      return this;
    },
    json(body) {
      calls.json = body;
      return this;
    },
    calls,
  };
}

describe("sendSuccess", () => {
  it("produces exactly {success, data, message} at the default 200 status", () => {
    const res = fakeRes();
    sendSuccess(res, { id: "abc" }, "created");
    assert.equal(res.calls.status, 200);
    assert.deepEqual(res.calls.json, {
      success: true,
      data: { id: "abc" },
      message: "created",
    });
  });

  it("honors an explicit status override", () => {
    const res = fakeRes();
    sendSuccess(res, { id: "abc" }, "created", 201);
    assert.equal(res.calls.status, 201);
  });
});

describe("sendError — mapped DomainErrorCodes", () => {
  const cases = [
    [() => notFound("x not found"), 404],
    [() => unauthorized("no actor"), 401],
    [() => forbidden("nope"), 403],
    [() => invalidState("bad state"), 409],
    [() => invalidParent("bad parent"), 409],
    [() => targetNotFound("no target"), 404],
    [() => stateRace("race"), 409],
    [() => invalidCredentials("bad creds"), 401],
    [() => emailAlreadyRegistered("dupe email"), 409],
    [() => refreshFailed("bad refresh"), 401],
  ];

  for (const [makeErr, expectedStatus] of cases) {
    const err = makeErr();
    it(`${err.code} -> ${expectedStatus}, with the standard failure envelope`, () => {
      const res = fakeRes();
      sendError(res, err);
      assert.equal(res.calls.status, expectedStatus);
      assert.deepEqual(res.calls.json, {
        success: false,
        data: null,
        message: err.message,
        code: err.code,
      });
    });
  }
});

describe("sendError — AUTHORIZATION_POLICY_UNRESOLVED (ROUTE-L4, dedicated regression protection)", () => {
  it("maps to 409, sharing the status with INVALID_STATE/STATE_RACE", () => {
    const res = fakeRes();
    sendError(res, authorizationPolicyUnresolved("D-3a: policy not defined"));
    assert.equal(res.calls.status, 409);
  });

  it("carries code: AUTHORIZATION_POLICY_UNRESOLVED — the field that actually distinguishes it from the other two 409 codes", () => {
    const res = fakeRes();
    sendError(res, authorizationPolicyUnresolved("D-3a: policy not defined"));
    assert.equal(res.calls.json.code, "AUTHORIZATION_POLICY_UNRESOLVED");
  });

  it("is never mapped to 403 (must not collapse into an ordinary FORBIDDEN)", () => {
    const res = fakeRes();
    sendError(res, authorizationPolicyUnresolved("D-3a: policy not defined"));
    assert.notEqual(res.calls.status, 403);
  });
});

describe("sendError — unmapped/unknown errors", () => {
  it("returns the generic 500 body for an unrecognized DomainErrorCode", () => {
    const res = fakeRes();
    const err = new DomainError("SOME_FUTURE_CODE", "internal detail, e.g. a Mongo connection string fragment");
    sendError(res, err);
    assert.equal(res.calls.status, 500);
    assert.deepEqual(res.calls.json, {
      success: false,
      data: null,
      message: "Internal server error",
    });
  });

  it("does not forward the unmapped error's original message", () => {
    const res = fakeRes();
    const err = new DomainError("SOME_FUTURE_CODE", "internal detail that must never reach a client");
    sendError(res, err);
    assert.notEqual(res.calls.json.message, err.message);
  });

  it("returns the generic 500 body for a plain (non-DomainError) exception", () => {
    const res = fakeRes();
    sendError(res, new Error("raw driver error with a stack trace"));
    assert.equal(res.calls.status, 500);
    assert.equal(res.calls.json.message, "Internal server error");
  });
});

describe("sendValidationError", () => {
  function fakeZodError(messages) {
    return { issues: messages.map((message) => ({ message })) };
  }

  it("produces a 400 with the standard failure envelope", () => {
    const res = fakeRes();
    sendValidationError(res, fakeZodError(["title is required"]));
    assert.equal(res.calls.status, 400);
    assert.deepEqual(res.calls.json, {
      success: false,
      data: null,
      message: "title is required",
      code: "VALIDATION_FAILED",
    });
  });

  it("uses only the first issue's message when multiple issues exist", () => {
    const res = fakeRes();
    sendValidationError(res, fakeZodError(["title is required", "body is required"]));
    assert.equal(res.calls.json.message, "title is required");
  });

  it("falls back to a generic message if issues is empty", () => {
    const res = fakeRes();
    sendValidationError(res, fakeZodError([]));
    assert.equal(res.calls.json.message, "Invalid request body");
  });
});
