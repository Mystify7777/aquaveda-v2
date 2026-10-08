import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertE2eDatabase } from "../scripts/e2e-seed-guard.js";

// Pure validation tests: no MongoDB needed (#85 review fix).

const SEED_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "seed-e2e.js",
);

describe("assertE2eDatabase", () => {
  for (const uri of [
    "mongodb://127.0.0.1:27017/aquaveda_v2_e2e",
    "mongodb://localhost:27017/aquaveda_v2_e2e",
    "mongodb://[::1]:27017/aquaveda_v2_e2e",
    "mongodb://LOCALHOST:27017/aquaveda_v2_e2e",
    "mongodb://user:pw@127.0.0.1/aquaveda_v2_e2e?authSource=admin",
  ]) {
    it(`accepts ${uri}`, () => {
      assert.doesNotThrow(() => assertE2eDatabase(uri));
    });
  }

  const rejected = [
    ["_e2e database on a non-loopback host", "mongodb://db.example.com:27017/aquaveda_v2_e2e", /not local/],
    ["_e2e database on a private IP", "mongodb://10.0.0.5:27017/aquaveda_v2_e2e", /not local/],
    ["multi-host list including a remote host", "mongodb://localhost,db.example.com/aquaveda_v2_e2e", /not local/],
    ["lookalike host", "mongodb://localhost.example.com/aquaveda_v2_e2e", /not local/],
    ["non-_e2e database on localhost", "mongodb://localhost:27017/aquaveda_v2", /_e2e/],
    ["no database on localhost", "mongodb://localhost:27017", /_e2e/],
    ["mongodb+srv scheme", "mongodb+srv://localhost/aquaveda_v2_e2e", /scheme/],
    ["malformed URI", "not a uri", /not a valid URI/],
    ["missing URI (undefined)", undefined, /missing/],
    ["empty URI", "  ", /missing/],
  ];
  for (const [name, uri, message] of rejected) {
    it(`rejects ${name}`, () => {
      assert.throws(() => assertE2eDatabase(uri), message);
    });
  }
});

describe("seed-e2e.js refuses before any database work", () => {
  // Spawned with a throwaway cwd (no .env) and no real server: a rejected
  // configuration must exit non-zero immediately, i.e. before connectDB()
  // could even attempt a connection (which would hang to a timeout).
  for (const [name, uri, message] of [
    ["non-loopback host", "mongodb://db.example.com:27017/aquaveda_v2_e2e", /not local/],
    ["non-_e2e database", "mongodb://127.0.0.1:27017/aquaveda_v2", /_e2e/],
    ["missing URI", undefined, /missing/],
  ]) {
    it(`exits 1 for ${name}`, () => {
      const env = { ...process.env };
      delete env.MONGO_URI;
      if (uri !== undefined) env.MONGO_URI = uri;

      const started = Date.now();
      const result = spawnSync(process.execPath, [SEED_SCRIPT], {
        env,
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 15_000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to seed/);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stdout, /fixtures ready/);
      assert.ok(Date.now() - started < 10_000, "must fail fast, not on a connection timeout");
    });
  }
});
