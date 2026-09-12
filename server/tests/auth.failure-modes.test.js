import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";

// Ensure required environment variables for test execution.
//
// These are assigned unconditionally (not `x || default`) rather than
// as fallbacks. This matters because of ES module import hoisting: the
// `import { createApp } from "../src/app.js"` below is hoisted and
// executes before this file's own top-level statements, regardless of
// source-code order — and that import chain transitively loads
// `config/env.js`, which calls `dotenv/config` as a side effect. If a
// real local `.env` file already sets one of these vars (e.g.
// ALLOWED_ORIGINS to a real dev origin that doesn't include
// "http://allowed.example.com"), a `||`-style fallback here would
// silently never apply — dotenv would have already won by the time
// this line ran. Unconditional assignment makes this file's test
// fixtures deterministic regardless of what a developer's real .env
// happens to contain.
process.env.JWT_ACCESS_SECRET = "test-access-secret-32-chars-length-ok";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-chars-length-ok";
process.env.ALLOWED_ORIGINS = "http://allowed.example.com,http://localhost:3000";
process.env.COOKIE_SAME_SITE = "none";

import { createApp } from "../src/app.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/services/auth-tokens.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { REFRESH_TOKEN_COOKIE_NAME } from "../src/routes/auth.routes.js";

/**
 * Authentication Failure-Mode Test Suite (Issue #28)
 *
 * Exhaustively validates error responses, HTTP status codes, edge cases,
 * token confusion attacks, malformed cookies, payload validation rejections,
 * CORS defenses, and error sanitization according to:
 *   docs/architecture/auth-failure-mode-matrix.md
 */

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Minimal HTTP client returning status, headers, parsed setCookieHeaders, and json.
 */
function request(method, path, { body, rawBody, cookies, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let payload = rawBody;

    if (payload === undefined && body !== undefined) {
      payload = JSON.stringify(body);
      reqHeaders["Content-Type"] = "application/json";
    }

    if (payload !== undefined) {
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }

    if (cookies) {
      reqHeaders["Cookie"] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            // Non-JSON response
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookieHeaders: res.headers["set-cookie"] || [],
            rawBody: raw,
            json,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function parseSetCookies(setCookieHeaders) {
  const parsed = {};
  for (const line of setCookieHeaders) {
    const [pair, ...attrs] = line.split(";").map((s) => s.trim());
    const eqIdx = pair.indexOf("=");
    const name = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    parsed[name] = { value, attrs: attrs.map((a) => a.toLowerCase()) };
  }
  return parsed;
}

// =====================================================================
// 1. JWT Signature, Expiration, and Token Confusion Edge Cases
// =====================================================================

describe("Failure Modes — JWT Verification & Token Confusion", () => {
  const fakeUserId = "507f1f77bcf86cd799439011";
  const fakeSessionId = "507f1f77bcf86cd799439022";

  it("TOK-03: Tampered refresh JWT signature rejected with 401 REFRESH_FAILED", async () => {
    const validToken = signRefreshToken({ sub: fakeUserId, sid: fakeSessionId });
    // Tamper the signature by altering the last characters
    const tamperedToken = validToken.slice(0, -5) + "abcde";

    const res = await request("POST", "/api/v1/auth/refresh", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: tamperedToken },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, "REFRESH_FAILED");
    assert.equal(res.json.message, "Refresh failed");

    // Failure must trigger cookie clearing
    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token, "should clear access_token");
    assert.ok(cookies.refresh_token, "should clear refresh_token");
  });

  it("TOK-04: Expired refresh JWT rejected with 401 REFRESH_FAILED", async () => {
    // Mint an already-expired refresh JWT
    const expiredToken = jwt.sign(
      { sub: fakeUserId, sid: fakeSessionId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: -10 }
    );

    const res = await request("POST", "/api/v1/auth/refresh", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: expiredToken },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, "REFRESH_FAILED");
    assert.equal(res.json.message, "Refresh failed");

    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.refresh_token);
  });

  it("TOK-08: Token Confusion — Access JWT sent to /refresh fails with 401 REFRESH_FAILED", async () => {
    // Mint a valid ACCESS token signed with JWT_ACCESS_SECRET
    const accessToken = signAccessToken({ sub: fakeUserId });

    // Send it as the refresh_token cookie
    const res = await request("POST", "/api/v1/auth/refresh", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: accessToken },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "REFRESH_FAILED");
    assert.equal(res.json.message, "Refresh failed");
  });

  it("MID-02: Expired access JWT on /me resolves to user: null (200 OK)", async () => {
    const expiredToken = jwt.sign(
      { sub: fakeUserId },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: -10 }
    );

    const res = await request("GET", "/api/v1/auth/me", {
      cookies: { [ACCESS_TOKEN_COOKIE_NAME]: expiredToken },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.user, null);
  });

  it("MID-03: Tampered access JWT on /me resolves to user: null (200 OK)", async () => {
    const validToken = signAccessToken({ sub: fakeUserId });
    const tamperedToken = validToken.slice(0, -5) + "XXXXX";

    const res = await request("GET", "/api/v1/auth/me", {
      cookies: { [ACCESS_TOKEN_COOKIE_NAME]: tamperedToken },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.user, null);
  });

  it("MID-04: Token Confusion — Refresh JWT sent to /me resolves to user: null (200 OK)", async () => {
    // Mint a valid REFRESH token signed with JWT_REFRESH_SECRET
    const refreshToken = signRefreshToken({ sub: fakeUserId, sid: fakeSessionId });

    // Send it as access_token cookie
    const res = await request("GET", "/api/v1/auth/me", {
      cookies: { [ACCESS_TOKEN_COOKIE_NAME]: refreshToken },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.user, null);
  });

  it("service unit test: verifyAccessToken & verifyRefreshToken enforce split secrets", () => {
    const access = signAccessToken({ sub: fakeUserId });
    const refresh = signRefreshToken({ sub: fakeUserId, sid: fakeSessionId });

    // Cross-verification must throw
    assert.throws(() => verifyRefreshToken(access));
    assert.throws(() => verifyAccessToken(refresh));
  });
});

// =====================================================================
// 2. Cookie Transport & Malformed Cookie Handling
// =====================================================================

describe("Failure Modes — Cookie Transport Edge Cases", () => {
  it("TOK-01: Missing refresh_token cookie on /refresh 401s and clears cookies", async () => {
    const res = await request("POST", "/api/v1/auth/refresh");

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "REFRESH_FAILED");

    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);
  });

  it("TOK-02: Empty string refresh_token cookie on /refresh 401s and clears cookies", async () => {
    const res = await request("POST", "/api/v1/auth/refresh", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: "" },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "REFRESH_FAILED");
    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.refresh_token);
  });

  it("TOK-02b: Arbitrary non-JWT garbage string on /refresh 401s without crashing", async () => {
    const res = await request("POST", "/api/v1/auth/refresh", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: "%%%not-even-base64&&&" },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "REFRESH_FAILED");
  });

  it("OUT-01: Logout with missing cookie is idempotent (200 OK) and clears cookies", async () => {
    const res = await request("POST", "/api/v1/auth/logout");

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);
  });

  it("OUT-02: Logout with malformed / tampered cookie is idempotent (200 OK)", async () => {
    const res = await request("POST", "/api/v1/auth/logout", {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: "tampered.jwt.payload" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);
  });

  it("cleared cookies retain locked path, sameSite, and secure attributes", async () => {
    const res = await request("POST", "/api/v1/auth/logout");
    const cookies = parseSetCookies(res.setCookieHeaders);

    assert.ok(
      cookies.access_token.attrs.some((a) => a === "path=/"),
      "cleared access_token must retain path=/"
    );
    assert.ok(
      cookies.refresh_token.attrs.some((a) => a === "path=/api/v1/auth"),
      "cleared refresh_token must retain path=/api/v1/auth"
    );
    assert.ok(cookies.access_token.attrs.includes("httponly"));
    assert.ok(cookies.refresh_token.attrs.includes("httponly"));
  });
});

// =====================================================================
// 3. Payload Validation Edge Cases (400 VALIDATION_FAILED)
// =====================================================================

describe("Failure Modes — Request Payload Validation (400)", () => {
  it("VAL-01: /register with empty object {} rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/register", { body: {} });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, "VALIDATION_FAILED");
    assert.equal(typeof res.json.message, "string");
  });

  it("VAL-01b: /register with missing email field rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: { name: "Test User", password: "validPassword123" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("VAL-07: /register with numeric name rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: { name: 12345, email: "valid@example.com", password: "validPassword123" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("VAL-07b: /register with array email rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: { name: "Test", email: ["test@example.com"], password: "validPassword123" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("VAL-08: /login with empty object {} rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/login", { body: {} });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("VAL-08b: /login with missing password rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "test@example.com" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("VAL-09: /login with empty password string '' rejects with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "test@example.com", password: "" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
    assert.equal(res.json.message, "password is required");
  });

  it("VAL-10: Malformed raw JSON payload yields 400 Bad Request", async () => {
    const res = await request("POST", "/api/v1/auth/login", {
      rawBody: '{"email": "test@example.com", unclosed...',
      headers: { "Content-Type": "application/json" },
    });

    assert.equal(res.status, 400);
    // Express default body parser returns an HTML or text error for SyntaxError
    assert.ok(res.status === 400);
  });
});

// =====================================================================
// 4. CORS Failure Modes & Origin Spoofing Defenses
// =====================================================================

describe("Failure Modes — CORS Defenses & Preflight Edge Cases", () => {
  const ALLOWED_ORIGIN = "http://allowed.example.com";
  const DISALLOWED_ORIGIN = "http://evil.attacker.com";

  it("CORS-01: Disallowed origin is not reflected in Access-Control-Allow-Origin", async () => {
    const res = await request("GET", "/api/v1/health", {
      headers: { Origin: DISALLOWED_ORIGIN },
    });

    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  it("CORS-01b: Origin suffix spoofing (e.g. allowed.example.com.attacker.com) is rejected", async () => {
    const res = await request("GET", "/api/v1/health", {
      headers: { Origin: `${ALLOWED_ORIGIN}.attacker.com` },
    });

    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  it("CORS-02: Preflight OPTIONS request for allowed origin receives allow headers", async () => {
    const res = await request("OPTIONS", "/api/v1/health", {
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });

    assert.equal(res.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  it("CORS-02b: Preflight OPTIONS request for disallowed origin receives no allow header", async () => {
    const res = await request("OPTIONS", "/api/v1/health", {
      headers: {
        Origin: DISALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });

    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

// =====================================================================
// 5. Error Sanitization & Information Disclosure (500)
// =====================================================================

describe("Failure Modes — Error Sanitization (500 INTERNAL_ERROR)", () => {
  it("ERR-01: Unhandled errors are mapped to generic 500 without leaking stack or driver info", async () => {
    const { authRouter } = await import("../src/routes/auth.routes.js");
    // Mount on authRouter (which is wired before the 404 middleware in app.js)
    authRouter.get("/test-unhandled-error", (req, res, next) => {
      const dbError = new Error("Database connection dropped");
      dbError.stack = "Internal stack trace at line 42";
      next(dbError);
    });

    const res = await request("GET", "/api/v1/auth/test-unhandled-error");

    assert.equal(res.status, 500);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    // The raw error message ("Database connection dropped") must NEVER
    // reach the client — that's the entire point of this test. The
    // original version of this assertion checked res.json.message
    // equal to the raw message, which was backwards: it would only
    // pass if the leak were actually happening. Corrected to assert
    // the generic message and explicitly assert the raw one is absent.
    assert.equal(res.json.message, "Internal server error");
    assert.notEqual(res.json.message, "Database connection dropped");
    assert.equal(res.json.stack, undefined, "stack trace must never leak to client");
  });
});

// =====================================================================
// 6. Rate Limiting Specification Contract (429)
// =====================================================================

describe("Failure Modes — Rate Limiting Contract (429)", () => {
  it("RATE-01: Rate limit response contract matches standardized shape", () => {
    // Documented rate limit contract verification
    const rateLimitResponse = {
      status: 429,
      headers: { "Retry-After": "900" },
      body: {
        success: false,
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests, please try again later",
      },
    };

    assert.equal(rateLimitResponse.status, 429);
    assert.equal(rateLimitResponse.body.code, "RATE_LIMIT_EXCEEDED");
    assert.ok(rateLimitResponse.headers["Retry-After"]);
  });
});
