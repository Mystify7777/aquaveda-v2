import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";

import { createApp } from "../src/app.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { REFRESH_TOKEN_COOKIE_NAME } from "../src/routes/auth.routes.js";
import { refresh, logout } from "../src/services/auth.service.js";
import {
  JWT_ALGORITHM,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/services/auth-tokens.js";

/**
 * JWT verification contract (#139): issued tokens are HS256 with `exp`;
 * verification is pinned to HS256 and REQUIRES `exp`. Exercises the real
 * verification functions directly, then the generic-failure behavior of their
 * callers. No database is involved: every rejection happens before any DB read.
 */

const ACCESS_SECRET = "unit-access-secret-0123456789abcdef-aaaa";
const REFRESH_SECRET = "unit-refresh-secret-0123456789abcdef-bbbb";
const SUB = "507f1f77bcf86cd799439011";
const SID = "507f1f77bcf86cd799439022";

const saved = {};
const ENV_KEYS = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "JWT_ACCESS_EXPIRES", "JWT_REFRESH_EXPIRES", "ALLOWED_ORIGINS"];

before(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  delete process.env.JWT_ACCESS_EXPIRES;
  delete process.env.JWT_REFRESH_EXPIRES;
});
after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const nowSec = () => Math.floor(Date.now() / 1000);
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const KINDS = [
  {
    name: "access",
    secret: ACCESS_SECRET,
    otherSecret: REFRESH_SECRET,
    claims: { sub: SUB },
    sign: () => signAccessToken({ sub: SUB }),
    verify: verifyAccessToken,
    expected: { sub: SUB },
  },
  {
    name: "refresh",
    secret: REFRESH_SECRET,
    otherSecret: ACCESS_SECRET,
    claims: { sub: SUB, sid: SID },
    sign: () => signRefreshToken({ sub: SUB, sid: SID }),
    verify: verifyRefreshToken,
    expected: { sub: SUB, sid: SID },
  },
];

for (const kind of KINDS) {
  describe(`${kind.name} token verification`, () => {
    const mint = (secret, options) => jwt.sign(kind.claims, secret, options);

    it("accepts a valid issued token and returns only the expected claims", () => {
      assert.deepEqual(kind.verify(kind.sign()), kind.expected);
    });

    it("issuer contract: issued tokens are HS256 and carry a numeric exp", () => {
      const { header, payload } = jwt.decode(kind.sign(), { complete: true });
      assert.equal(JWT_ALGORITHM, "HS256");
      assert.equal(header.alg, "HS256");
      assert.equal(typeof payload.exp, "number");
      assert.ok(payload.exp > nowSec());
    });

    it("rejects HS384 signed with the correct secret", () => {
      const token = mint(kind.secret, { algorithm: "HS384", expiresIn: "5m" });
      assert.equal(jwt.decode(token, { complete: true }).header.alg, "HS384");
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects HS512 signed with the correct secret", () => {
      const token = mint(kind.secret, { algorithm: "HS512", expiresIn: "5m" });
      assert.equal(jwt.decode(token, { complete: true }).header.alg, "HS512");
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects an HS256 token signed with the correct secret but without exp", () => {
      const token = mint(kind.secret, { algorithm: "HS256" });
      assert.equal(jwt.decode(token).exp, undefined);
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects a correctly signed HS256 token whose exp is not a number", () => {
      // jwt.sign refuses a string exp, so forge the token by hand (valid HMAC).
      const signingInput = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...kind.claims, exp: "9999999999" })}`;
      const signature = createHmac("sha256", kind.secret).update(signingInput).digest("base64url");
      assert.throws(() => kind.verify(`${signingInput}.${signature}`), jwt.JsonWebTokenError);
    });

    it("rejects an expired token (deterministic: explicit past exp)", () => {
      const token = jwt.sign({ ...kind.claims, exp: nowSec() - 60 }, kind.secret, { algorithm: "HS256" });
      assert.throws(() => kind.verify(token), jwt.TokenExpiredError);
    });

    it("rejects a token signed with the wrong secret", () => {
      const token = mint("some-completely-different-secret-0123456789", { algorithm: "HS256", expiresIn: "5m" });
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects alg=none (unsigned)", () => {
      const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...kind.claims, exp: nowSec() + 300 })}.`;
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects alg=none even when a signature segment is appended", () => {
      const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...kind.claims, exp: nowSec() + 300 })}.c2ln`;
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it(`rejects a ${kind.name} token signed with the other kind's secret (secret confusion)`, () => {
      const token = mint(kind.otherSecret, { algorithm: "HS256", expiresIn: "5m" });
      assert.throws(() => kind.verify(token), jwt.JsonWebTokenError);
    });

    it("rejects malformed input", () => {
      for (const bad of ["", "not-a-jwt", "a.b", "a.b.c"]) assert.throws(() => kind.verify(bad));
    });
  });
}

describe("token kinds are not interchangeable", () => {
  it("an issued access token fails refresh verification and vice versa", () => {
    assert.throws(() => verifyRefreshToken(signAccessToken({ sub: SUB })));
    assert.throws(() => verifyAccessToken(signRefreshToken({ sub: SUB, sid: SID })));
  });
});

describe("callers keep the generic failure behavior", () => {
  const rejected = () => ({
    "HS384 (correct secret)": {
      access: jwt.sign({ sub: SUB }, ACCESS_SECRET, { algorithm: "HS384", expiresIn: "5m" }),
      refresh: jwt.sign({ sub: SUB, sid: SID }, REFRESH_SECRET, { algorithm: "HS384", expiresIn: "5m" }),
    },
    "HS512 (correct secret)": {
      access: jwt.sign({ sub: SUB }, ACCESS_SECRET, { algorithm: "HS512", expiresIn: "5m" }),
      refresh: jwt.sign({ sub: SUB, sid: SID }, REFRESH_SECRET, { algorithm: "HS512", expiresIn: "5m" }),
    },
    "no exp": {
      access: jwt.sign({ sub: SUB }, ACCESS_SECRET, { algorithm: "HS256" }),
      refresh: jwt.sign({ sub: SUB, sid: SID }, REFRESH_SECRET, { algorithm: "HS256" }),
    },
    expired: {
      access: jwt.sign({ sub: SUB, exp: nowSec() - 60 }, ACCESS_SECRET, { algorithm: "HS256" }),
      refresh: jwt.sign({ sub: SUB, sid: SID, exp: nowSec() - 60 }, REFRESH_SECRET, { algorithm: "HS256" }),
    },
    "alg=none": {
      access: `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUB, exp: nowSec() + 300 })}.`,
      refresh: `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUB, sid: SID, exp: nowSec() + 300 })}.`,
    },
  });

  it("authMiddleware treats every rejected access token as anonymous (actorContext null, next called)", async () => {
    for (const [label, t] of Object.entries(rejected())) {
      const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: t.access } };
      let nextCalled = false;
      await authMiddleware(req, {}, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true, label);
      assert.equal(req.actorContext, null, label);
    }
  });

  it("refresh() rejects every bad refresh token with the same generic REFRESH_FAILED (no library detail)", async () => {
    const garbage = await refresh("garbage").then(
      () => assert.fail("must reject"),
      (e) => e,
    );
    for (const [label, t] of Object.entries(rejected())) {
      const err = await refresh(t.refresh).then(
        () => assert.fail(`${label} must reject`),
        (e) => e,
      );
      assert.equal(err.code, "REFRESH_FAILED", label);
      assert.equal(err.message, garbage.message, label);
      assert.ok(!/HS\d|alg|jwt|secret|exp/i.test(err.message), `${label}: message leaks detail`);
      assert.equal(err.details, undefined, label);
    }
  });

  it("logout() stays an idempotent no-op success for every bad refresh token", async () => {
    for (const [label, t] of Object.entries(rejected())) {
      assert.deepEqual(await logout(t.refresh), { success: true }, label);
    }
  });
});

describe("HTTP responses stay generic (no JWT detail)", () => {
  const ORIGIN = "http://allowed.example.com";
  let server;
  let base;

  before(async () => {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => defaultStore.reset());

  function call(method, path, cookie) {
    return new Promise((resolve, reject) => {
      const headers = { Origin: ORIGIN };
      if (cookie) headers.Cookie = cookie;
      const req = http.request(`${base}${path}`, { method, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  const BAD = {
    HS384: [
      jwt.sign({ sub: SUB }, ACCESS_SECRET, { algorithm: "HS384", expiresIn: "5m" }),
      jwt.sign({ sub: SUB, sid: SID }, REFRESH_SECRET, { algorithm: "HS384", expiresIn: "5m" }),
    ],
    "no exp": [
      jwt.sign({ sub: SUB }, ACCESS_SECRET, { algorithm: "HS256" }),
      jwt.sign({ sub: SUB, sid: SID }, REFRESH_SECRET, { algorithm: "HS256" }),
    ],
    "alg=none": [
      `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUB, exp: nowSec() + 300 })}.`,
      `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUB, sid: SID, exp: nowSec() + 300 })}.`,
    ],
  };

  it("GET /auth/me with a rejected access token is byte-identical to a request with no cookie", async () => {
    const anonymous = await call("GET", "/api/v1/auth/me");
    for (const [label, [access]] of Object.entries(BAD)) {
      const res = await call("GET", "/api/v1/auth/me", `${ACCESS_TOKEN_COOKIE_NAME}=${access}`);
      assert.equal(res.status, anonymous.status, label);
      assert.equal(res.text, anonymous.text, label);
    }
  });

  it("POST /auth/refresh with a rejected refresh token is byte-identical to a garbage token and leaks nothing", async () => {
    const garbage = await call("POST", "/api/v1/auth/refresh", `${REFRESH_TOKEN_COOKIE_NAME}=garbage`);
    assert.equal(garbage.status, 401);
    for (const [label, [, refreshToken]] of Object.entries(BAD)) {
      defaultStore.reset();
      const res = await call("POST", "/api/v1/auth/refresh", `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}`);
      assert.equal(res.status, garbage.status, label);
      assert.equal(res.text, garbage.text, label);
      assert.ok(!/HS\d|alg|jwt|secret|signature|exp/i.test(res.text), `${label}: body leaks detail`);
      assert.ok(!res.text.includes(refreshToken), `${label}: body echoes the token`);
    }
  });
});
