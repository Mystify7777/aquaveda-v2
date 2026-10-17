/**
 * #110 — credential-input security. Pure tests: no database, no real terminal.
 * Streams/process are fakes; secrets are synthetic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  resolveBootstrapConfig,
  describeFailure,
  BootstrapRefusal,
  REQUIRED_CONFIRMATION,
} from "../scripts/bootstrap-admin.js";
import { promptHidden, PromptAborted } from "../scripts/secret-prompt.js";
import { safeErrorTag } from "../src/config/safe-error.js";
import { logConnectionError } from "../src/config/db.js";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/bootstrap-admin.js", import.meta.url));
const SECRET = "synthetic-Secret-passphrase-42";
const FIXTURE_DB = "bootstrap_fixture";
const FIXTURE_URI = `mongodb+srv://fixture_user:fixture_pass@cluster.example.invalid/${FIXTURE_DB}?retryWrites=true`;
const BASE_ENV = Object.freeze({
  NODE_ENV: "production",
  CONFIRM_PRODUCTION_BOOTSTRAP: REQUIRED_CONFIRMATION,
  MONGO_URI: FIXTURE_URI,
  BOOTSTRAP_EXPECTED_DB: FIXTURE_DB,
  ADMIN_EMAIL: "admin@production.test",
});

// ---------------------------------------------------------------------------
// Fake TTY
// ---------------------------------------------------------------------------
function fakeTty({ isRaw = false, failRaw = false } = {}) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = isRaw;
  input.rawCalls = [];
  input.setRawMode = (mode) => {
    if (failRaw && mode === true) throw new Error("no tty");
    input.rawCalls.push(mode);
    input.isRaw = mode;
    return input;
  };
  const written = [];
  const output = { write: (t) => written.push(String(t)) };
  const proc = new EventEmitter();
  proc.pid = 424242;
  proc.killed = [];
  proc.kill = (pid, sig) => proc.killed.push([pid, sig]);
  return { input, output, written, proc };
}
const type = (input, text) => input.write(text);
const outText = (t) => t.written.join("");
const listenerTotals = (t) =>
  ["data", "error", "end", "close"].reduce((n, e) => n + t.input.listenerCount(e), 0) +
  ["exit", "SIGINT", "SIGTERM", "SIGHUP"].reduce((n, e) => n + t.proc.listenerCount(e), 0);

describe("promptHidden: no echo", () => {
  it("returns the typed line and never writes it (or a mask) to output", async () => {
    const t = fakeTty();
    const p = promptHidden("Password: ", t);
    type(t.input, `${SECRET}\r`);
    assert.equal(await p, SECRET);
    assert.equal(outText(t), "Password: \n");
    assert.ok(!outText(t).includes(SECRET));
    assert.ok(!outText(t).includes("*"));
  });

  it("handles chunked input, backspace, Ctrl+U, arrow-key escapes and multibyte characters", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "abx\u007f");              // backspace removes x
    type(t.input, "\u001b[A\u001b[1;5C");    // arrow / modified-arrow ignored
    type(t.input, "zz\u0015");               // Ctrl+U clears everything so far
    type(t.input, "p\u00e4ss");              // ä
    type(t.input, "\u0004w\n");              // Ctrl+D ignored when non-empty
    assert.equal(await p, "pässw");
    assert.equal(outText(t), "P: \n");
  });

  it("does not trim: leading/trailing spaces are part of the password", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "  spaced pass  \n");
    assert.equal(await p, "  spaced pass  ");
  });
});

describe("promptHidden: terminal restoration", () => {
  it("enables raw mode during input and restores it, pauses stdin and removes every listener on success", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    assert.deepEqual(t.input.rawCalls, [true]);
    assert.ok(listenerTotals(t) > 0);
    type(t.input, "x\r");
    await p;
    assert.deepEqual(t.input.rawCalls, [true, false]);
    assert.equal(t.input.isRaw, false);
    assert.equal(t.input.isPaused(), true);
    assert.equal(listenerTotals(t), 0);
  });

  it("restores the PREVIOUS raw state rather than forcing false", async () => {
    const t = fakeTty({ isRaw: true });
    const p = promptHidden("P: ", t);
    type(t.input, "x\r");
    await p;
    assert.deepEqual(t.input.rawCalls, [true, true]);
  });

  it("Ctrl+C rejects with PromptAborted, restores the terminal, and echoes nothing typed", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "partial-secret\u0003");
    await assert.rejects(p, (e) => e instanceof PromptAborted && /interrupted/.test(e.message));
    assert.equal(t.input.isRaw, false);
    assert.equal(listenerTotals(t), 0);
    assert.ok(!outText(t).includes("partial-secret"));
  });

  it("Ctrl+D on empty input aborts and restores", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "\u0004");
    await assert.rejects(p, PromptAborted);
    assert.equal(t.input.isRaw, false);
    assert.equal(listenerTotals(t), 0);
  });

  it("stream end before a newline aborts and restores", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "abc");
    t.input.end();
    await assert.rejects(p, PromptAborted);
    assert.equal(t.input.isRaw, false);
    assert.equal(listenerTotals(t), 0);
  });

  it("stream error rejects with a sanitized message and restores", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "abc");
    t.input.destroy(Object.assign(new Error(`boom ${SECRET}`), { code: "EIO" }));
    await assert.rejects(p, (e) => {
      assert.ok(e instanceof PromptAborted);
      assert.equal(e.message, "input failed"); // fixed text, no stream metadata
      return true;
    });
    assert.equal(t.input.isRaw, false);
    assert.equal(listenerTotals(t), 0);
  });

  it("stream errors with hostile name/code/message never reach the abort message", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    const hostile = Object.assign(new Error(`m ${SECRET}`), {
      name: `N ${SECRET}\nforged-log-line`,
      code: `${FIXTURE_URI}\r\n`,
    });
    t.input.destroy(hostile);
    await assert.rejects(p, (e) => {
      assert.equal(e.message, "input failed");
      assert.equal(e.reason, "input_error");
      return true;
    });
  });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    it(`${sig}: restores the terminal, rejects, detaches handlers, then re-raises the same signal exactly once`, async () => {
      const t = fakeTty();
      const p = promptHidden("P: ", t);
      type(t.input, "abc");
      t.proc.emit(sig);
      await assert.rejects(p, (e) => e instanceof PromptAborted && e.message === `terminated by ${sig}`);
      assert.equal(t.input.isRaw, false);
      assert.equal(listenerTotals(t), 0);
      assert.deepEqual(t.proc.killed, [], "re-raise is deferred until after the rejection is delivered");
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(t.proc.killed, [[t.proc.pid, sig]]);
      // Racing/duplicate signal after settlement: nothing to restore or re-raise twice.
      t.proc.emit(sig);
      await new Promise((r) => setImmediate(r));
      assert.equal(t.proc.killed.length, 1);
      assert.deepEqual(t.input.rawCalls, [true, false], "terminal restored exactly once");
    });
  }

  it("a signal arriving after a completed prompt does nothing (no re-raise, no second restore)", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "x\r");
    await p;
    t.proc.emit("SIGTERM");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(t.proc.killed, []);
    assert.deepEqual(t.input.rawCalls, [true, false]);
  });

  it("keyboard Ctrl+C (raw-mode byte, no OS signal) rejects without re-raising any signal", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    type(t.input, "\u0003");
    await assert.rejects(p, PromptAborted);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(t.proc.killed, []);
  });

  it("process `exit` synchronously restores raw mode even if the prompt never settles", async () => {
    const t = fakeTty();
    const p = promptHidden("P: ", t);
    assert.equal(t.input.isRaw, true);
    t.proc.emit("exit");
    assert.equal(t.input.isRaw, false);
    type(t.input, "\r"); // settle for cleanliness
    await p;
  });

  it("refuses non-TTY input without reading or touching raw mode (no echoing fallback)", async () => {
    const t = fakeTty();
    t.input.isTTY = false;
    await assert.rejects(promptHidden("P: ", t), PromptAborted);
    assert.deepEqual(t.input.rawCalls, []);
    assert.equal(outText(t), "");
    assert.equal(listenerTotals(t), 0);
  });

  it("fails closed and leaks no listeners if echo cannot be disabled", async () => {
    const t = fakeTty({ failRaw: true });
    await assert.rejects(promptHidden("P: ", t), /could not disable terminal echo/);
    assert.equal(listenerTotals(t), 0);
    assert.equal(outText(t), "");
  });

  it("an output write failure cannot strand the terminal in raw mode", async () => {
    const t = fakeTty();
    t.output.write = () => {
      throw new Error("EPIPE");
    };
    const p = promptHidden("P: ", t);
    type(t.input, "x\r");
    assert.equal(await p, "x");
    assert.equal(t.input.isRaw, false);
  });
});

// ---------------------------------------------------------------------------
// Credential sourcing & precedence
// ---------------------------------------------------------------------------
describe("resolveBootstrapConfig: password sourcing (#110)", () => {
  const refuses = (promise, pattern) =>
    assert.rejects(promise, (e) => {
      assert.ok(e instanceof BootstrapRefusal);
      assert.match(e.message, pattern);
      assert.ok(!e.message.includes(SECRET), "message leaked the password");
      assert.ok(!/fixture_pass|fixture_user|example\.invalid/.test(e.message), "message leaked URI content");
      return true;
    });

  for (const [name, argv] of [
    ["--password=value", [`--password=${SECRET}`]],
    ["--password value", ["--password", SECRET]],
    ["bare --password", ["--password"]],
    ["empty --password=", ["--password="]],
  ]) {
    it(`refuses ${name} even when ADMIN_PASSWORD is also set`, async () => {
      await refuses(
        resolveBootstrapConfig({ ...BASE_ENV, ADMIN_PASSWORD: SECRET }, argv),
        /--password is not supported/,
      );
    });
  }

  it("refuses --password before any prompt is issued", async () => {
    let prompted = false;
    const spy = async () => {
      prompted = true;
      return "";
    };
    await refuses(
      resolveBootstrapConfig({}, [`--password=${SECRET}`], { prompt: spy, promptSecret: spy }),
      /--password is not supported/,
    );
    assert.equal(prompted, false);
  });

  it("ADMIN_PASSWORD from the environment wins; the hidden prompt is never invoked", async () => {
    let called = 0;
    const config = await resolveBootstrapConfig({ ...BASE_ENV, ADMIN_PASSWORD: SECRET }, [], {
      promptSecret: async () => {
        called++;
        return "other-password-123";
      },
    });
    assert.equal(config.password, SECRET);
    assert.equal(called, 0);
  });

  it("ADMIN_BOOTSTRAP_PASSWORD alias still works; ADMIN_PASSWORD takes precedence over it", async () => {
    const alias = await resolveBootstrapConfig({ ...BASE_ENV, ADMIN_BOOTSTRAP_PASSWORD: SECRET }, []);
    assert.equal(alias.password, SECRET);
    const both = await resolveBootstrapConfig(
      { ...BASE_ENV, ADMIN_PASSWORD: SECRET, ADMIN_BOOTSTRAP_PASSWORD: "alias-password-123" },
      [],
    );
    assert.equal(both.password, SECRET);
  });

  it("requests the password twice via promptSecret when absent, and does not trim it", async () => {
    const queries = [];
    const config = await resolveBootstrapConfig(BASE_ENV, [], {
      promptSecret: async (q) => {
        queries.push(q);
        return `  ${SECRET}  `;
      },
    });
    assert.equal(queries.length, 2);
    assert.ok(queries.every((q) => /hidden/.test(q)));
    assert.equal(config.password, `  ${SECRET}  `);
  });

  it("refuses mismatched confirmation without echoing either entry", async () => {
    const answers = [SECRET, `${SECRET}-typo`];
    await refuses(
      resolveBootstrapConfig(BASE_ENV, [], { promptSecret: async () => answers.shift() }),
      /did not match/,
    );
  });

  it("propagates PromptAborted from the hidden prompt (Ctrl+C) untouched", async () => {
    await assert.rejects(
      resolveBootstrapConfig(BASE_ENV, [], {
        promptSecret: async () => {
          throw new PromptAborted("interrupted");
        },
      }),
      PromptAborted,
    );
  });

  it("requires a password when neither env nor an interactive prompt is available", async () => {
    await refuses(resolveBootstrapConfig(BASE_ENV, []), /ADMIN_PASSWORD is required/);
  });

  it("schema failures never echo the password", async () => {
    await refuses(resolveBootstrapConfig({ ...BASE_ENV, ADMIN_PASSWORD: "short" }, []), /at least 8/);
  });
});

// ---------------------------------------------------------------------------
// Failure-path sanitization
// ---------------------------------------------------------------------------
describe("describeFailure: secret sanitization (#110)", () => {
  it("passes through messages of the tool's own error types", () => {
    assert.equal(describeFailure(new BootstrapRefusal("Refusing: x")), "Refusing: x");
    assert.equal(describeFailure(new PromptAborted("interrupted")), "interrupted");
  });

  it("withholds the message of any other error (driver/DNS/library)", () => {
    const err = Object.assign(
      new Error(`connect failed for ${FIXTURE_URI} password=${SECRET} hash=$scrypt$abc`),
      { name: "MongoServerSelectionError", code: "ENOTFOUND" },
    );
    const text = describeFailure(err);
    assert.match(text, /MongoServerSelectionError/);
    assert.match(text, /ENOTFOUND/);
    for (const leak of [SECRET, "fixture_pass", "fixture_user", "example.invalid", "scrypt"]) {
      assert.ok(!text.includes(leak), `leaked ${leak}`);
    }
  });

  it("PromptAborted text is always a fixed string, even when constructed with hostile input", () => {
    const e = new PromptAborted(`${SECRET}\nforged`);
    assert.equal(e.message, "input aborted");
    assert.equal(describeFailure(e), "input aborted");
  });

  it("sanitizes hostile name/code values (secret, URI fragment, CR/LF, ANSI) and non-errors", () => {
    for (const bad of [`Bad ${SECRET}`, `${SECRET}/x`, `${FIXTURE_URI}`, "x\nforged: log line", "x\r\n", "\u001b[2J", "a".repeat(65)]) {
      const text = describeFailure(Object.assign(new Error("m"), { name: bad, code: bad }));
      assert.equal(text.split("\n").length, 1, "must be a single line");
      assert.ok(!/[\u0000-\u001f]/.test(text), "no control characters");
      for (const leak of [SECRET, "fixture_pass", "example.invalid", "forged"]) assert.ok(!text.includes(leak));
    }
    const hostile = Object.assign(new Error("x"), { name: `Bad ${SECRET}`, code: `${SECRET}/x` });
    const text = describeFailure(hostile);
    assert.ok(!text.includes(SECRET));
    assert.match(describeFailure(undefined), /unexpected failure: Error/);
    assert.match(describeFailure("string with " + SECRET), /unexpected failure/);
    assert.ok(!describeFailure("string with " + SECRET).includes(SECRET));
  });
});

describe("safeErrorTag / db connection-error listener (deterministic, no network)", () => {
  it("renders allowlisted name/code and safe integers only", () => {
    assert.equal(safeErrorTag(Object.assign(new Error("m"), { name: "MongoServerError", code: 11000 })), "MongoServerError (code 11000)");
    assert.equal(safeErrorTag(Object.assign(new Error("m"), { name: "MongoNetworkError", code: "ECONNRESET" })), "MongoNetworkError (code ECONNRESET)");
    assert.equal(safeErrorTag(Object.assign(new Error("m"), { name: "E", code: 1.5 })), "E");
    assert.equal(safeErrorTag(Object.assign(new Error("m"), { name: "E", code: 2 ** 60 })), "E");
    assert.equal(safeErrorTag(null), "Error");
  });

  it("falls back to fixed labels for hostile values", () => {
    const e = Object.assign(new Error(`msg ${SECRET}`), { name: `${SECRET}\nforged`, code: `${FIXTURE_URI}\n` });
    assert.equal(safeErrorTag(e), "Error");
  });

  it("redacted listener logs only the sanitized tag, never message/hostile fields", () => {
    const lines = [];
    const err = Object.assign(new Error(`querySrv ENOTFOUND ${FIXTURE_URI} ${SECRET}`), {
      name: `X ${SECRET}\nforged`,
      code: `${SECRET}\r\n`,
    });
    logConnectionError(err, { redactErrors: true, log: (...a) => lines.push(a.join(" ")) });
    assert.deepEqual(lines, ["[db] MongoDB connection error: Error"]);
    const ok = Object.assign(new Error("secret host cluster.example.invalid"), { name: "MongoServerSelectionError", code: "ENOTFOUND" });
    logConnectionError(ok, { redactErrors: true, log: (...a) => lines.push(a.join(" ")) });
    assert.equal(lines[1], "[db] MongoDB connection error: MongoServerSelectionError (code ENOTFOUND)");
    assert.ok(!lines.join("\n").includes("example.invalid"));
  });

  it("non-redacted (application runtime) behaviour is unchanged: message is logged", () => {
    const lines = [];
    logConnectionError(new Error("plain message"), { log: (...a) => lines.push(a.join(" ")) });
    assert.deepEqual(lines, ["[db] MongoDB connection error: plain message"]);
  });
});

describe("promptHidden: real process signal outcome", { skip: process.platform === "win32" }, () => {
  const CHILD = `
    import { PassThrough } from "node:stream";
    import { promptHidden } from ${JSON.stringify(new URL("../scripts/secret-prompt.js", import.meta.url).href)};
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = (m) => { process.stdout.write("raw:" + m + "\\n"); input.isRaw = m; };
    promptHidden("P: ", { input, output: { write() {} } }).catch(() => process.stdout.write("rejected\\n"));
    setInterval(() => {}, 1000);
    process.stdout.write("ready\\n");
  `;
  for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"]) {
    it(`${sig} restores raw mode and the process still terminates by ${sig}`, async () => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let sent = false;
      child.stdout.on("data", (d) => {
        out += d;
        if (!sent && out.includes("ready")) {
          sent = true;
          child.kill(sig);
        }
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      const [code, signal] = await new Promise((r) => child.on("close", (c, s) => r([c, s])));
      clearTimeout(timer);
      assert.equal(signal, sig, `expected termination by ${sig}, got code=${code} signal=${signal}; out=${out}`);
      assert.match(out, /raw:true\n/);
      assert.match(out, /raw:false\n/);
      assert.match(out, /rejected/);
    });
  }
});

// ---------------------------------------------------------------------------
// CLI process behaviour
// ---------------------------------------------------------------------------
describe("bootstrap-admin CLI: credential handling (#110)", () => {
  const run = (envOverrides, args = []) =>
    spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      env: {
        ...process.env,
        ADMIN_BOOTSTRAP_PASSWORD: "",
        ADMIN_BOOTSTRAP_EMAIL: "",
        ADMIN_BOOTSTRAP_NAME: "",
        ...BASE_ENV,
        ...envOverrides,
      },
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 20_000,
    });

  it("refuses --password with exit 1, no database activity, and no secret in output", () => {
    const r = run({ ADMIN_PASSWORD: "" }, [`--password=${SECRET}`]);
    const all = r.stdout + r.stderr;
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--password is not supported/);
    assert.doesNotMatch(all, /\[db\]|created ADMIN|already exists/);
    assert.ok(!all.includes(SECRET));
  });

  it("without env password and without a TTY, refuses instead of reading an echoing prompt", () => {
    const r = run({ ADMIN_PASSWORD: "" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ADMIN_PASSWORD is required/);
    assert.doesNotMatch(r.stdout + r.stderr, /\[db\]/);
  });

  it("supplemental (DNS-dependent; deterministic listener proof is above): an unreachable (reserved .invalid) target fails without printing host, URI, credentials or password", () => {
    const r = run({ ADMIN_PASSWORD: SECRET });
    const all = r.stdout + r.stderr;
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unexpected failure/);
    for (const leak of [SECRET, "fixture_pass", "fixture_user", "example.invalid", "cluster."]) {
      assert.ok(!all.includes(leak), `leaked ${leak}: ${all}`);
    }
  });
});
