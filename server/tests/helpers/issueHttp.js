import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../../src/middleware/auth.js";
import { issueRouter } from "../../src/routes/issue.routes.js";
import { User } from "../../src/models/User.js";
import { register } from "../../src/services/auth.service.js";

/**
 * Real-HTTP harness for the Issue routes (#142): the production middleware
 * order (cookie-parser -> authMiddleware -> router) on an ephemeral port,
 * real users with real access tokens, against the real test database.
 */

export async function startIssueHttpApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/issues", issueRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  function request(method, path, { body, token } = {}) {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const headers = {};
      if (bodyStr !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(bodyStr);
      }
      if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
      const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, json, text: raw });
        });
      });
      req.on("error", reject);
      if (bodyStr !== undefined) req.write(bodyStr);
      req.end();
    });
  }

  return { request, close: () => new Promise((resolve) => server.close(resolve)) };
}

let seq = 0;

/** A real registered user with a real access token and the given role. */
export async function makeHttpUser(role = "USER", label = role.toLowerCase()) {
  seq += 1;
  const { user, accessToken } = await register({
    name: `${label}${seq}`,
    email: `${label}${seq}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`,
    password: "correcthorsebatterystaple",
  });
  if (role !== "USER") await User.updateOne({ _id: user.id }, { $set: { role } });
  return { id: String(user.id), role, name: `${label}${seq}`, token: accessToken };
}

/** Same cast as lifecycleFixtures.makeWorld, but every member can make HTTP calls. */
export async function makeHttpWorld() {
  return {
    reporter: await makeHttpUser("USER", "reporter"),
    expert1: await makeHttpUser("EXPERT", "expert"),
    expert2: await makeHttpUser("EXPERT", "expert"),
    grantee: await makeHttpUser("USER", "grantee"),
    other: await makeHttpUser("USER", "bystander"),
    admin: await makeHttpUser("ADMIN", "admin"),
  };
}

/** Every key anywhere in a JSON value. */
export function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

export const PRIVATE_KEYS = ["remediation", "remediationHistory", "grantId", "grantedBy", "selfGrant", "expertCount", "threshold", "__v"];

export function assertNoPrivateKeys(assert, json, allow = []) {
  const keys = keysDeep(json);
  for (const k of PRIVATE_KEYS.filter((x) => !allow.includes(x))) {
    assert.ok(!keys.has(k), `response must not contain "${k}"`);
  }
}
