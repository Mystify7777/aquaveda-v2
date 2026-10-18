/**
 * #118 — the connection string is accepted ONLY from MONGO_URI. Pure tests:
 * no database, no network, synthetic fixtures only (reserved .invalid host).
 * The subprocess cases only exercise refusal paths that exit before any connection
 * attempt; real connection behavior belongs to the isolated integration suites.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  resolveBootstrapConfig,
  runBootstrap,
  hasCommandLineConnectionString,
  BootstrapRefusal,
  REQUIRED_CONFIRMATION,
} from "../scripts/bootstrap-admin.js";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/bootstrap-admin.js", import.meta.url));
const PASSWORD = "synthetic-admin-passphrase-42";
const FIXTURE_DB = "bootstrap_fixture";
const FIXTURE_URI = `mongodb+srv://fixture_user:fixture_pass@cluster.example.invalid/${FIXTURE_DB}?retryWrites=true`;
const OTHER_URI = `mongodb+srv://other_user:other_pass@elsewhere.example.invalid/${FIXTURE_DB}`;
const LEAKS = ["fixture_user", "fixture_pass", "other_user", "other_pass", "example.invalid", "cluster.", "elsewhere", PASSWORD];

const VALID_ENV = Object.freeze({
  NODE_ENV: "production",
  CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
  MONGO_URI: FIXTURE_URI,
  BOOTSTRAP_EXPECTED_DB: FIXTURE_DB,
  ADMIN_EMAIL: "admin@production.test",
  ADMIN_PASSWORD: PASSWORD,
});
const withEnv = (patch = {}) => {
  const env = { ...VALID_ENV, ...patch };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
};

/** Every spelling/shape that attempts to put a connection string on the command line. */
const FORBIDDEN_ARGV = [
  ["bare flag", ["--mongo-uri"]],
  ["empty value", ["--mongo-uri="]],
  ["value after =", [`--mongo-uri=${OTHER_URI}`]],
  ["value as next token", ["--mongo-uri", OTHER_URI]],
  ["bare flag before another flag", ["--mongo-uri", `--expect-db=${FIXTURE_DB}`]],
  ["empty value alongside expect-db", ["--mongo-uri=", `--expect-db=${FIXTURE_DB}`]],
  ["double equals (malformed)", [`--mongo-uri==${OTHER_URI}`]],
  ["single dash", [`-mongo-uri=${OTHER_URI}`]],
  ["underscore spelling", [`--mongo_uri=${OTHER_URI}`]],
  ["camelCase spelling", [`--mongoUri=${OTHER_URI}`]],
  ["upper-case spelling", [`--MONGO-URI=${OTHER_URI}`]],
  ["mongodb-uri alias spelling", [`--mongodb-uri=${OTHER_URI}`]],
  ["bare/empty alias: --mongodb-uri", ["--mongodb-uri"]],
  ["bare/empty alias: --uri=", ["--uri="]],
  ["bare/empty alias: --mongo-url", ["--mongo-url"]],
  ["bare/empty alias: --mongo_uri=", ["--mongo_uri="]],
  ["bare/empty alias: --MongoUri=", ["--MongoUri="]],
  ["bare/empty alias: -mongo-uri", ["-mongo-uri"]],
  ["--uri", [`--uri=${OTHER_URI}`]],
  ["--mongo-url", [`--mongo-url=${OTHER_URI}`]],
  ["positional connection string", [OTHER_URI]],
  ["upper-case scheme, positional", [OTHER_URI.replace("mongodb+srv", "MONGODB+SRV")]],
  ["connection string as another flag's value", ["--email", OTHER_URI]],
  ["connection string inside another flag's =value", [`--name=${OTHER_URI}`]],
];

const assertSanitizedRefusal = (err) => {
  assert.ok(err instanceof BootstrapRefusal, `expected BootstrapRefusal, got ${err}`);
  assert.match(err.message, /connection strings are not accepted as command-line arguments/);
  assert.match(err.message, /MONGO_URI environment variable/);
  for (const leak of LEAKS) assert.ok(!err.message.includes(leak), `message leaked ${leak}`);
  return true;
};

describe("hasCommandLineConnectionString", () => {
  for (const [name, argv] of FORBIDDEN_ARGV) {
    it(`detects: ${name}`, () => assert.equal(hasCommandLineConnectionString(argv), true));
  }

  for (const argv of [
    [],
    [`--expect-db=${FIXTURE_DB}`],
    ["--expect-db", FIXTURE_DB],
    ["--target-env=production"],
    [`--confirm=${REQUIRED_CONFIRMATION}`],
    ["--email=admin@production.test"],
    ["--name=Mongo Uri Admin"],
    ["--name=mongodb"],
    ["--name", "uri"],
    ["--urinary=1"],
    ["--curi=1"],
  ]) {
    it(`does not flag legitimate arguments: ${JSON.stringify(argv)}`, () =>
      assert.equal(hasCommandLineConnectionString(argv), false));
  }
});

describe("resolveBootstrapConfig: connection string only from MONGO_URI (#118)", () => {
  for (const [name, argv] of FORBIDDEN_ARGV) {
    it(`refuses (${name}) even with a valid MONGO_URI in the environment (no fallback)`, async () => {
      await assert.rejects(resolveBootstrapConfig(withEnv(), argv), assertSanitizedRefusal);
    });
  }

  it("the argv refusal is reported even when MONGO_URI is missing/invalid (rejection precedes any env use)", async () => {
    for (const env of [withEnv({ MONGO_URI: undefined }), withEnv({ MONGO_URI: "" }), withEnv({ MONGO_URI: "not a uri" })]) {
      await assert.rejects(resolveBootstrapConfig(env, ["--mongo-uri="]), assertSanitizedRefusal);
    }
  });

  it("the argv refusal is checked before production-intent/confirmation/target gates", async () => {
    for (const env of [
      withEnv({ NODE_ENV: "development" }),
      withEnv({ CONFIRM_PRODUCTION_BOOTSTRAP: undefined }),
      withEnv({ BOOTSTRAP_EXPECTED_DB: undefined }),
    ]) {
      await assert.rejects(resolveBootstrapConfig(env, [`--mongo-uri=${OTHER_URI}`]), assertSanitizedRefusal);
    }
  });

  it("never consults prompts after refusing a command-line connection string", async () => {
    let prompted = 0;
    const spy = async () => {
      prompted++;
      return "";
    };
    await assert.rejects(
      resolveBootstrapConfig(withEnv(), ["--mongo-uri"], { prompt: spy, promptSecret: spy }),
      assertSanitizedRefusal,
    );
    assert.equal(prompted, 0);
  });

  it("reads the connection string from MONGO_URI and returns exactly that string", async () => {
    const config = await resolveBootstrapConfig(withEnv(), []);
    assert.strictEqual(config.mongoUri, FIXTURE_URI);
  });

  it("legitimate flags still work alongside MONGO_URI (--expect-db keeps its flag-over-env semantics)", async () => {
    const ok = await resolveBootstrapConfig(
      withEnv({ BOOTSTRAP_EXPECTED_DB: "other_fixture" }),
      [`--expect-db=${FIXTURE_DB}`, "--name=Mongo Uri Admin"],
    );
    assert.strictEqual(ok.mongoUri, FIXTURE_URI);
    assert.equal(ok.name, "Mongo Uri Admin");
    for (const argv of [["--expect-db="], ["--expect-db"]]) {
      await assert.rejects(resolveBootstrapConfig(withEnv(), argv), /expected database name is required/);
    }
  });

  for (const [name, patch, pattern] of [
    ["missing MONGO_URI", { MONGO_URI: undefined }, /MONGO_URI is missing or empty/],
    ["empty MONGO_URI", { MONGO_URI: "" }, /MONGO_URI is missing or empty/],
    ["whitespace-only MONGO_URI", { MONGO_URI: "   " }, /MONGO_URI is missing or empty/],
    ["unsupported scheme", { MONGO_URI: `http://u:pw_secret@cluster.example.invalid/${FIXTURE_DB}` }, /scheme is not supported/],
    ["malformed URI", { MONGO_URI: "mongodb+srv://" }, /MONGO_URI/],
    ["loopback host", { MONGO_URI: `mongodb://u:pw_secret@127.0.0.1:27017/${FIXTURE_DB}?tls=true` }, /loopback or unspecified host/],
    ["mongodb:// without TLS", { MONGO_URI: `mongodb://u:pw_secret@db0.example.invalid:27017/${FIXTURE_DB}` }, /without "tls=true"/],
    ["database name mismatch", { BOOTSTRAP_EXPECTED_DB: "other_fixture" }, /does not match the expected database/],
    ["development database", { MONGO_URI: "mongodb+srv://u:pw_secret@cluster.example.invalid/aquaveda_v2_dev", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_dev" }, /development\/test marker/],
  ]) {
    it(`fails closed: ${name}, with a message that discloses no username, password, host or URI`, async () => {
      await assert.rejects(resolveBootstrapConfig(withEnv(patch), []), (err) => {
        assert.ok(err instanceof BootstrapRefusal);
        assert.match(err.message, pattern);
        for (const leak of [...LEAKS, "pw_secret", "u:pw"]) assert.ok(!err.message.includes(leak), `leaked ${leak}`);
        return true;
      });
    });
  }
});

describe("runBootstrap: no connection or bootstrap for any command-line connection string (#118)", () => {
  const spies = () => {
    const calls = { connect: [], bootstrap: [] };
    return {
      calls,
      deps: {
        connect: async (uri) => void calls.connect.push(uri),
        bootstrap: async (config) => {
          calls.bootstrap.push(config);
          return { outcome: "created", email: config.email };
        },
      },
    };
  };

  for (const [name, argv] of FORBIDDEN_ARGV) {
    it(`never calls connect or bootstrap: ${name}`, async () => {
      const { calls, deps } = spies();
      await assert.rejects(runBootstrap(withEnv(), argv, deps), assertSanitizedRefusal);
      assert.deepEqual(calls.connect, []);
      assert.deepEqual(calls.bootstrap, []);
    });
  }

  it("connects exactly once with exactly the validated MONGO_URI string (#109 pass-through preserved), then bootstraps", async () => {
    for (const uri of [
      FIXTURE_URI,
      `mongodb://fixture_user:fixture_pass@db0.example.invalid:27017,db1.example.invalid:27017/${FIXTURE_DB}?tls=true&replicaSet=rs0&authSource=admin`,
    ]) {
      const { calls, deps } = spies();
      const result = await runBootstrap(withEnv({ MONGO_URI: uri }), [`--expect-db=${FIXTURE_DB}`], deps);
      assert.equal(result.outcome, "created");
      assert.equal(calls.connect.length, 1);
      assert.strictEqual(calls.connect[0], uri);
      assert.equal(calls.bootstrap.length, 1);
      assert.strictEqual(calls.bootstrap[0].mongoUri, uri);
    }
  });

  it("an invalid MONGO_URI never reaches connect", async () => {
    const { calls, deps } = spies();
    await assert.rejects(runBootstrap(withEnv({ MONGO_URI: undefined }), [], deps), /MONGO_URI is missing or empty/);
    assert.deepEqual(calls.connect, []);
  });
});

describe("bootstrap-admin CLI process: command-line connection strings (#118)", () => {
  const run = (args, envPatch = {}) =>
    spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      env: { ...process.env, ADMIN_BOOTSTRAP_PASSWORD: "", ADMIN_BOOTSTRAP_EMAIL: "", ADMIN_BOOTSTRAP_NAME: "", ...VALID_ENV, ...envPatch },
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 15_000,
    });

  for (const [name, argv] of [
    ["--mongo-uri=<uri>", [`--mongo-uri=${OTHER_URI}`]],
    ["--mongo-uri <uri>", ["--mongo-uri", OTHER_URI]],
    ["--mongo-uri=", ["--mongo-uri="]],
    ["bare --mongo-uri", ["--mongo-uri"]],
    ["positional URI", [OTHER_URI]],
  ]) {
    it(`${name}: exit 1, no database activity, nothing disclosed (valid MONGO_URI present, no fallback)`, () => {
      const r = run(argv);
      const all = r.stdout + r.stderr;
      assert.equal(r.status, 1);
      assert.match(r.stderr, /connection strings are not accepted as command-line arguments/);
      assert.doesNotMatch(all, /\[db\]|created ADMIN|already exists/);
      for (const leak of LEAKS) assert.ok(!all.includes(leak), `leaked ${leak}`);
    });
  }
});
