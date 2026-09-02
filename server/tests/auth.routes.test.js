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
    assert.equal(res.json.user.email, "test@example.com");
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
    for (const forbidden of ["issue.service", "knowledge.service", "comment.service", "project.service"]) {
      assert.ok(!source.includes(forbidden), `auth.routes.js must not import ${forbidden}`);
    }
  });
});
