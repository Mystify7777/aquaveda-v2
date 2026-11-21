import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { PasswordResetCredential } from "../src/models/PasswordResetCredential.js";
import { hashPassword, verifyPassword } from "../src/services/auth-tokens.js";
import { requestPasswordReset, resetPassword } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

before(async () => setupTestDb());
after(async () => teardownTestDb());
beforeEach(async () => clearCollections());

async function createUser(email = "reset@example.test") {
  return User.create({
    name: "Reset User",
    email,
    passwordHash: await hashPassword("original-password"),
  });
}

describe("password reset service", () => {
  it("returns the same generic result for known and unknown emails and stores only a token hash", async () => {
    await createUser();
    let emailedToken;
    const deliver = async (_email, token) => { emailedToken = token; };

    const known = await requestPasswordReset(" RESET@example.test ", deliver);
    const unknown = await requestPasswordReset("missing@example.test", deliver);

    assert.deepEqual(known, unknown);
    assert.equal(known.success, true);
    assert.ok(emailedToken);
    const stored = await PasswordResetCredential.findOne({}).select("+tokenHash");
    assert.equal(stored.tokenHash, createHash("sha256").update(emailedToken).digest("hex"));
    assert.ok(!stored.tokenHash.includes(emailedToken));
    assert.ok(stored.expiresAt.getTime() > Date.now());
  });

  it("updates the password, invalidates all refresh sessions, and consumes the credential once", async () => {
    const user = await createUser();
    let token;
    await requestPasswordReset(user.email, async (_email, raw) => { token = raw; });
    await Session.create([
      { userId: user._id, tokenHash: "session-one", expiresAt: new Date(Date.now() + 60_000) },
      { userId: user._id, tokenHash: "session-two", expiresAt: new Date(Date.now() + 60_000) },
    ]);

    await resetPassword({ token, password: "new-password-value" });

    const updated = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("new-password-value", updated.passwordHash), true);
    assert.equal(await Session.countDocuments({ userId: user._id }), 0);
    assert.equal(await PasswordResetCredential.countDocuments({ userId: user._id }), 0);
    await assert.rejects(resetPassword({ token, password: "another-password" }), {
      code: "PASSWORD_RESET_INVALID",
    });
  });

  it("rejects invalid and expired credentials with the same safe error", async () => {
    const user = await createUser();
    const expired = "expired-test-token";
    await PasswordResetCredential.create({
      userId: user._id,
      tokenHash: createHash("sha256").update(expired).digest("hex"),
      expiresAt: new Date(Date.now() - 1000),
    });

    for (const token of ["invalid-token", expired]) {
      await assert.rejects(resetPassword({ token, password: "new-password-value" }), (error) => {
        assert.equal(error.code, "PASSWORD_RESET_INVALID");
        assert.match(error.message, /invalid or has expired/i);
        return true;
      });
    }
  });

  it("keeps email delivery failures generic and does not expose transport errors", async () => {
    await createUser();
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const result = await requestPasswordReset("reset@example.test", async () => {
        throw new Error("SMTP error containing sensitive delivery data");
      });
      assert.deepEqual(result, { success: true });
      assert.equal(warnings.some((line) => line.includes("sensitive delivery data")), false);
    } finally {
      console.warn = originalWarn;
    }
  });
});
