import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const VALID_PASSWORD = "correcthorsebatterystaple";

/**
 * Builds a minimal fake Express req/res pair for unit-testing the
 * middleware function directly, without a running Express app or
 * cookie-parser. `req.cookies` is populated manually here exactly the
 * way cookie-parser would populate it in a real request — this is a
 * legitimate stand-in for that middleware's output, not a shortcut
 * around anything this test is supposed to prove: authMiddleware's own
 * logic starts from `req.cookies`, so constructing that object
 * directly tests exactly the code path in question.
 */
function fakeRequest(cookies = {}) {
  return { cookies };
}

function fakeResponse() {
  return {};
}

async function runMiddleware(req) {
  const res = fakeResponse();
  let nextCalled = false;
  await authMiddleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, "authMiddleware must always call next() — it never short-circuits the request itself");
  return req.actorContext;
}

async function registerUser(overrides = {}) {
  return register({
    name: "Test User",
    email: "test@example.com",
    password: VALID_PASSWORD,
    ...overrides,
  });
}

describe("authMiddleware — actorContext resolution", () => {
  it("valid access token: actorContext populated correctly with { id, role }", async () => {
    const { user, accessToken } = await registerUser();
    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: accessToken });

    const actorContext = await runMiddleware(req);

    assert.deepEqual(Object.keys(actorContext).sort(), ["id", "role"]);
    assert.equal(String(actorContext.id), String(user.id));
    assert.equal(actorContext.role, "USER");
  });

  it("missing cookie entirely: actorContext = null, next() still called (anonymous browsing must keep working — Invariant 5)", async () => {
    const req = fakeRequest({}); // no access_token key at all

    const actorContext = await runMiddleware(req);

    assert.equal(actorContext, null);
  });

  it("malformed/tampered token (bad signature): actorContext = null, does not throw", async () => {
    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: "not-a-real-jwt" });

    const actorContext = await runMiddleware(req);

    assert.equal(actorContext, null);
  });

  it("expired token: actorContext = null, not a hard throw at the middleware layer", async () => {
    // Construct an access token that's already expired by signing one
    // with a negative/zero lifetime via a direct jsonwebtoken call
    // mirroring signAccessToken's own secret/algorithm, rather than
    // waiting for a real token to expire (which would make this test
    // slow and flaky).
    const jwt = (await import("jsonwebtoken")).default;
    const { user } = await registerUser();
    const alreadyExpired = jwt.sign(
      { sub: String(user.id) },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: -10 } // 10 seconds in the past
    );

    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: alreadyExpired });
    const actorContext = await runMiddleware(req);

    assert.equal(actorContext, null);
  });

  it("user deleted after token issuance: actorContext = null (L11's concrete regression test)", async () => {
    const { user, accessToken } = await registerUser();

    await User.deleteOne({ _id: user.id });

    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: accessToken });
    const actorContext = await runMiddleware(req);

    assert.equal(actorContext, null);
  });

  it("changed role is reflected freshly: the SAME still-valid access token reflects a role change made after it was issued (role is never trusted from the token)", async () => {
    const { user, accessToken } = await registerUser();

    // Simulate an admin action outside this request, made after the
    // access token was already issued.
    await User.updateOne({ _id: user.id }, { $set: { role: "EXPERT" } });

    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: accessToken });
    const actorContext = await runMiddleware(req);

    assert.equal(actorContext.role, "EXPERT", "the middleware must read role fresh from the DB, not from the (still-valid, unchanged) token payload");
  });

  it("a malformed sub (not a valid ObjectId) inside an otherwise well-signed token resolves to actorContext = null, not a thrown CastError", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const tokenWithBadSub = jwt.sign(
      { sub: "not-a-valid-object-id" },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );

    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: tokenWithBadSub });
    const actorContext = await runMiddleware(req);

    assert.equal(actorContext, null);
  });

  it("never populates any field beyond { id, role } — no email, name, or other User field leaks into actorContext", async () => {
    const { accessToken } = await registerUser();
    const req = fakeRequest({ [ACCESS_TOKEN_COOKIE_NAME]: accessToken });

    const actorContext = await runMiddleware(req);

    assert.deepEqual(Object.keys(actorContext).sort(), ["id", "role"]);
  });
});
