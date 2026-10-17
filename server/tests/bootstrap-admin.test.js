import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { register } from "../src/services/auth.service.js";
import { createKnowledge, submitForReview } from "../src/services/knowledge.service.js";
import {
  resolveBootstrapConfig,
  bootstrapAdmin,
  runBootstrap,
  BootstrapRefusal,
  REQUIRED_CONFIRMATION,
  DEFAULT_ADMIN_NAME,
} from "../scripts/bootstrap-admin.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/bootstrap-admin.js", import.meta.url));

const PASSWORD = "production-admin-secure-passphrase-1";
const ADMIN_CFG = Object.freeze({
  name: "Ops Admin",
  email: "admin@production.test",
  password: PASSWORD,
});

// Test-only target fixture: a reserved `.example.invalid` host, obvious fake
// credentials, and a neutral database name. None of this describes a real
// deployment, and the name is NOT a claim about the real production database.
const FIXTURE_DB = "bootstrap_fixture";
const FIXTURE_URI = `mongodb+srv://fixture_user:fixture_pass@cluster.example.invalid/${FIXTURE_DB}?retryWrites=true`;

const VALID_ENV = Object.freeze({
  NODE_ENV: "production",
  CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
  MONGO_URI: FIXTURE_URI,
  BOOTSTRAP_EXPECTED_DB: FIXTURE_DB,
  ADMIN_EMAIL: ADMIN_CFG.email,
  ADMIN_PASSWORD: ADMIN_CFG.password,
  ADMIN_NAME: ADMIN_CFG.name,
});

const withEnv = (patch) => {
  const env = { ...VALID_ENV, ...patch };
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k];
  }
  return env;
};

// ============================================================================
// 1. Configuration & Safety Boundary (Pure validation, no DB connection)
// ============================================================================
describe("resolveBootstrapConfig: environment & confirmation safety checks", () => {
  it("accepts valid production configuration from environment variables", async () => {
    const config = await resolveBootstrapConfig(VALID_ENV, []);
    assert.equal(config.name, ADMIN_CFG.name);
    assert.equal(config.email, ADMIN_CFG.email);
    assert.equal(config.password, PASSWORD);
    assert.equal(config.mongoUri, VALID_ENV.MONGO_URI);
  });

  it("accepts production intent, confirmation and target via CLI arguments (password via env only, #110)", async () => {
    const args = [
      "--target-env=production",
      `--confirm=${REQUIRED_CONFIRMATION}`,
      `--email=${ADMIN_CFG.email}`,
      "--name=CLI Admin",
      `--mongo-uri=${FIXTURE_URI}`,
      `--expect-db=${FIXTURE_DB}`,
    ];
    const config = await resolveBootstrapConfig({ ADMIN_PASSWORD: PASSWORD }, args);
    assert.equal(config.name, "CLI Admin");
    assert.equal(config.email, ADMIN_CFG.email);
    assert.equal(config.password, PASSWORD);
    assert.equal(config.mongoUri, FIXTURE_URI);
  });

  it("uses default name when none is provided", async () => {
    const config = await resolveBootstrapConfig(withEnv({ ADMIN_NAME: undefined }), []);
    assert.equal(config.name, DEFAULT_ADMIN_NAME);
  });

  it("prompts for confirmation/email via prompt and the password only via the hidden promptSecret", async () => {
    const promptAnswers = {
      [`Type '${REQUIRED_CONFIRMATION}' to confirm production bootstrap: `]: REQUIRED_CONFIRMATION,
      "Enter ADMIN_EMAIL: ": "prompted@example.test",
    };
    const asked = [];
    const mockPrompt = async (query) => {
      asked.push(query);
      return promptAnswers[query] ?? "";
    };
    const mockSecret = async () => "prompted-secure-password";

    const envWithoutCredentials = withEnv({
      CONFIRM_PRODUCTION_BOOTSTRAP: undefined,
      ADMIN_EMAIL: undefined,
      ADMIN_PASSWORD: undefined,
    });

    const config = await resolveBootstrapConfig(envWithoutCredentials, [], {
      prompt: mockPrompt,
      promptSecret: mockSecret,
    });
    assert.equal(config.email, "prompted@example.test");
    assert.equal(config.password, "prompted-secure-password");
    assert.ok(!asked.some((q) => /PASSWORD/.test(q)), "password must never go through the echoing prompt");
  });

  for (const [scenario, patch, messagePattern] of [
    ["non-production environment (development)", { NODE_ENV: "development" }, /target environment must be "production"/],
    ["missing NODE_ENV and target flag", { NODE_ENV: undefined }, /target environment must be "production"/],
    ["missing confirmation string", { CONFIRM_PRODUCTION_BOOTSTRAP: undefined }, /explicit confirmation required/],
    ["invalid confirmation string", { CONFIRM_PRODUCTION_BOOTSTRAP: "CONFIRM" }, /explicit confirmation required/],
    ["missing MONGO_URI", { MONGO_URI: undefined }, /MONGO_URI is missing/],
    ["missing ADMIN_EMAIL", { ADMIN_EMAIL: undefined }, /ADMIN_EMAIL is required/],
    ["invalid ADMIN_EMAIL format", { ADMIN_EMAIL: "not-an-email" }, /must be a valid email address/],
    ["missing ADMIN_PASSWORD", { ADMIN_PASSWORD: undefined }, /ADMIN_PASSWORD is required/],
    ["too-short ADMIN_PASSWORD (< 8 chars)", { ADMIN_PASSWORD: "short" }, /password must be at least 8 characters/],
  ]) {
    it(`refuses execution for ${scenario}`, async () => {
      await assert.rejects(
        resolveBootstrapConfig(withEnv(patch), []),
        (err) => {
          assert.ok(err instanceof BootstrapRefusal);
          assert.match(err.message, messagePattern);
          return true;
        },
      );
    });
  }

  for (const [scenario, patch, messagePattern] of [
    ["missing expected database name", { BOOTSTRAP_EXPECTED_DB: undefined }, /expected database name is required/],
    ["empty expected database name", { BOOTSTRAP_EXPECTED_DB: "" }, /expected database name is required/],
    ["expected name that does not match the URI database", { BOOTSTRAP_EXPECTED_DB: "other_fixture" }, /does not match the expected database/],
    ["unsupported URI scheme", { MONGO_URI: `http://cluster.example.invalid/${FIXTURE_DB}` }, /scheme is not supported/],
    ["malformed URI", { MONGO_URI: "mongodb+srv://" }, /no host/],
    ["URI without a database name", { MONGO_URI: "mongodb+srv://cluster.example.invalid/" }, /no database name/],
    ["development database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_dev", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_dev" }, /development\/test marker/],
    ["test database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_test", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_test" }, /development\/test marker/],
    ["E2E database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_e2e", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_e2e" }, /development\/test marker/],
    ["documented development default database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2" }, /development, test or system database/],
    ["loopback host", { MONGO_URI: `mongodb://127.0.0.1:27017/${FIXTURE_DB}?tls=true` }, /loopback or unspecified host/],
    ["mongodb:// without TLS", { MONGO_URI: `mongodb://db0.example.invalid:27017/${FIXTURE_DB}` }, /without "tls=true"/],
    ["TLS explicitly disabled", { MONGO_URI: `mongodb+srv://cluster.example.invalid/${FIXTURE_DB}?tls=false` }, /disables TLS/],
    ["TLS verification bypass", { MONGO_URI: `mongodb+srv://cluster.example.invalid/${FIXTURE_DB}?tlsInsecure=true` }, /weakens TLS/],
  ]) {
    it(`refuses execution for target: ${scenario}`, async () => {
      await assert.rejects(resolveBootstrapConfig(withEnv(patch), []), (err) => {
        assert.ok(err instanceof BootstrapRefusal);
        assert.match(err.message, messagePattern);
        assert.ok(!/fixture_pass|fixture_user|example\.invalid/.test(err.message), "message leaked URI content");
        return true;
      });
    });
  }

  it("takes --expect-db over BOOTSTRAP_EXPECTED_DB, and never falls back when the flag is empty or bare", async () => {
    const ok = await resolveBootstrapConfig(withEnv({ BOOTSTRAP_EXPECTED_DB: "other_fixture" }), [`--expect-db=${FIXTURE_DB}`]);
    assert.equal(ok.mongoUri, FIXTURE_URI);

    for (const argv of [["--expect-db="], ["--expect-db"]]) {
      await assert.rejects(resolveBootstrapConfig(withEnv({}), argv), /expected database name is required/);
    }
    await assert.rejects(
      resolveBootstrapConfig(withEnv({}), ["--expect-db=other_fixture"]),
      /does not match the expected database/,
    );
  });

  it("never falls back to MONGO_URI when --mongo-uri is supplied but empty or bare", async () => {
    // A valid environment target must not rescue an explicitly supplied, empty flag:
    // the validated value must be the one the operator chose, not an environment fallback.
    for (const argv of [["--mongo-uri="], ["--mongo-uri"], ["--mongo-uri", "--expect-db=" + FIXTURE_DB]]) {
      await assert.rejects(resolveBootstrapConfig(withEnv({}), argv), (err) => {
        assert.ok(err instanceof BootstrapRefusal);
        assert.match(err.message, /MONGO_URI is missing or empty/);
        return true;
      });
    }
  });

  it("uses MONGO_URI only when --mongo-uri is genuinely absent", async () => {
    const config = await resolveBootstrapConfig(withEnv({}), []);
    assert.equal(config.mongoUri, FIXTURE_URI);
  });

  it("validates the target independently of production intent flags and confirmation", async () => {
    // The same invalid target is refused whether the flags/env are supplied
    // as environment variables, as CLI arguments, or via the interactive prompt.
    const bad = { MONGO_URI: `mongodb://127.0.0.1:27017/${FIXTURE_DB}?tls=true` };
    await assert.rejects(resolveBootstrapConfig(withEnv(bad), []), /loopback or unspecified host/);
    await assert.rejects(
      resolveBootstrapConfig({ ADMIN_PASSWORD: PASSWORD }, [
        "--target-env=production",
        `--confirm=${REQUIRED_CONFIRMATION}`,
        `--mongo-uri=${bad.MONGO_URI}`,
        `--expect-db=${FIXTURE_DB}`,
        `--email=${ADMIN_CFG.email}`,
      ]),
      /loopback or unspecified host/,
    );
    await assert.rejects(
      resolveBootstrapConfig(withEnv({ ...bad, CONFIRM_PRODUCTION_BOOTSTRAP: undefined }), [], {
        prompt: async () => REQUIRED_CONFIRMATION,
      }),
      /loopback or unspecified host/,
    );
  });

  it("accepts a multi-host replica-set seed list and returns it unchanged", async () => {
    const uri =
      "mongodb://fixture_user:fixture_pass@db0.example.invalid:27017,db1.example.invalid:27017,db2.example.invalid:27017/" +
      `${FIXTURE_DB}?tls=true&replicaSet=rs0&authSource=admin`;
    const config = await resolveBootstrapConfig(withEnv({ MONGO_URI: uri }), []);
    assert.equal(config.mongoUri, uri);
  });

  it("never echoes the submitted password in error messages", async () => {
    try {
      await resolveBootstrapConfig(withEnv({ ADMIN_PASSWORD: "short" }), []);
      assert.fail("expected refusal");
    } catch (err) {
      assert.ok(err instanceof BootstrapRefusal);
      assert.ok(!err.message.includes("short"));
    }
  });
});

// ============================================================================
// 1b. runBootstrap: no connection unless the target is fully validated (#109)
// ============================================================================
describe("runBootstrap: the connection function is never reached on an invalid target", () => {
  const spies = () => {
    const calls = { connect: [], bootstrap: [] };
    return {
      calls,
      deps: {
        connect: async (uri) => {
          calls.connect.push(uri);
        },
        bootstrap: async (config) => {
          calls.bootstrap.push(config);
          return { outcome: "created", email: config.email };
        },
      },
    };
  };

  for (const [scenario, patch] of [
    ["missing expected database name", { BOOTSTRAP_EXPECTED_DB: undefined }],
    ["empty expected database name", { BOOTSTRAP_EXPECTED_DB: "" }],
    ["mismatched expected database name", { BOOTSTRAP_EXPECTED_DB: "other_fixture" }],
    ["case-variant expected database name", { BOOTSTRAP_EXPECTED_DB: "Bootstrap_Fixture" }],
    ["missing MONGO_URI", { MONGO_URI: undefined }],
    ["unsupported scheme", { MONGO_URI: `http://cluster.example.invalid/${FIXTURE_DB}` }],
    ["malformed URI", { MONGO_URI: "mongodb+srv://" }],
    ["URI with embedded whitespace", { MONGO_URI: `mongodb+srv://cluster.example.invalid/${FIXTURE_DB} x` }],
    ["missing database name", { MONGO_URI: "mongodb+srv://cluster.example.invalid/" }],
    ["development database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_dev", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_dev" }],
    ["test database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_test", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_test" }],
    ["E2E database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_e2e", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_e2e" }],
    ["documented development default database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2" }],
    ["loopback host", { MONGO_URI: `mongodb://localhost:27017/${FIXTURE_DB}?tls=true` }],
    ["mongodb:// without TLS", { MONGO_URI: `mongodb://db0.example.invalid:27017/${FIXTURE_DB}` }],
    ["TLS explicitly disabled", { MONGO_URI: `mongodb://db0.example.invalid:27017/${FIXTURE_DB}?tls=false` }],
    ["TLS verification bypass", { MONGO_URI: `mongodb+srv://cluster.example.invalid/${FIXTURE_DB}?tlsAllowInvalidCertificates=true` }],
    ["non-production environment (existing gate still applies)", { NODE_ENV: "development" }],
    ["missing confirmation (existing gate still applies)", { CONFIRM_PRODUCTION_BOOTSTRAP: undefined }],
  ]) {
    it(`never calls connect or bootstrap: ${scenario}`, async () => {
      const { calls, deps } = spies();
      await assert.rejects(runBootstrap(withEnv(patch), [], deps), BootstrapRefusal);
      assert.deepEqual(calls.connect, []);
      assert.deepEqual(calls.bootstrap, []);
    });
  }

  it("connects exactly once, with exactly the validated URI string, then bootstraps", async () => {
    const { calls, deps } = spies();
    const result = await runBootstrap(withEnv({}), [], deps);
    assert.equal(result.outcome, "created");
    assert.equal(calls.connect.length, 1);
    assert.equal(calls.connect[0], FIXTURE_URI, "connected with a different string than the one validated");
    assert.equal(calls.bootstrap.length, 1);
  });

  it("connects with the --mongo-uri value actually validated, not an environment fallback", async () => {
    const { calls, deps } = spies();
    const cliUri = `mongodb+srv://cluster.example.invalid/${FIXTURE_DB}`;
    await runBootstrap(withEnv({ MONGO_URI: `mongodb+srv://elsewhere.example.invalid/${FIXTURE_DB}` }), [`--mongo-uri=${cliUri}`], deps);
    assert.deepEqual(calls.connect, [cliUri]);
  });

  for (const argv of [["--mongo-uri="], ["--mongo-uri"]]) {
    it(`never calls connect when ${argv[0]} is empty/bare, even with a valid MONGO_URI in the environment`, async () => {
      const { calls, deps } = spies();
      await assert.rejects(runBootstrap(withEnv({}), argv, deps), /MONGO_URI is missing or empty/);
      assert.deepEqual(calls.connect, []);
      assert.deepEqual(calls.bootstrap, []);
    });
  }

  it("does not let a valid environment target rescue an invalid --mongo-uri", async () => {
    const { calls, deps } = spies();
    await assert.rejects(
      runBootstrap(withEnv({}), [`--mongo-uri=mongodb://localhost/${FIXTURE_DB}?tls=true`], deps),
      /loopback or unspecified host/,
    );
    assert.deepEqual(calls.connect, []);
  });
});

// ============================================================================
// 2. CLI Process Execution (Fast fail before DB, secret sanitization)
// ============================================================================
describe("bootstrap-admin CLI spawn safety", () => {
  const runCli = (envOverrides, args = []) =>
    spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      env: {
        ...process.env,
        // Start from a clean slate: nothing from a developer shell may leak in.
        ADMIN_BOOTSTRAP_PASSWORD: "",
        ADMIN_BOOTSTRAP_EMAIL: "",
        ADMIN_BOOTSTRAP_NAME: "",
        BOOTSTRAP_EXPECTED_DB: FIXTURE_DB,
        MONGO_URI: FIXTURE_URI,
        ...envOverrides,
      },
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 10_000,
    });

  for (const [name, envOverrides, message] of [
    ["non-production NODE_ENV", { NODE_ENV: "test" }, /target environment must be "production"/],
    ["missing confirmation", { NODE_ENV: "production", CONFIRM_PRODUCTION_BOOTSTRAP: "" }, /explicit confirmation required/],
    [
      "missing password",
      {
        NODE_ENV: "production",
        CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
        ADMIN_EMAIL: ADMIN_CFG.email,
        ADMIN_PASSWORD: "",
      },
      /ADMIN_PASSWORD is required/,
    ],
  ]) {
    it(`exits with status 1 on ${name} and outputs no secret`, () => {
      const result = runCli(envOverrides);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Refusing to bootstrap/);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stdout, /created ADMIN/);
      assert.ok(!result.stderr.includes(PASSWORD));
    });
  }

  // #109: every invalid target exits 1 with no database output at all. The
  // `[db] MongoDB connected` / `[db] MongoDB disconnected` lines are emitted by
  // the connection layer, so their absence shows connectDB was never invoked.
  const FULL_ENV = {
    NODE_ENV: "production",
    CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
    ADMIN_EMAIL: ADMIN_CFG.email,
    ADMIN_PASSWORD: PASSWORD,
  };
  for (const [name, envOverrides, message] of [
    ["missing expected database name", { BOOTSTRAP_EXPECTED_DB: "" }, /expected database name is required/],
    ["mismatched expected database name", { BOOTSTRAP_EXPECTED_DB: "other_fixture" }, /does not match the expected database/],
    ["unsupported scheme", { MONGO_URI: `http://cluster.example.invalid/${FIXTURE_DB}` }, /scheme is not supported/],
    ["missing database name", { MONGO_URI: "mongodb+srv://cluster.example.invalid/" }, /no database name/],
    ["development database", { MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_dev", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_dev" }, /development\/test marker/],
    ["loopback host", { MONGO_URI: `mongodb://127.0.0.1:27017/${FIXTURE_DB}?tls=true` }, /loopback or unspecified host/],
    ["mongodb:// without TLS", { MONGO_URI: `mongodb://db0.example.invalid:27017/${FIXTURE_DB}` }, /without "tls=true"/],
  ]) {
    it(`exits with status 1 on invalid target (${name}) before any database activity`, () => {
      const result = runCli({ ...FULL_ENV, ...envOverrides });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Refusing to bootstrap/);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stdout + result.stderr, /\[db\]|created ADMIN|already exists/);
      assert.ok(!(result.stdout + result.stderr).includes(PASSWORD));
      assert.ok(!/fixture_pass|fixture_user/.test(result.stdout + result.stderr), "credentials leaked");
    });
  }

  it("exits with status 1 on an empty --mongo-uri even though MONGO_URI is valid, before any database activity", () => {
    const result = runCli(FULL_ENV, ["--mongo-uri="]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MONGO_URI is missing or empty/);
    assert.doesNotMatch(result.stdout + result.stderr, /\[db\]|created ADMIN|already exists/);
    assert.ok(!(result.stdout + result.stderr).includes(PASSWORD));
  });
});

// ============================================================================
// 3. Database Execution & Role Boundaries (Isolated Test Database)
// ============================================================================
let server;
let baseUrl;
const ALLOWED_ORIGIN = "http://allowed.example.com";
let previousAllowedOrigins;

before(async () => {
  previousAllowedOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  await setupTestDb();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
  if (previousAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = previousAllowedOrigins;
});

beforeEach(clearCollections);

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { Origin: ALLOWED_ORIGIN };
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
          // non-json response
        }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

async function loginToken({ email, password }) {
  const res = await request("POST", "/api/v1/auth/login", { body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const cookie = (res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
  assert.ok(cookie, "login must set the access_token cookie");
  return cookie.split(";")[0].slice(ACCESS_TOKEN_COOKIE_NAME.length + 1);
}

describe("bootstrapAdmin: user creation, idempotency, and session-freedom", () => {
  it("creates an ADMIN user with hashed password without emitting active sessions", async () => {
    const result = await bootstrapAdmin(ADMIN_CFG);
    assert.deepEqual(result, { outcome: "created", email: ADMIN_CFG.email });

    const userDoc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();
    assert.ok(userDoc);
    assert.equal(userDoc.role, "ADMIN");
    assert.equal(userDoc.name, ADMIN_CFG.name);
    assert.notEqual(userDoc.passwordHash, ADMIN_CFG.password);
    assert.ok(!userDoc.passwordHash.includes(ADMIN_CFG.password));

    // Must issue ZERO active sessions or tokens
    assert.equal(await Session.countDocuments({}), 0, "bootstrap must never emit active sessions");
  });

  it("is idempotent: re-running does not overwrite password or duplicate the account", async () => {
    await bootstrapAdmin(ADMIN_CFG);
    const initialDoc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();

    // Re-run bootstrap
    const again = await bootstrapAdmin(ADMIN_CFG);
    assert.equal(again.outcome, "unchanged");
    assert.equal(again.passwordMatchesConfig, true);

    assert.equal(await User.countDocuments({ email: ADMIN_CFG.email }), 1);
    const afterDoc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();
    assert.equal(String(afterDoc._id), String(initialDoc._id));
    assert.equal(afterDoc.passwordHash, initialDoc.passwordHash);
  });

  it("reports password mismatch on existing admin without modifying the account", async () => {
    await bootstrapAdmin(ADMIN_CFG);
    const beforeDoc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();

    const result = await bootstrapAdmin({ ...ADMIN_CFG, password: "a-different-password-123" });
    assert.equal(result.outcome, "unchanged");
    assert.equal(result.passwordMatchesConfig, false);

    const afterDoc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();
    assert.equal(afterDoc.passwordHash, beforeDoc.passwordHash);
  });

  it("handles concurrent bootstrap invocations safely", async () => {
    const results = await Promise.all([
      bootstrapAdmin(ADMIN_CFG),
      bootstrapAdmin(ADMIN_CFG),
      bootstrapAdmin(ADMIN_CFG),
    ]);
    const createdCount = results.filter((r) => r.outcome === "created").length;
    assert.equal(createdCount, 1);
    assert.equal(await User.countDocuments({ email: ADMIN_CFG.email }), 1);
  });
});

describe("bootstrapAdmin: refusal of non-admin account promotion", () => {
  for (const role of ["USER", "EXPERT"]) {
    it(`refuses to elevate an existing ${role} account and leaves it untouched`, async () => {
      await User.create({
        name: "Existing User",
        email: ADMIN_CFG.email,
        passwordHash: "dummy-hash-12345",
        role,
      });

      await assert.rejects(bootstrapAdmin(ADMIN_CFG), (err) => {
        assert.ok(err instanceof BootstrapRefusal);
        assert.match(err.message, new RegExp(role));
        assert.ok(!err.message.includes(ADMIN_CFG.password));
        return true;
      });

      const doc = await User.findOne({ email: ADMIN_CFG.email }).select("+passwordHash").lean();
      assert.equal(doc.role, role);
      assert.equal(doc.passwordHash, "dummy-hash-12345");
      assert.equal(await User.countDocuments({}), 1);
    });
  }

  it("a registered standard USER cannot be elevated via bootstrap", async () => {
    await register({ name: "Standard User", email: ADMIN_CFG.email, password: ADMIN_CFG.password });
    await assert.rejects(bootstrapAdmin(ADMIN_CFG), BootstrapRefusal);

    const doc = await User.findOne({ email: ADMIN_CFG.email }).lean();
    assert.equal(doc.role, "USER");
  });
});

describe("bootstrapAdmin: authenticates and governs via standard auth path", () => {
  it("bootstrapped ADMIN logs in via POST /api/v1/auth/login and has ADMIN permissions", async () => {
    await bootstrapAdmin(ADMIN_CFG);
    const token = await loginToken(ADMIN_CFG);

    // Verify identity via /me
    const meRes = await request("GET", "/api/v1/auth/me", { token });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.json.data.user.role, "ADMIN");

    // Verify ADMIN governance access: pending expert applications
    const queueRes = await request("GET", "/api/v1/expert-application", { token });
    assert.equal(queueRes.status, 200);

    // Wrong password fails
    const badLogin = await request("POST", "/api/v1/auth/login", {
      body: { email: ADMIN_CFG.email, password: "incorrect-password" },
    });
    assert.equal(badLogin.status, 401);
  });

  it("ADMIN cannot review Knowledge (role boundary strictly preserved)", async () => {
    await bootstrapAdmin(ADMIN_CFG);
    const adminToken = await loginToken(ADMIN_CFG);

    // Create knowledge as author
    const { user } = await register({
      name: "Author User",
      email: "author@aquaveda.test",
      password: "author-password-1",
    });
    const author = { id: String(user.id), role: "USER" };
    const k = await createKnowledge(author, { title: "Water conservation", body: "Rainwater harvesting techniques." });
    await submitForReview(author, String(k._id));

    // ADMIN has no Knowledge review authority (ADR-0004 / Issue #90)
    const reviewQueueRes = await request("GET", "/api/v1/knowledge/review-queue", { token: adminToken });
    assert.equal(reviewQueueRes.status, 403);

    const approveRes = await request("POST", `/api/v1/knowledge/${k._id}/approve`, { token: adminToken });
    assert.equal(approveRes.status, 403);
  });
});
