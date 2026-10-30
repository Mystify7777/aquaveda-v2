import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { API_SECURITY_HEADERS } from "../src/middleware/security-headers.js";

/**
 * Issue #129 — baseline security headers on the Express API.
 *
 * Real createApp() over real HTTP, no database needed (none of the exercised
 * paths reaches a service). Exact-equality assertions on header values also
 * catch accidental duplicates: Node's fetch joins repeated headers with
 * ", ", so a doubled header would not equal the single expected value.
 */

const ALLOWED = "https://app.example.test";
const EXPECTED = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": API_SECURITY_HEADERS["Permissions-Policy"],
};

let server;
let base;
let savedOrigins;

before(async () => {
  savedOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = ALLOWED;
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (savedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = savedOrigins;
});

function assertBaseline(res, label) {
  for (const [name, value] of Object.entries(EXPECTED)) {
    assert.equal(res.headers.get(name), value, `${label}: ${name}`);
  }
  assert.equal(res.headers.get("x-powered-by"), null, `${label}: X-Powered-By must not be advertised`);
}

describe("API baseline security headers (#129)", () => {
  it("pins the intended policy values", () => {
    assert.equal(API_SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(API_SECURITY_HEADERS["Referrer-Policy"], "no-referrer");
    assert.equal(API_SECURITY_HEADERS["X-Frame-Options"], "DENY");
    const pp = API_SECURITY_HEADERS["Permissions-Policy"];
    for (const f of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      assert.match(pp, new RegExp(`${f}=\\(\\)`), `${f} must be denied for the API`);
    }
  });

  it("200 success response", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "ok");
    assertBaseline(res, "health 200");
  });

  it("404 unmatched route keeps the standard envelope", async () => {
    const res = await fetch(`${base}/api/v1/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "NOT_FOUND");
    assertBaseline(res, "404");
  });

  it("401 from an authenticated route passing through the middleware chain", async () => {
    const res = await fetch(`${base}/api/v1/geocode/search?q=Patna`); // requireActor -> 401, no DB reached
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
    assertBaseline(res, "401");
  });

  it("403 from the CSRF guard (an early-exit middleware response)", async () => {
    const res = await fetch(`${base}/api/v1/issues`, { method: "POST" }); // no Origin/Referer
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "FORBIDDEN");
    assertBaseline(res, "csrf 403");
  });

  it("400 from the centralized error handler (malformed JSON body)", async () => {
    const res = await fetch(`${base}/api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ALLOWED },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "VALIDATION_FAILED");
    assertBaseline(res, "error handler 400");
  });

  it("CORS preflight (OPTIONS) carries the headers and unchanged CORS output", async () => {
    const res = await fetch(`${base}/api/v1/issues`, {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assertBaseline(res, "preflight");
  });
});

describe("existing CORS behavior is preserved (#129 must not change it)", () => {
  it("allowed origin: credentialed CORS headers present alongside security headers", async () => {
    const res = await fetch(`${base}/api/v1/health`, { headers: { origin: ALLOWED } });
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assertBaseline(res, "cors allowed");
  });

  it("disallowed origin: still no CORS headers (never a wildcard), security headers still present", async () => {
    const res = await fetch(`${base}/api/v1/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
    assertBaseline(res, "cors disallowed");
  });

  it("no HSTS/CSP/CORP/COOP from the app (hosting-owned or separately decided)", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    for (const h of [
      "strict-transport-security",
      "content-security-policy",
      "cross-origin-resource-policy",
      "cross-origin-opener-policy",
    ]) {
      assert.equal(res.headers.get(h), null, `${h} must not be set by the API app`);
    }
  });
});
