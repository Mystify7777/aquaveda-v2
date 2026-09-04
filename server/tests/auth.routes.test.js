import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Minimal, dependency-free HTTP test client built on node:http directly.
 *
 * Deliberately not using `supertest` — Phase F's review explicitly
 * scoped new dependencies to `cookie-parser` and `cors` only ("no
 * unrelated packages"). node:http gives full, reliable access to raw
 * response headers (including multiple Set-Cookie headers as a real
 * array via `res.headers['set-cookie']`), which is exactly what these
 * tests need to verify cookie behavior precisely.
 */
let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function request(method, path, { body, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (cookies) {
      headers["Cookie"] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = rawBody ? JSON.parse(rawBody) : null;
          } catch {
            // non-JSON body, leave json as null
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookieHeaders: res.headers["set-cookie"] || [],
            json,
          });
        });
      }
    );
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

/**
 * Parses the raw Set-Cookie header array into a simple
 * { cookieName: rawCookieValue } map plus attribute strings, enough for
 * these tests to assert on names/values/key attributes without pulling
 * in a cookie-parsing library.
 */
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

function registerBody(overrides = {}) {
  return {
    name: "Test User",
    email: "test@example.com",
    password: "correcthorsebatterystaple",
    ...overrides,
  };
}

describe("POST /api/v1/auth/register", () => {
  it("201s, sets both cookies (HttpOnly), and never returns raw tokens in the body", async () => {
    const res = await request("POST", "/api/v1/auth/register", { body: registerBody() });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(res.json.user.email, "test@example.com");
    assert.equal(res.json.user.role, "USER");
    assert.equal(res.json.accessToken, undefined, "raw access token must never appear in the response body");
    assert.equal(res.json.refreshToken, undefined, "raw refresh token must never appear in the response body");

    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token, "access_token cookie should be set");
    assert.ok(cookies.refresh_token, "refresh_token cookie should be set");
    assert.ok(cookies.access_token.attrs.includes("httponly"));
    assert.ok(cookies.refresh_token.attrs.includes("httponly"));
    assert.ok(
      cookies.refresh_token.attrs.some((a) => a.startsWith("path=/api/v1/auth")),
      "refresh_token cookie should be scoped to /api/v1/auth, not sent on every request"
    );
    assert.ok(
      cookies.access_token.attrs.some((a) => a === "path=/"),
      "access_token cookie should be sent on every request"
    );
  });

  it("409s with EMAIL_ALREADY_REGISTERED for a duplicate email", async () => {
    await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const res = await request("POST", "/api/v1/auth/register", { body: registerBody({ name: "Someone Else" }) });

    assert.equal(res.status, 409);
    assert.equal(res.json.code, "EMAIL_ALREADY_REGISTERED");
  });

  it("Phase G superseded this scenario: a non-string password is now caught by Zod validation (400) before it can ever reach the fragile internal path that used to produce a raw 500", async () => {
    // Before Phase G, this exact payload reached hashPassword()'s
    // crypto.scrypt call with an invalid type and produced an unmapped
    // 500 — which sendDomainError's safety net correctly sanitized (see
    // the Phase F review's own verification of that mechanism). Zod
    // validation now closes this specific hole earlier and more
    // precisely: the request never reaches the service at all.
    const res = await request("POST", "/api/v1/auth/register", {
      body: { name: "Test User", email: "weird@example.com", password: 12345 },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("200s and sets cookies for correct credentials", async () => {
    await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "test@example.com", password: "correcthorsebatterystaple" },
    });

    assert.equal(res.status, 200);
    const cookies = parseSetCookies(res.setCookieHeaders);
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);
  });

  it("401s with INVALID_CREDENTIALS for a wrong password", async () => {
    await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "test@example.com", password: "wrong-password" },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "INVALID_CREDENTIALS");
  });

  it("email normalization: registering with lowercase and logging in with a differently-cased email both succeed (route-level case-insensitivity)", async () => {
    await request("POST", "/api/v1/auth/register", { body: registerBody({ email: "test@example.com" }) });

    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "Test@Example.COM", password: "correcthorsebatterystaple" },
    });

    assert.equal(res.status, 200, "login must succeed despite different email casing than at registration");
  });

  it("does not enforce registration password-length rules — a short password still reaches credential verification and fails on WRONG credentials, not shape", async () => {
    await request("POST", "/api/v1/auth/register", { body: registerBody() });

    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "test@example.com", password: "x" }, // 1 char — would fail registerSchema's min(8), must not fail loginSchema
    });

    assert.equal(res.status, 401, "a too-short password must reach credential verification and fail as wrong credentials, not as a validation error");
    assert.equal(res.json.code, "INVALID_CREDENTIALS");
  });
});

describe("Phase G — request-shape validation (400 VALIDATION_FAILED)", () => {
  it("register: empty/whitespace-only name is rejected with 400 VALIDATION_FAILED", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ name: "   " }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("register: a name longer than 100 characters is rejected", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ name: "a".repeat(101) }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("register: an invalid email format is rejected", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ email: "not-an-email" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("register: email is trimmed and lowercased before reaching the service — the STORED/returned user reflects the canonical form, not the raw input", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ email: "  Test@Example.COM  " }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.email, "test@example.com", "response should reflect the canonicalized email, proving parsed.data (not raw req.body) reached the service");
  });

  it("register: name is trimmed before reaching the service", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ name: "  Trimmed Name  " }),
    });
    assert.equal(res.status, 201);
    // Confirmed indirectly: registration succeeded (a non-trimmed,
    // still-valid name would also succeed on its own, so the
    // meaningful proof of trimming is the email case above and the
    // schema-level unit assertions in verify-validation.js — this test
    // exists mainly to confirm the route doesn't reject a
    // legitimately-padded name outright).
  });

  it("register: password shorter than 8 characters is rejected", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ password: "short1" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("register: password longer than 128 characters is rejected", async () => {
    const res = await request("POST", "/api/v1/auth/register", {
      body: registerBody({ password: "a".repeat(129) }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("login: an invalid email format is rejected with 400, distinct from a credentials failure", async () => {
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "not-an-email", password: "whatever" },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("no validation schema exists for /refresh, /logout, or /me — a missing body never produces a VALIDATION_FAILED response from these routes", async () => {
    const refreshRes = await request("POST", "/api/v1/auth/refresh");
    const logoutRes = await request("POST", "/api/v1/auth/logout");
    const meRes = await request("GET", "/api/v1/auth/me");

    assert.notEqual(refreshRes.json?.code, "VALIDATION_FAILED");
    assert.notEqual(logoutRes.json?.code, "VALIDATION_FAILED");
    assert.notEqual(meRes.json?.code, "VALIDATION_FAILED");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns { user: null } for an anonymous request (no cookie) — 200, not 401 (Invariant 5)", async () => {
    const res = await request("GET", "/api/v1/auth/me");

    assert.equal(res.status, 200);
    assert.equal(res.json.user, null);
  });

  it("returns the resolved actor for a request with a valid access_token cookie", async () => {
    const registerRes = await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const cookies = parseSetCookies(registerRes.setCookieHeaders);

    const res = await request("GET", "/api/v1/auth/me", {
      cookies: { access_token: cookies.access_token.value },
    });

    assert.equal(res.status, 200);
    // actorContext only ever contains { id, role } — no email, name, or
    // other User field (Phase E's contract, re-verified here at the
    // HTTP layer). The earlier version of this test incorrectly
    // asserted `.email`, which can never be present; fixed to assert
    // against the fields that are actually part of the contract.
    assert.equal(res.json.user.role, "USER");
    assert.deepEqual(Object.keys(res.json.user).sort(), ["id", "role"]);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates tokens: 200s, sets new cookies, and old refresh cookie no longer works afterward", async () => {
    const registerRes = await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const oldCookies = parseSetCookies(registerRes.setCookieHeaders);

    const refreshRes = await request("POST", "/api/v1/auth/refresh", {
      cookies: { refresh_token: oldCookies.refresh_token.value },
    });

    assert.equal(refreshRes.status, 200);
    const newCookies = parseSetCookies(refreshRes.setCookieHeaders);
    assert.ok(newCookies.refresh_token);
    assert.notEqual(newCookies.refresh_token.value, oldCookies.refresh_token.value);

    // Old (now-rotated) refresh cookie must no longer work.
    const reuseRes = await request("POST", "/api/v1/auth/refresh", {
      cookies: { refresh_token: oldCookies.refresh_token.value },
    });
    assert.equal(reuseRes.status, 401);
    assert.equal(reuseRes.json.code, "REFRESH_FAILED");
  });

  it("401s and clears cookies for a missing refresh cookie", async () => {
    const res = await request("POST", "/api/v1/auth/refresh");

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "REFRESH_FAILED");
    const cookies = parseSetCookies(res.setCookieHeaders);
    // clearCookie sets an expired cookie with an empty value — presence
    // of the header (even clearing) confirms the failure path cleared
    // stale cookies rather than leaving them in place.
    assert.ok(cookies.access_token);
    assert.ok(cookies.refresh_token);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("200s, clears cookies, and invalidates the refresh token", async () => {
    const registerRes = await request("POST", "/api/v1/auth/register", { body: registerBody() });
    const cookies = parseSetCookies(registerRes.setCookieHeaders);

    const logoutRes = await request("POST", "/api/v1/auth/logout", {
      cookies: { refresh_token: cookies.refresh_token.value },
    });
    assert.equal(logoutRes.status, 200);

    const refreshRes = await request("POST", "/api/v1/auth/refresh", {
      cookies: { refresh_token: cookies.refresh_token.value },
    });
    assert.equal(refreshRes.status, 401);
  });

  it("200s even with no refresh cookie at all (idempotent)", async () => {
    const res = await request("POST", "/api/v1/auth/logout");
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

describe("Auth router self-containment", () => {
  it("the router module never imports a domain service (grep-level scope-boundary check)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/routes/auth.routes.js", import.meta.url),
      "utf8"
    );
    // Checks actual import statements only (via the `from "..."` import
    // specifier syntax), not arbitrary substring occurrence in the
    // file — this router's own header comment legitimately documents
    // (in prose) that it never imports these modules, and a naive
    // substring check would false-positive on that very sentence.
    for (const forbidden of ["issue.service", "knowledge.service", "comment.service", "project.service"]) {
      const importPattern = new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`);
      assert.ok(!importPattern.test(source), `auth.routes.js must not import ${forbidden}`);
    }
  });
});

describe("CORS (review-pass correction: regression coverage)", () => {
  // A dedicated app/server instance with a controlled ALLOWED_ORIGINS
  // value, independent of whatever the developer's real .env happens
  // to contain — this test must be deterministic regardless of local
  // configuration, not accidentally coupled to it.
  const ALLOWED_ORIGIN = "http://allowed.example.com";
  const DISALLOWED_ORIGIN = "http://not-allowed.example.com";

  let corsServer;
  let corsBaseUrl;
  let previousAllowedOrigins;

  before(async () => {
    previousAllowedOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;

    const app = createApp();
    corsServer = http.createServer(app);
    await new Promise((resolve) => corsServer.listen(0, resolve));
    const { port } = corsServer.address();
    corsBaseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => corsServer.close(resolve));
    process.env.ALLOWED_ORIGINS = previousAllowedOrigins;
  });

  function corsRequest(origin) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `${corsBaseUrl}/api/v1/health`,
        { method: "GET", headers: origin ? { Origin: origin } : {} },
        (res) => {
          res.resume(); // drain, body content isn't relevant to these assertions
          res.on("end", () => resolve(res.headers));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("an allowed origin receives Access-Control-Allow-Origin (echoed back) and Access-Control-Allow-Credentials: true", async () => {
    const headers = await corsRequest(ALLOWED_ORIGIN);

    assert.equal(headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(headers["access-control-allow-credentials"], "true");
  });

  it("a disallowed origin receives NO Access-Control-Allow-Origin header at all — not a wildcard, not echoed back", async () => {
    const headers = await corsRequest(DISALLOWED_ORIGIN);

    assert.equal(headers["access-control-allow-origin"], undefined);
    // Confirms the callback(null, false) rejection path (not an error
    // thrown, not a 500) — the request still completes normally, it
    // simply isn't granted cross-origin credentialed access.
  });

  it("a request with no Origin header at all (server-to-server) is not blocked", async () => {
    const headers = await corsRequest(undefined);
    // No Origin header means no CORS enforcement is even in play for
    // this request — asserting the request completed without the
    // headers object being empty/erroring is the meaningful check here
    // (already implicit in corsRequest resolving at all), restated
    // explicitly for clarity.
    assert.ok(headers);
  });
});
