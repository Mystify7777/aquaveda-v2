import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { connectDB, disconnectDB, isDatabaseReady } from "../src/config/db.js";
import { createHealthRouter } from "../src/routes/health.routes.js";
import { User } from "../src/models/User.js";
import { signAccessToken } from "../src/services/auth-tokens.js";
import { setupTestDb, teardownTestDb } from "./helpers/testDb.js";

/**
 * Liveness vs readiness (#127). Three layers:
 *  1. isDatabaseReady over every Mongoose readyState (pure, injected connection);
 *  2. the router with an injected readiness source (deterministic, no database);
 *  3. the real app against the real test MongoDB, driving the connection through
 *     disconnect and recovery with the project's own connectDB/disconnectDB
 *     (synchronous, deterministic: no timing-dependent server kills).
 */

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((resolve) => server.close(resolve));

describe("isDatabaseReady (connection-state abstraction)", () => {
  it("is true only for readyState 1 (connected)", () => {
    assert.equal(isDatabaseReady({ readyState: 1 }), true);
    for (const state of [0, 2, 3, 99, undefined, null, "1"]) {
      assert.equal(isDatabaseReady({ readyState: state }), false, `readyState ${String(state)}`);
    }
    assert.equal(isDatabaseReady(null), false);
  });
});

describe("health router with an injected readiness source", () => {
  let state;
  let calls;
  let server;
  let base;

  before(async () => {
    state = { ready: true, throws: null };
    calls = 0;
    const app = express();
    app.use(
      "/api/v1",
      createHealthRouter({
        isReady: () => {
          calls += 1;
          if (state.throws) throw state.throws;
          return state.ready;
        },
      }),
    );
    ({ server, base } = await listen(app));
  });
  after(() => close(server));

  const get = (path) => fetch(`${base}${path}`).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() }));

  it("liveness: 200 {status, timestamp} regardless of database state, and never consults readiness", async () => {
    const before = calls;
    for (const s of [{ ready: true, throws: null }, { ready: false, throws: null }, { ready: false, throws: new Error("boom") }]) {
      state = s;
      const res = await get("/api/v1/health");
      assert.equal(res.status, 200);
      const body = JSON.parse(res.text);
      assert.deepEqual(Object.keys(body).sort(), ["status", "timestamp"]);
      assert.equal(body.status, "ok");
      assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
    }
    assert.equal(calls, before, "liveness must not depend on the database readiness source");
  });

  it("readiness: connected => 200 {status:'ready'}", async () => {
    state = { ready: true, throws: null };
    const res = await get("/api/v1/ready");
    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ status: "ready" }));
  });

  it("readiness: unavailable => 503 {status:'unavailable'}; recovery => 200 again", async () => {
    state = { ready: false, throws: null };
    const down = await get("/api/v1/ready");
    assert.equal(down.status, 503);
    assert.equal(down.text, JSON.stringify({ status: "unavailable" }));

    state = { ready: true, throws: null };
    const up = await get("/api/v1/ready");
    assert.equal(up.status, 200);
    assert.equal(up.text, JSON.stringify({ status: "ready" }));
  });

  it("readiness responses are never cacheable", async () => {
    for (const ready of [true, false]) {
      state = { ready, throws: null };
      assert.equal((await get("/api/v1/ready")).headers.get("cache-control"), "no-store");
    }
  });

  it("a failing readiness source is 'not ready' and its error (URI, credentials, stack) never reaches the response", async () => {
    const secret = "mongodb://appuser:s3cr3t-pass@db-internal.example.net:27017/aquaveda";
    const err = new Error(`connect ECONNREFUSED ${secret}`);
    state = { ready: true, throws: err };
    const res = await get("/api/v1/ready");
    assert.equal(res.status, 503);
    assert.equal(res.text, JSON.stringify({ status: "unavailable" }));
    for (const leak of [secret, "s3cr3t-pass", "appuser", "db-internal", "27017", "ECONNREFUSED", "mongodb", " at ", "stack", "Error"]) {
      assert.ok(!res.text.includes(leak), `response leaks "${leak}"`);
    }
  });

  it("only a strict `true` counts as ready (truthy values do not)", async () => {
    state = { ready: "yes", throws: null };
    assert.equal((await get("/api/v1/ready")).status, 503);
  });
});

describe("real app + real MongoDB: connection lifecycle", () => {
  const ORIGIN = "http://allowed.example.com";
  const saved = {};
  let server;
  let base;

  before(async () => {
    for (const k of ["ALLOWED_ORIGINS", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) saved[k] = process.env[k];
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.JWT_ACCESS_SECRET ||= "unit-access-secret-0123456789abcdef-aaaa";
    process.env.JWT_REFRESH_SECRET ||= "unit-refresh-secret-0123456789abcdef-bbbb";
    await setupTestDb();
    ({ server, base } = await listen(createApp()));
  });
  after(async () => {
    await close(server);
    await teardownTestDb();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const get = (path, headers = {}) =>
    fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(3000) }).then(async (r) => ({
      status: r.status,
      headers: r.headers,
      text: await r.text(),
    }));

  it("connected: liveness 200 and readiness 200; probes carry the API security headers and set no cookie", async () => {
    assert.equal(isDatabaseReady(), true);
    const live = await get("/api/v1/health");
    const ready = await get("/api/v1/ready");
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(ready.text, JSON.stringify({ status: "ready" }));
    for (const res of [live, ready]) {
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal(res.headers.get("x-powered-by"), null);
    }
  });

  it("disconnected: readiness 503, liveness still 200", async () => {
    await disconnectDB();
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(isDatabaseReady(), false);

    const ready = await get("/api/v1/ready");
    assert.equal(ready.status, 503);
    assert.equal(ready.text, JSON.stringify({ status: "unavailable" }));

    const live = await get("/api/v1/health");
    assert.equal(live.status, 200);
    assert.equal(JSON.parse(live.text).status, "ok");
  });

  it("probes never read the database, even when the request carries a VALID access cookie", async () => {
    // authMiddleware resolves the actor with User.findById when a valid access
    // token is present. Probes are mounted before it, so that read must not happen.
    const cookie = `access_token=${signAccessToken({ sub: "507f1f77bcf86cd799439011" })}`;
    const original = User.findById;
    let reads = 0;
    User.findById = function spied(...args) {
      reads += 1;
      return original.apply(this, args);
    };
    try {
      for (const path of ["/api/v1/health", "/api/v1/ready"]) {
        const res = await get(path, { cookie });
        assert.ok([200, 503].includes(res.status), `${path} -> ${res.status}`);
      }
      assert.equal(reads, 0, "a probe must not trigger an actor lookup");

      // Control: the spy is live — a non-probe route with the same cookie DOES read.
      await get("/api/v1/auth/me", { cookie });
      assert.ok(reads > 0, "control: authMiddleware performs the lookup for non-probe routes");
    } finally {
      User.findById = original;
    }
  });

  it("not-ready responses expose no connection detail", async () => {
    assert.equal(isDatabaseReady(), false);
    const res = await get("/api/v1/ready");
    assert.deepEqual(Object.keys(JSON.parse(res.text)), ["status"]);
    const uri = process.env.TEST_MONGO_URI ?? "";
    const host = uri.replace(/^mongodb(\+srv)?:\/\//, "").split(/[/?]/)[0];
    for (const leak of [uri, host, "mongodb://", "ECONN", "MongoServerSelectionError", "readyState", "topology"]) {
      if (leak) assert.ok(!res.text.includes(leak), `response leaks "${leak}"`);
    }
  });

  it("recovered: readiness 200 again after the connection is re-established", async () => {
    await connectDB({ envVar: "TEST_MONGO_URI" });
    assert.equal(mongoose.connection.readyState, 1);
    assert.equal(isDatabaseReady(), true);
    const ready = await get("/api/v1/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.text, JSON.stringify({ status: "ready" }));
    assert.equal((await get("/api/v1/health")).status, 200);
  });
});
