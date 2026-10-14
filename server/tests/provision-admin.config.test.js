import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { resolveProvisioningConfig, runProvisioning, ProvisioningRefusal } from "../scripts/provision-admin-lib.js";

/**
 * #89 — the provisioning safety boundary. Pure/no-MongoDB: every refusal
 * must happen before any database work.
 */

const SCRIPT = fileURLToPath(new URL("../scripts/provision-admin.js", import.meta.url));
const PASSWORD = "local-dev-passphrase-1";

const GOOD = Object.freeze({
  ALLOW_DEV_ADMIN_PROVISIONING: "true",
  MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_dev",
  ADMIN_BOOTSTRAP_EMAIL: "Admin@Example.test",
  ADMIN_BOOTSTRAP_PASSWORD: PASSWORD,
});

const withEnv = (patch) => {
  const env = { ...GOOD, ...patch };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
};

describe("resolveProvisioningConfig", () => {
  it("accepts a local _dev target with explicit opt-in; canonicalizes email; default name", () => {
    const cfg = resolveProvisioningConfig(GOOD);
    assert.deepEqual(cfg, {
      name: "Local Admin",
      email: "admin@example.test",
      password: PASSWORD,
      mongoUri: GOOD.MONGO_URI,
    });
  });

  it("accepts localhost and ::1 and custom name", () => {
    for (const host of ["localhost:27017", "[::1]:27017"]) {
      assert.doesNotThrow(() =>
        resolveProvisioningConfig(
          withEnv({ MONGO_URI: `mongodb://${host}/x_dev`, ADMIN_BOOTSTRAP_NAME: "Dev Admin" }),
        ),
      );
    }
  });

  for (const [name, patch, message] of [
    ["production environment", { NODE_ENV: "production" }, /production/],
    ["production even with a perfect _dev local target", { NODE_ENV: "production", ALLOW_DEV_ADMIN_PROVISIONING: "true" }, /production/],
    ["missing opt-in flag", { ALLOW_DEV_ADMIN_PROVISIONING: undefined }, /ALLOW_DEV_ADMIN_PROVISIONING/],
    ["opt-in flag not exactly 'true'", { ALLOW_DEV_ADMIN_PROVISIONING: "1" }, /ALLOW_DEV_ADMIN_PROVISIONING/],
    ["non-loopback host", { MONGO_URI: "mongodb://db.example.com:27017/aquaveda_v2_dev" }, /not local/],
    ["private IP", { MONGO_URI: "mongodb://10.0.0.5:27017/aquaveda_v2_dev" }, /not local/],
    ["multi-host list with a remote host", { MONGO_URI: "mongodb://localhost,db.example.com/aquaveda_v2_dev" }, /not local/],
    ["mongodb+srv scheme", { MONGO_URI: "mongodb+srv://localhost/aquaveda_v2_dev" }, /scheme/],
    ["the documented default dev DB name (no _dev suffix)", { MONGO_URI: "mongodb://localhost:27017/aquaveda_v2" }, /_dev/],
    ["a test DB", { MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_test" }, /_dev/],
    ["an _e2e DB", { MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_e2e" }, /_dev/],
    ["no database name", { MONGO_URI: "mongodb://localhost:27017" }, /_dev/],
    ["missing MONGO_URI", { MONGO_URI: undefined }, /missing/],
    ["missing email", { ADMIN_BOOTSTRAP_EMAIL: undefined }, /ADMIN_BOOTSTRAP_EMAIL/],
    ["invalid email", { ADMIN_BOOTSTRAP_EMAIL: "not-an-email" }, /ADMIN_BOOTSTRAP_EMAIL/],
    ["missing password", { ADMIN_BOOTSTRAP_PASSWORD: undefined }, /ADMIN_BOOTSTRAP_PASSWORD/],
    ["too-short password", { ADMIN_BOOTSTRAP_PASSWORD: "short" }, /ADMIN_BOOTSTRAP_PASSWORD/],
  ]) {
    it(`refuses: ${name}`, () => {
      assert.throws(() => resolveProvisioningConfig(withEnv(patch)), message);
    });
  }

  it("never echoes the submitted password in a validation error", () => {
    try {
      resolveProvisioningConfig(withEnv({ ADMIN_BOOTSTRAP_PASSWORD: "tiny" }));
      assert.fail("expected refusal");
    } catch (err) {
      assert.ok(err instanceof ProvisioningRefusal);
      assert.ok(!err.message.includes("tiny"));
    }
  });
});

describe("provision-admin CLI refuses before any database work", () => {
  // Throwaway cwd (no .env); a refused configuration must exit non-zero
  // immediately — a connection attempt would hang to a timeout instead.
  for (const [name, patch, message] of [
    ["production", { NODE_ENV: "production" }, /production/],
    ["no opt-in", { ALLOW_DEV_ADMIN_PROVISIONING: undefined }, /ALLOW_DEV_ADMIN_PROVISIONING/],
    ["remote host", { MONGO_URI: "mongodb://db.example.com:27017/aquaveda_v2_dev" }, /not local/],
    ["non-_dev database", { MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2" }, /_dev/],
    ["missing bootstrap password", { ADMIN_BOOTSTRAP_PASSWORD: undefined }, /ADMIN_BOOTSTRAP_PASSWORD/],
    [
      "a local _dev DEV_MONGO_URI cannot authorize a remote MONGO_URI",
      { DEV_MONGO_URI: GOOD.MONGO_URI, MONGO_URI: "mongodb://db.example.com:27017/aquaveda_v2_dev" },
      /not local/,
    ],
    ["only DEV_MONGO_URI set (MONGO_URI missing)", { DEV_MONGO_URI: GOOD.MONGO_URI, MONGO_URI: undefined }, /missing/],
  ]) {
    it(`exits 1 for ${name}; output carries no secret`, () => {
      const env = { ...process.env };
      for (const k of ["NODE_ENV", "DEV_MONGO_URI", ...Object.keys(GOOD)]) delete env[k];
      Object.assign(env, withEnv(patch));
      if (patch.NODE_ENV) env.NODE_ENV = patch.NODE_ENV;

      const started = Date.now();
      const result = spawnSync(process.execPath, [SCRIPT], {
        env,
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 15_000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to provision/);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stdout, /created ADMIN/);
      assert.ok(!(result.stdout + result.stderr).includes(PASSWORD));
      assert.ok(Date.now() - started < 10_000, "must fail fast, not on a connection timeout");
    });
  }
});

describe("runProvisioning: the validated target is the connected target", () => {
  const fakeProvision = () => mock.fn(async (cfg) => ({ outcome: "created", email: cfg.email }));

  it("connects exactly once, with the exact validated MONGO_URI, before provisioning", async () => {
    const order = [];
    const connect = mock.fn(async () => order.push("connect"));
    const provision = mock.fn(async (cfg) => {
      order.push("provision");
      return { outcome: "created", email: cfg.email };
    });
    const uri = "mongodb://127.0.0.1:27017/aquaveda_v2_dev";

    const result = await runProvisioning(withEnv({ MONGO_URI: uri }), { connect, provision });

    assert.equal(result.outcome, "created");
    assert.equal(connect.mock.callCount(), 1);
    assert.deepEqual(connect.mock.calls[0].arguments, [uri]);
    assert.deepEqual(order, ["connect", "provision"]);
    assert.equal(provision.mock.calls[0].arguments[0].mongoUri, uri);
  });

  it("a guarded local DEV_MONGO_URI cannot authorize a different remote MONGO_URI", async () => {
    const connect = mock.fn(async () => {});
    const provision = fakeProvision();
    await assert.rejects(
      runProvisioning(
        withEnv({
          DEV_MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_dev",
          MONGO_URI: "mongodb://db.example.com:27017/aquaveda_v2_dev",
        }),
        { connect, provision },
      ),
      /not local/,
    );
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(provision.mock.callCount(), 0);
  });

  it("a local DEV_MONGO_URI is ignored: the connection can only ever use MONGO_URI", async () => {
    const connect = mock.fn(async () => {});
    const uri = "mongodb://127.0.0.1:27017/aquaveda_v2_dev";
    await runProvisioning(
      withEnv({ MONGO_URI: uri, DEV_MONGO_URI: "mongodb://127.0.0.1:27017/some_other_dev" }),
      { connect, provision: fakeProvision() },
    );
    assert.deepEqual(connect.mock.calls[0].arguments, [uri]);
  });

  for (const [name, patch] of [
    ["the default development database", { MONGO_URI: "mongodb://localhost:27017/aquaveda_v2" }],
    ["the test database", { MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_test" }],
    ["the E2E database", { MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_e2e" }],
    ["a remote MongoDB", { MONGO_URI: "mongodb://db.example.com:27017/aquaveda_v2_dev" }],
    ["a mongodb+srv cluster", { MONGO_URI: "mongodb+srv://cluster0.example.mongodb.net/aquaveda_v2_dev" }],
    ["production", { NODE_ENV: "production" }],
    ["a missing opt-in", { ALLOW_DEV_ADMIN_PROVISIONING: undefined }],
    ["a missing MONGO_URI", { MONGO_URI: undefined }],
    ["a malformed MONGO_URI", { MONGO_URI: "not a uri" }],
    ["a missing bootstrap email", { ADMIN_BOOTSTRAP_EMAIL: undefined }],
    ["a too-short bootstrap password", { ADMIN_BOOTSTRAP_PASSWORD: "short" }],
  ]) {
    it(`never connects or provisions for ${name}`, async () => {
      const connect = mock.fn(async () => {});
      const provision = fakeProvision();
      await assert.rejects(runProvisioning(withEnv(patch), { connect, provision }));
      assert.equal(connect.mock.callCount(), 0, "no connection attempt");
      assert.equal(provision.mock.callCount(), 0, "no write attempt");
    });
  }
});
