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

describe("password reset — account-state policy", () => {
  async function createUserWithState(state, email = "reset-state@example.test") {
    const u = await User.create({
      name: "State User",
      email,
      passwordHash: await hashPassword("original-password"),
    });
    if (state !== "ACTIVE") {
      await User.updateOne({ _id: u._id }, { $set: { accountState: state } });
    }
    return u;
  }

  async function getTokenForUser(user) {
    let token;
    await requestPasswordReset(user.email, async (_email, raw) => { token = raw; });
    return token;
  }

  it("ACTIVE accounts: reset proceeds and password is changed", async () => {
    const user = await createUserWithState("ACTIVE");
    const token = await getTokenForUser(user);
    const result = await resetPassword({ token, password: "new-password-active" });
    assert.deepEqual(result, { success: true });
    const updated = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("new-password-active", updated.passwordHash), true);
  });

  it("MUTED accounts: reset proceeds (muting is a contribution restriction, not a credential block)", async () => {
    const user = await createUserWithState("MUTED");
    const token = await getTokenForUser(user);
    const result = await resetPassword({ token, password: "new-password-muted" });
    assert.deepEqual(result, { success: true });
    const updated = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("new-password-muted", updated.passwordHash), true);
  });

  it("HARD_SUSPENDED accounts: reset is rejected with the same opaque error as an invalid token", async () => {
    const user = await createUserWithState("HARD_SUSPENDED");
    const token = await getTokenForUser(user);
    await assert.rejects(
      resetPassword({ token, password: "new-password" }),
      (err) => {
        assert.equal(err.code, "PASSWORD_RESET_INVALID");
        assert.match(err.message, /invalid or has expired/i);
        return true;
      }
    );
  });

  it("DELETION_PENDING accounts: reset is rejected; credential is consumed so it cannot be reused after state changes", async () => {
    const user = await createUserWithState("DELETION_PENDING");
    const token = await getTokenForUser(user);
    await assert.rejects(
      resetPassword({ token, password: "new-password" }),
      { code: "PASSWORD_RESET_INVALID" }
    );
    // Credential is consumed — same token fails again even if state were ACTIVE
    await User.updateOne({ _id: user._id }, { $set: { accountState: "ACTIVE" } });
    await assert.rejects(
      resetPassword({ token, password: "new-password" }),
      { code: "PASSWORD_RESET_INVALID" }
    );
  });

  it("PERMANENTLY_DELETED accounts: reset is rejected and password is not changed", async () => {
    const user = await createUserWithState("PERMANENTLY_DELETED");
    const token = await getTokenForUser(user);
    await assert.rejects(
      resetPassword({ token, password: "new-password" }),
      { code: "PASSWORD_RESET_INVALID" }
    );
    // Password must remain unchanged
    const unchanged = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("original-password", unchanged.passwordHash), true);
  });

  it("blocked-state rejection returns the same opaque error regardless of which state is set (no state enumeration)", async () => {
    for (const state of ["HARD_SUSPENDED", "DELETION_PENDING", "PERMANENTLY_DELETED"]) {
      const email = `policy-${state.toLowerCase()}@example.test`;
      const user = await createUserWithState(state, email);
      const token = await getTokenForUser(user);
      await assert.rejects(
        resetPassword({ token, password: "probe" }),
        (e) => {
          assert.equal(e.code, "PASSWORD_RESET_INVALID", `state ${state} should give same error code`);
          return true;
        }
      );
    }
  });
});

describe("password reset — failure-boundary and rollback semantics", () => {
  it("credential is consumed before the state check; a blocked account cannot reuse the same token", async () => {
    // The credential is consumed atomically by findOneAndDelete BEFORE the
    // state check, so an attacker cannot retry the same token after the
    // state changes.
    const user = await User.create({
      name: "Rollback User",
      email: "rollback@example.test",
      passwordHash: await hashPassword("original-password"),
    });
    await User.updateOne({ _id: user._id }, { $set: { accountState: "HARD_SUSPENDED" } });

    let token;
    await requestPasswordReset(user.email, async (_e, raw) => { token = raw; });

    // First attempt fails (blocked state) but consumes the credential
    await assert.rejects(resetPassword({ token, password: "attempt-1" }), { code: "PASSWORD_RESET_INVALID" });

    // Restore to ACTIVE — but the credential is gone, so it must still fail
    await User.updateOne({ _id: user._id }, { $set: { accountState: "ACTIVE" } });
    await assert.rejects(resetPassword({ token, password: "attempt-2" }), { code: "PASSWORD_RESET_INVALID" });

    // Password is unchanged throughout
    const unchanged = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("original-password", unchanged.passwordHash), true);
  });

  it("existing refresh sessions are not invalidated when reset is rejected due to blocked account state", async () => {
    const user = await User.create({
      name: "Session Guard",
      email: "session-guard@example.test",
      passwordHash: await hashPassword("original-password"),
    });
    await Session.create({ userId: user._id, tokenHash: "guard-session", expiresAt: new Date(Date.now() + 60_000) });
    await User.updateOne({ _id: user._id }, { $set: { accountState: "HARD_SUSPENDED" } });

    let token;
    await requestPasswordReset(user.email, async (_e, raw) => { token = raw; });
    await assert.rejects(resetPassword({ token, password: "new-password" }), { code: "PASSWORD_RESET_INVALID" });

    // Session must remain intact — only a successful reset should clear sessions
    assert.equal(await Session.countDocuments({ userId: user._id }), 1);
  });

  it("a successful reset always consumes the credential making it unreusable", async () => {
    const user = await User.create({
      name: "No Reuse",
      email: "noreuse@example.test",
      passwordHash: await hashPassword("original-password"),
    });

    let token;
    await requestPasswordReset(user.email, async (_e, raw) => { token = raw; });
    await resetPassword({ token, password: "first-new-password" });

    // Same token must not work again
    await assert.rejects(resetPassword({ token, password: "second-new-password" }), { code: "PASSWORD_RESET_INVALID" });

    // Password remains the first new value
    const updated = await User.findById(user._id).select("+passwordHash");
    assert.equal(await verifyPassword("first-new-password", updated.passwordHash), true);
    assert.equal(await verifyPassword("second-new-password", updated.passwordHash), false);
  });
});
