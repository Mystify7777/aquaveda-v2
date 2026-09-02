import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { register, login, refresh, logout } from "../src/services/auth.service.js";
import { hashPassword, verifyPassword, verifyRefreshToken } from "../src/services/auth-tokens.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const VALID_PASSWORD = "correcthorsebatterystaple";

function registerPayload(overrides = {}) {
  return {
    name: "Test User",
    email: "test@example.com",
    password: VALID_PASSWORD,
    ...overrides,
  };
}

describe("auth.service — register", () => {
  it("creates a User with a hashed password, never storing the plaintext", async () => {
    const result = await register(registerPayload());
    assert.equal(result.user.email, "test@example.com");
    assert.equal(result.user.role, "USER");

    const stored = await User.findById(result.user.id).select("+passwordHash");
    assert.notEqual(stored.passwordHash, VALID_PASSWORD);
    assert.ok(stored.passwordHash.startsWith("scrypt:"));
  });

  it("defaults role to USER regardless of what the caller might try to pass", async () => {
    // register()'s payload destructuring only reads {name, email,
    // password} — an extra `role` field, even if present, is never
    // forwarded to User.create(). This test confirms that by actually
    // passing one and checking it has no effect, not just by reading
    // the source.
    const result = await register({ ...registerPayload(), role: "ADMIN" });
    assert.equal(result.user.role, "USER");
  });

  it("immediately issues a working token pair (auto-login on register)", async () => {
    const result = await register(registerPayload());
    assert.ok(typeof result.accessToken === "string" && result.accessToken.length > 0);
    assert.ok(typeof result.refreshToken === "string" && result.refreshToken.length > 0);

    const decoded = verifyRefreshToken(result.refreshToken);
    assert.equal(decoded.sub, String(result.user.id));

    const session = await Session.findById(decoded.sid);
    assert.ok(session, "the Session referenced by the refresh token's sid should exist");
    assert.equal(String(session.userId), String(result.user.id));
  });

  it("rejects a duplicate email via the fast pre-check path", async () => {
    await register(registerPayload());
    await assert.rejects(
      () => register(registerPayload({ name: "Someone Else" })),
      (err) => {
        assert.equal(err.code, DomainErrorCode.EMAIL_ALREADY_REGISTERED);
        return true;
      }
    );
  });

  it("rejects a duplicate email via the unique-index race path, not just the pre-check", async () => {
    // Simulates two registrations racing past the findOne pre-check
    // simultaneously with the same email — the pre-check alone cannot
    // catch this; the database's unique index (and this service's
    // translation of its E11000 error) is the actual backstop.
    const results = await Promise.allSettled([
      register(registerPayload()),
      register(registerPayload({ name: "Racer Two" })),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    assert.equal(succeeded.length, 1, "exactly one concurrent registration should succeed");
    assert.equal(failed.length, 1, "exactly one concurrent registration should fail");
    assert.equal(failed[0].reason.code, DomainErrorCode.EMAIL_ALREADY_REGISTERED);

    const count = await User.countDocuments({ email: "test@example.com" });
    assert.equal(count, 1, "only one User document should exist for the contested email");
  });
});

describe("auth.service — login", () => {
  it("succeeds with correct credentials and issues a token pair", async () => {
    await register(registerPayload());
    const result = await login({ email: "test@example.com", password: VALID_PASSWORD });
    assert.equal(result.user.email, "test@example.com");
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
  });

  it("fails with INVALID_CREDENTIALS and an identical message for a wrong password vs. a nonexistent email (no information leak)", async () => {
    await register(registerPayload());

    let wrongPasswordError;
    await assert.rejects(
      () => login({ email: "test@example.com", password: "wrong-password" }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_CREDENTIALS);
        wrongPasswordError = err;
        return true;
      }
    );

    let nonexistentEmailError;
    await assert.rejects(
      () => login({ email: "nobody@example.com", password: VALID_PASSWORD }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_CREDENTIALS);
        nonexistentEmailError = err;
        return true;
      }
    );

    // The concrete, mechanical test for the information-leak
    // requirement: byte-for-byte identical messages, not just the same
    // error code.
    assert.equal(wrongPasswordError.message, nonexistentEmailError.message);
  });
});

describe("auth.service — refresh", () => {
  it("rotates successfully: old session consumed, new session issued", async () => {
    const { user, refreshToken } = await register(registerPayload());
    const oldDecoded = verifyRefreshToken(refreshToken);

    const rotated = await refresh(refreshToken);
    const newDecoded = verifyRefreshToken(rotated.refreshToken);

    assert.notEqual(newDecoded.sid, oldDecoded.sid, "rotation should produce a new session id");

    const oldSession = await Session.findById(oldDecoded.sid);
    assert.equal(oldSession, null, "the old session should no longer exist after rotation");

    const newSession = await Session.findById(newDecoded.sid);
    assert.ok(newSession, "the new session should exist");
    assert.equal(String(newSession.userId), String(user.id));
  });

  it("returns { user, accessToken, refreshToken }, matching register()/login()'s response shape exactly", async () => {
    const { user, refreshToken } = await register(registerPayload());

    const rotated = await refresh(refreshToken);

    assert.deepEqual(Object.keys(rotated).sort(), ["accessToken", "refreshToken", "user"]);
    assert.equal(String(rotated.user.id), String(user.id));
    assert.equal(rotated.user.email, user.email);
    assert.equal(rotated.user.role, user.role);
  });

  it("rejects a refresh with REFRESH_FAILED for an expired session, even though the document still physically exists (TTL is not the enforcement mechanism)", async () => {
    const { refreshToken } = await register(registerPayload());
    const decoded = verifyRefreshToken(refreshToken);

    // Directly backdate expiresAt into the past — simulates "logically
    // expired but not yet swept by MongoDB's periodic TTL monitor,"
    // which a real TTL sweep cannot be relied on to reproduce
    // deterministically in a fast test run.
    await Session.updateOne({ _id: decoded.sid }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    await assert.rejects(
      () => refresh(refreshToken),
      (err) => {
        assert.equal(err.code, DomainErrorCode.REFRESH_FAILED);
        return true;
      }
    );

    // The document must still exist — this test is only meaningful if
    // the rejection came from the service's independent expiry check,
    // not from the document having already been deleted.
    const stillExists = await Session.findById(decoded.sid);
    assert.ok(stillExists, "the expired session should still physically exist (TTL sweep hasn't run)");
  });

  it("rejects a malformed/tampered refresh token with REFRESH_FAILED", async () => {
    await assert.rejects(
      () => refresh("not-a-real-jwt"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.REFRESH_FAILED);
        return true;
      }
    );
  });

  it("rejects reuse of an already-rotated (superseded) refresh token", async () => {
    const { refreshToken } = await register(registerPayload());
    await refresh(refreshToken); // first use — legitimate rotation

    await assert.rejects(
      () => refresh(refreshToken), // second use of the SAME now-superseded token
      (err) => {
        assert.equal(err.code, DomainErrorCode.REFRESH_FAILED);
        return true;
      }
    );
  });

  it("concurrency: two simultaneous refresh attempts with the identical refresh token — exactly one succeeds", async () => {
    const { refreshToken } = await register(registerPayload());

    const results = await Promise.allSettled([refresh(refreshToken), refresh(refreshToken)]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    assert.equal(succeeded.length, 1, "exactly one of the two concurrent refresh attempts should succeed");
    assert.equal(failed.length, 1, "exactly one of the two concurrent refresh attempts should fail");
    assert.equal(failed[0].reason.code, DomainErrorCode.REFRESH_FAILED);

    // Confirm the "winner" produced a real, working new session — not
    // just that the count of successes/failures was correct.
    const newDecoded = verifyRefreshToken(succeeded[0].value.refreshToken);
    const newSession = await Session.findById(newDecoded.sid);
    assert.ok(newSession, "the winning refresh's new session should exist");
  });
});

describe("auth.service — logout", () => {
  it("deletes the session, invalidating future refresh attempts", async () => {
    const { refreshToken } = await register(registerPayload());
    const decoded = verifyRefreshToken(refreshToken);

    await logout(refreshToken);

    const session = await Session.findById(decoded.sid);
    assert.equal(session, null);

    await assert.rejects(
      () => refresh(refreshToken),
      (err) => {
        assert.equal(err.code, DomainErrorCode.REFRESH_FAILED);
        return true;
      }
    );
  });

  it("is idempotent: logging out twice, an already-consumed token, a malformed token, or no token at all — none of these throw", async () => {
    const { refreshToken } = await register(registerPayload());

    await logout(refreshToken);
    await assert.doesNotReject(() => logout(refreshToken)); // second call, same (now-orphaned) token
    await assert.doesNotReject(() => logout("not-a-real-jwt")); // malformed
    await assert.doesNotReject(() => logout(undefined)); // no token at all
    await assert.doesNotReject(() => logout(null));
  });

  it("logout with a well-formed but expired refresh token still succeeds as a no-op", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const { refreshToken } = await register(registerPayload());
    const decoded = verifyRefreshToken(refreshToken);
    const expiredToken = jwt.sign(
      { sub: decoded.sub, sid: decoded.sid },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: -10 }
    );

    await assert.doesNotReject(() => logout(expiredToken));
  });
});

describe("auth-tokens — hashPassword/verifyPassword (exercised indirectly above, direct edge cases here)", () => {
  it("produces a different hash for the same password on each call (random salt)", async () => {
    const a = await hashPassword(VALID_PASSWORD);
    const b = await hashPassword(VALID_PASSWORD);
    assert.notEqual(a, b, "two hashes of the same password should differ due to random salting");
  });

  describe("verifyPassword — malformed stored hash handling (review-pass correction)", () => {
    // These all construct a syntactically-plausible but corrupted
    // "scrypt:N:r:p:saltHex:hashHex" string directly, rather than going
    // through hashPassword(), specifically to simulate stored-data
    // corruption or tampering rather than a normal hashing round-trip.
    const validSalt = "aa".repeat(16);
    const validHash = "bb".repeat(64);

    it("rejects (returns false, does not throw) non-hex characters in the salt", async () => {
      const stored = `scrypt:16384:8:1:${"zz".repeat(16)}:${validHash}`;
      await assert.doesNotReject(async () => {
        assert.equal(await verifyPassword("anything", stored), false);
      });
    });

    it("rejects (returns false, does not throw) non-hex characters in the hash", async () => {
      const stored = `scrypt:16384:8:1:${validSalt}:${"zz".repeat(32)}`;
      await assert.doesNotReject(async () => {
        assert.equal(await verifyPassword("anything", stored), false);
      });
    });

    it("rejects an odd-length (invalid) salt hex string", async () => {
      const stored = `scrypt:16384:8:1:${validSalt}a:${validHash}`; // odd length
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects an odd-length (invalid) hash hex string", async () => {
      const stored = `scrypt:16384:8:1:${validSalt}:${validHash}b`; // odd length
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects a non-power-of-two N", async () => {
      const stored = `scrypt:16383:8:1:${validSalt}:${validHash}`;
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects a pathologically large N without attempting the expensive scrypt call (returns quickly, does not throw)", async () => {
      const stored = `scrypt:999999999:8:1:${validSalt}:${validHash}`;
      const start = Date.now();
      const result = await verifyPassword("anything", stored);
      const elapsedMs = Date.now() - start;
      assert.equal(result, false);
      // A real scrypt attempt at this N would either throw slowly or
      // hang trying to allocate memory; explicit validation should
      // reject it near-instantly. Generous bound to avoid test
      // flakiness on a slow CI machine, while still catching "it
      // clearly didn't reject early."
      assert.ok(elapsedMs < 2000, `expected fast rejection, took ${elapsedMs}ms`);
    });

    it("rejects a negative N", async () => {
      const stored = `scrypt:-16384:8:1:${validSalt}:${validHash}`;
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects r = 0", async () => {
      const stored = `scrypt:16384:0:1:${validSalt}:${validHash}`;
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects a non-integer p", async () => {
      const stored = `scrypt:16384:8:1.5:${validSalt}:${validHash}`;
      assert.equal(await verifyPassword("anything", stored), false);
    });

    it("rejects a completely malformed stored string (wrong segment count)", async () => {
      assert.equal(await verifyPassword("anything", "not-a-valid-hash-at-all"), false);
    });

    it("rejects a non-string stored value without throwing", async () => {
      assert.equal(await verifyPassword("anything", null), false);
      assert.equal(await verifyPassword("anything", undefined), false);
    });

    it("still correctly verifies a real, unmodified hashPassword() output after all the above validation was added (no regression)", async () => {
      const stored = await hashPassword(VALID_PASSWORD);
      assert.equal(await verifyPassword(VALID_PASSWORD, stored), true);
      assert.equal(await verifyPassword("wrong-password", stored), false);
    });
  });
});
