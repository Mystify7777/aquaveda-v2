import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { resolveProvisioningConfig, ProvisioningRefusal } from "../scripts/provision-admin-lib.js";

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
    assert.deepEqual(cfg, { name: "Local Admin", email: "admin@example.test", password: PASSWORD });
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
  ]) {
    it(`exits 1 for ${name}; output carries no secret`, () => {
      const env = { ...process.env };
      for (const k of ["NODE_ENV", ...Object.keys(GOOD)]) delete env[k];
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
