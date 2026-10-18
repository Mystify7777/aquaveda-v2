/**
 * #111 — full bootstrap CLI orchestration: config -> connect -> bootstrap/report
 * -> cleanup. Pure tests: every dependency boundary is injected, no database is
 * reachable, all credentials are synthetic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  runCli,
  BootstrapRefusal,
  REQUIRED_CONFIRMATION,
} from "../scripts/bootstrap-admin.js";
import { PromptAborted } from "../scripts/secret-prompt.js";

const HARNESS = fileURLToPath(new URL("./helpers/bootstrap-cli-harness.mjs", import.meta.url));

const SECRET = "synthetic-Secret-passphrase-42";
const EMAIL = "admin@production.test";
const FIXTURE_DB = "bootstrap_fixture";
const FIXTURE_URI = `mongodb+srv://fixture_user:fixture_pass@cluster.example.invalid/${FIXTURE_DB}?retryWrites=true`;
const LEAKS = [SECRET, "fixture_pass", "fixture_user", "example.invalid", "$scrypt", "forged-line"];

const ENV = Object.freeze({
  NODE_ENV: "production",
  CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
  MONGO_URI: FIXTURE_URI,
  BOOTSTRAP_EXPECTED_DB: FIXTURE_DB,
  ADMIN_EMAIL: EMAIL,
  ADMIN_PASSWORD: SECRET,
});
const withEnv = (patch = {}) => {
  const env = { ...ENV, ...patch };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
};

const hostile = (name, extra = {}) =>
  Object.assign(
    new Error(`driver: ${FIXTURE_URI} password=${SECRET} hash=$scrypt$x\nforged-line`),
    { name, ...extra },
  );

/** Builds a recorder + fake deps. `over` replaces individual dependencies. */
function harness(over = {}, { env = withEnv(), argv = [] } = {}) {
  const events = [];
  const out = { log: [], warn: [], error: [] };
  const deps = {
    connect: async (uri) => {
      events.push(["connect", uri]);
    },
    bootstrap: async (config) => {
      events.push(["bootstrap", config]);
      return { outcome: "created", email: config.email };
    },
    disconnect: async () => {
      events.push(["disconnect"]);
    },
    ...over,
  };
  const run = () =>
    runCli({
      env,
      argv,
      deps,
      log: (l) => {
        events.push(["log", l]);
        out.log.push(l);
      },
      warn: (l) => {
        events.push(["warn", l]);
        out.warn.push(l);
      },
      error: (l) => {
        events.push(["error", l]);
        out.error.push(l);
      },
    });
  const names = () => events.map((e) => e[0]);
  const count = (n) => events.filter((e) => e[0] === n).length;
  return { run, events, out, names, count };
}

const allOutput = (h) => [...h.out.log, ...h.out.warn, ...h.out.error].join("\n");
function assertNoLeaks(h) {
  const text = allOutput(h);
  for (const leak of LEAKS) assert.ok(!text.includes(leak), `output leaked ${JSON.stringify(leak)}:\n${text}`);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f]/.test(text), "output must not contain control characters");
}

// ---------------------------------------------------------------------------
describe("runCli: success paths", () => {
  it("resolves config, connects with the exact validated URI, bootstraps with the config, reports, then cleans up (in order)", async () => {
    const h = harness();
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.names(), ["connect", "bootstrap", "log", "disconnect"]);
    assert.strictEqual(h.events[0][1], FIXTURE_URI, "connect must receive exactly the validated string");
    const config = h.events[1][1];
    assert.equal(config.email, EMAIL);
    assert.equal(config.password, SECRET);
    assert.strictEqual(config.mongoUri, FIXTURE_URI);
    assert.deepEqual(h.out.log, [`[bootstrap-admin] created ADMIN ${EMAIL}`]);
    assert.deepEqual(h.out.error, []);
    assertNoLeaks(h);
  });

  it("existing ADMIN: reports unchanged, warns on password mismatch without echoing secrets, exits 0, cleans up", async () => {
    const h = harness({
      bootstrap: async () => ({ outcome: "unchanged", email: EMAIL, passwordMatchesConfig: false }),
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.names(), ["connect", "log", "warn", "disconnect"]);
    assert.match(h.out.log[0], /already exists; nothing changed/);
    assert.match(h.out.warn[0], /existing password differs/);
    assertNoLeaks(h);
  });

  it("existing ADMIN with matching password: no warning", async () => {
    const h = harness({
      bootstrap: async () => ({ outcome: "unchanged", email: EMAIL, passwordMatchesConfig: true }),
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.out.warn, []);
    assert.equal(h.count("disconnect"), 1);
  });

  it("hidden-prompt path: password comes from promptSecret (twice), never from the echoing prompt", async () => {
    const asked = [];
    const h = harness(
      {
        prompt: async (q) => {
          asked.push(["prompt", q]);
          return "";
        },
        promptSecret: async (q) => {
          asked.push(["secret", q]);
          return SECRET;
        },
      },
      { env: withEnv({ ADMIN_PASSWORD: undefined }) },
    );
    assert.equal(await h.run(), 0);
    assert.deepEqual(asked.map((a) => a[0]), ["secret", "secret"]);
    assert.equal(h.events.find((e) => e[0] === "bootstrap")[1].password, SECRET);
    assertNoLeaks(h);
  });
});

// ---------------------------------------------------------------------------
describe("runCli: failure paths always clean up", () => {
  it("connection failure: bootstrap never runs, cleanup runs once, failure is sanitized", async () => {
    const h = harness({
      connect: async (uri) => {
        h.events.push(["connect", uri]);
        throw hostile("MongoServerSelectionError", { code: "ENOTFOUND" });
      },
    });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.names(), ["connect", "error", "disconnect"]);
    assert.match(h.out.error[0], /unexpected failure: MongoServerSelectionError \(code ENOTFOUND\)/);
    assertNoLeaks(h);
  });

  it("connect throwing synchronously still counts as an attempt and triggers cleanup", async () => {
    const h = harness({
      connect: () => {
        throw hostile("SyncConnectBoom");
      },
    });
    assert.equal(await h.run(), 1);
    assert.equal(h.count("bootstrap"), 0);
    assert.equal(h.count("disconnect"), 1);
    assertNoLeaks(h);
  });

  it("bootstrap failure (unexpected error): cleanup runs once, failure is sanitized", async () => {
    const h = harness({
      bootstrap: async () => {
        throw hostile("MongoServerError", { code: 11000 });
      },
    });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.names(), ["connect", "error", "disconnect"]);
    assert.match(h.out.error[0], /MongoServerError \(code 11000\)/);
    assertNoLeaks(h);
  });

  it("bootstrap refusal (e.g. role elevation): its own message is preserved verbatim, cleanup runs", async () => {
    const msg = `Refusing to bootstrap: ${EMAIL} already exists with role USER. Existing accounts are never elevated by this tool.`;
    const h = harness({
      bootstrap: async () => {
        throw new BootstrapRefusal(msg);
      },
    });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.out.error, [`[bootstrap-admin] ${msg}`]);
    assert.equal(h.count("disconnect"), 1);
  });
});

// ---------------------------------------------------------------------------
describe("runCli: cleanup failures", () => {
  it("cleanup failure after success: operation reported, exit 1, explicit message, sanitized, not rolled back", async () => {
    const h = harness({
      disconnect: async () => {
        h.events.push(["disconnect"]);
        throw hostile("CleanupBoom", { code: "ECLEANUP" });
      },
    });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.names(), ["connect", "bootstrap", "log", "disconnect", "error"]);
    assert.deepEqual(h.out.log, [`[bootstrap-admin] created ADMIN ${EMAIL}`]);
    assert.match(h.out.error[0], /bootstrap completed, but cleanup failed: unexpected failure: CleanupBoom \(code ECLEANUP\)/);
    assert.match(h.out.error[0], /not rolled back and is safe to re-run/);
    assertNoLeaks(h);
  });

  it("primary AND cleanup fail: primary reported first and intact, cleanup reported as additional, exit 1", async () => {
    const h = harness({
      bootstrap: async () => {
        throw hostile("PrimaryBoom", { code: "EPRIMARY" });
      },
      disconnect: async () => {
        h.events.push(["disconnect"]);
        throw hostile("CleanupBoom", { code: "ECLEANUP" });
      },
    });
    assert.equal(await h.run(), 1);
    assert.equal(h.out.error.length, 2);
    assert.match(h.out.error[0], /^\[bootstrap-admin\] unexpected failure: PrimaryBoom \(code EPRIMARY\)/);
    assert.match(h.out.error[1], /^\[bootstrap-admin\] cleanup also failed: unexpected failure: CleanupBoom \(code ECLEANUP\)/);
    assert.ok(!h.out.error[0].includes("CleanupBoom"), "cleanup error must not replace/blend into the primary");
    assertNoLeaks(h);
  });

  it("primary refusal AND cleanup failure: the refusal text survives verbatim", async () => {
    const msg = "Refusing to bootstrap: explicit confirmation required.";
    const h = harness({
      bootstrap: async () => {
        throw new BootstrapRefusal(msg);
      },
      disconnect: async () => {
        throw hostile("CleanupBoom");
      },
    });
    assert.equal(await h.run(), 1);
    assert.equal(h.out.error[0], `[bootstrap-admin] ${msg}`);
    assert.match(h.out.error[1], /cleanup also failed/);
  });

  it("primary connection failure AND cleanup failure: both reported, primary first", async () => {
    const h = harness({
      connect: async () => {
        throw hostile("ConnectBoom");
      },
      disconnect: async () => {
        throw hostile("CleanupBoom");
      },
    });
    assert.equal(await h.run(), 1);
    assert.match(h.out.error[0], /ConnectBoom/);
    assert.match(h.out.error[1], /CleanupBoom/);
    assertNoLeaks(h);
  });

  it("a synchronously throwing cleanup is handled like a rejection", async () => {
    const h = harness({
      disconnect: () => {
        throw hostile("SyncCleanupBoom", { code: "EBOOM" });
      },
    });
    assert.equal(await h.run(), 1);
    assert.match(h.out.error[0], /cleanup failed: unexpected failure: SyncCleanupBoom \(code EBOOM\)/);
    assertNoLeaks(h);
  });

  it("hostile cleanup error metadata (control characters, URI, secret) never reaches output", async () => {
    const h = harness({
      disconnect: async () => {
        throw Object.assign(new Error("m"), { name: `X ${SECRET}\nforged-line`, code: `${FIXTURE_URI}\r\n` });
      },
    });
    assert.equal(await h.run(), 1);
    assert.match(h.out.error[0], /unexpected failure: Error\./);
    assertNoLeaks(h);
  });
});

// ---------------------------------------------------------------------------
describe("runCli: cleanup is awaited", () => {
  const paths = [
    ["success", {}],
    ["connect failure", { connect: async () => { throw hostile("ConnectBoom"); } }],
    ["bootstrap failure", { bootstrap: async () => { throw hostile("BootBoom"); } }],
  ];

  const flush = async (turns = 3) => {
    for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
  };

  for (const [name, over] of paths) {
    it(`${name}: runCli does not settle until a gated cleanup is released`, async () => {
      let release;
      const gate = new Promise((r) => (release = r));
      let markStarted;
      const cleanupStarted = new Promise((r) => (markStarted = r));
      const h = harness({
        ...over,
        disconnect: async () => {
          h.events.push(["disconnect:start"]);
          markStarted();
          await gate;
          h.events.push(["disconnect:end"]);
        },
      });
      let settled = false;
      const p = h.run().then((code) => {
        settled = true;
        h.events.push(["returned"]);
        return code;
      });
      await cleanupStarted; // deterministic: no timing assumption
      await flush(); // give a non-awaiting implementation the chance to settle
      assert.equal(settled, false, "must still be waiting on cleanup");
      release();
      await p;
      const n = h.names();
      assert.ok(n.indexOf("disconnect:end") < n.indexOf("returned"));
    });
  }

  it("a cleanup that rejects asynchronously is caught: no unhandled rejection, failure still reported", async () => {
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      let release;
      const gate = new Promise((r) => (release = r));
      let markStarted;
      const cleanupStarted = new Promise((r) => (markStarted = r));
      const h = harness({
        disconnect: async () => {
          markStarted();
          await gate;
          throw hostile("LateCleanupBoom");
        },
      });
      const p = h.run();
      await cleanupStarted;
      release();
      assert.equal(await p, 1);
      await flush(5); // unhandledRejection is emitted after the microtask drain
      assert.deepEqual(unhandled, []);
      assert.match(h.out.error[0], /LateCleanupBoom/);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("cleanup is attempted exactly once per run on every path", async () => {
    for (const [, over] of paths) {
      const h = harness(over);
      await h.run();
      assert.equal(h.count("disconnect"), 1);
    }
  });
});

// ---------------------------------------------------------------------------
describe("runCli: refusals before any connection", () => {
  const cases = [
    ["non-production environment", { env: withEnv({ NODE_ENV: "development" }) }, /target environment must be "production"/],
    ["missing confirmation", { env: withEnv({ CONFIRM_PRODUCTION_BOOTSTRAP: undefined }) }, /explicit confirmation required/],
    ["missing expected database name", { env: withEnv({ BOOTSTRAP_EXPECTED_DB: undefined }) }, /expected database name is required/],
    ["mismatched expected database", { env: withEnv({ BOOTSTRAP_EXPECTED_DB: "other_fixture" }) }, /does not match the expected database/],
    ["loopback target", { env: withEnv({ MONGO_URI: `mongodb://127.0.0.1:27017/${FIXTURE_DB}?tls=true` }) }, /loopback or unspecified host/],
    ["non-TLS mongodb:// target", { env: withEnv({ MONGO_URI: `mongodb://db0.example.invalid:27017/${FIXTURE_DB}` }) }, /without "tls=true"/],
    ["development database", { env: withEnv({ MONGO_URI: "mongodb+srv://cluster.example.invalid/aquaveda_v2_dev", BOOTSTRAP_EXPECTED_DB: "aquaveda_v2_dev" }) }, /development\/test marker/],
    ["--password argument", { argv: [`--password=${SECRET}`] }, /--password is not supported/],
    ["missing password without a prompt", { env: withEnv({ ADMIN_PASSWORD: undefined }) }, /ADMIN_PASSWORD is required/],
    ["invalid email", { env: withEnv({ ADMIN_EMAIL: "not-an-email" }) }, /must be a valid email address/],
    ["too-short password", { env: withEnv({ ADMIN_PASSWORD: "short" }) }, /at least 8 characters/],
  ];

  for (const [name, opts, pattern] of cases) {
    it(`${name}: exit 1, no connect, no bootstrap, no cleanup, sanitized output`, async () => {
      const h = harness({}, opts);
      assert.equal(await h.run(), 1);
      assert.deepEqual(h.names(), ["error"]);
      assert.match(h.out.error[0], pattern);
      assertNoLeaks(h);
    });
  }

  it("mismatched hidden-prompt entries: refused before connect", async () => {
    const answers = [SECRET, `${SECRET}-typo`];
    const h = harness({ promptSecret: async () => answers.shift() }, { env: withEnv({ ADMIN_PASSWORD: undefined }) });
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.names(), ["error"]);
    assert.match(h.out.error[0], /did not match/);
    assertNoLeaks(h);
  });

  it("prompt aborted (Ctrl+C): refused before connect with the fixed abort text", async () => {
    const h = harness(
      { promptSecret: async () => { throw new PromptAborted("interrupted"); } },
      { env: withEnv({ ADMIN_PASSWORD: undefined }) },
    );
    assert.equal(await h.run(), 1);
    assert.deepEqual(h.names(), ["error"]);
    assert.equal(h.out.error[0], "[bootstrap-admin] interrupted");
  });
});

// ---------------------------------------------------------------------------
describe("bootstrap CLI subprocess harness (real main(), real streams, fake deps)", () => {
  const run = (scenario) =>
    spawnSync(process.execPath, [HARNESS], {
      env: { ...process.env, ...ENV, HARNESS_SCENARIO: scenario },
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 15_000,
    });
  const assertClean = (r) => {
    const all = r.stdout + r.stderr;
    for (const leak of LEAKS) assert.ok(!all.includes(leak), `leaked ${leak}:\n${all}`);
    assert.doesNotMatch(r.stderr, /UnhandledPromiseRejection|unhandled|at \S+ \(/i, "no raw stack/unhandled rejection output");
  };

  it("success: exit 0, report then cleanup output, clean stderr", () => {
    const r = run("success");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /created ADMIN/);
    assert.match(r.stdout, /\[harness\] disconnect-done/);
    assert.equal(r.stderr, "");
    assertClean(r);
  });

  it("connect failure: exit 1, sanitized, cleanup still ran", () => {
    const r = run("connect-fails");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unexpected failure: MongoServerSelectionError/);
    assert.match(r.stdout, /disconnect-done/);
    assertClean(r);
  });

  it("cleanup failure after success: exit 1, success output kept, awaited rejection handled (no unhandled-rejection crash text)", () => {
    const r = run("cleanup-fails");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /created ADMIN/);
    assert.match(r.stderr, /bootstrap completed, but cleanup failed: unexpected failure: CleanupBoom/);
    assertClean(r);
  });

  it("primary and cleanup failures: both reported, primary first, exit 1", () => {
    const r = run("both-fail");
    assert.equal(r.status, 1);
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /PrimaryBoom/);
    assert.match(lines[1], /cleanup also failed: .*CleanupBoom/);
    assertClean(r);
  });

  it("synchronously throwing cleanup: exit 1, sanitized with code", () => {
    const r = run("sync-throw-cleanup");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SyncCleanupBoom \(code EBOOM\)/);
    assertClean(r);
  });
});
