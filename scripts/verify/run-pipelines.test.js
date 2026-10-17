import assert from "node:assert/strict";
import fs from "node:fs";
import { Writable } from "node:stream";
import { describe, it } from "node:test";

import { createLinePrefixer, formatSummary, runPipelines } from "./run-pipelines.mjs";

function sink() {
  let text = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => text };
}

const node = (name, code) => ({ name, command: process.execPath, args: ["-e", code] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True while the process can still run. A terminated-but-unreaped zombie (state Z, seen when PID 1 does not reap orphans, e.g. in containers) is dead. */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const state = fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "")[0];
    return state !== "Z" && state !== "X";
  } catch {
    return true; // no /proc (macOS/Windows): signal 0 succeeded, so it is running
  }
}

describe("createLinePrefixer", () => {
  it("prefixes whole lines, buffers partial lines, flushes the remainder", () => {
    const lines = [];
    const p = createLinePrefixer("[x] ", (s) => lines.push(s));
    p.push("a\r\nb");
    p.push("c\n\nd");
    p.flush();
    assert.deepEqual(lines, ["[x] a\n", "[x] bc\n", "[x] \n", "[x] d\n"]);
  });
});

describe("runPipelines", () => {
  it("exits 0 and attributes output when every pipeline passes", async () => {
    const out = sink();
    const err = sink();
    const { done } = runPipelines(
      [node("alpha", "console.log('hello from alpha')"), node("beta", "console.error('warn from beta')")],
      { stdout: out.stream, stderr: err.stream },
    );
    const result = await done;
    assert.equal(result.exitCode, 0);
    assert.match(out.text(), /\[alpha\] {2}hello from alpha/);
    assert.match(err.text(), /\[beta\] {3}warn from beta/);
  });

  it("fails the aggregate when one pipeline fails, yet lets the other finish", async () => {
    const out = sink();
    const { done } = runPipelines(
      [node("bad", "process.exit(3)"), node("good", "setTimeout(() => console.log('good done'), 300)")],
      { stdout: out.stream, stderr: sink().stream },
    );
    const result = await done;
    assert.equal(result.exitCode, 1);
    assert.equal(result.results.find((r) => r.name === "bad").code, 3);
    assert.equal(result.results.find((r) => r.name === "good").ok, true);
    assert.match(out.text(), /good done/);
    assert.match(formatSummary(result), /bad\s+FAIL \(exit 3\)/);
  });

  it("treats a command that cannot start as a failure", async () => {
    const err = sink();
    const { done } = runPipelines(
      [{ name: "ghost", command: "definitely-not-a-real-binary-101", args: [] }, node("ok", "0")],
      { stdout: sink().stream, stderr: err.stream },
    );
    const result = await done;
    assert.equal(result.exitCode, 1);
    assert.match(err.text(), /failed to start/);
  });

  it("runs pipelines concurrently, not serially", async () => {
    const nap = "setTimeout(() => {}, 600)";
    const { done } = runPipelines([node("a", nap), node("b", nap)], {
      stdout: sink().stream,
      stderr: sink().stream,
    });
    const result = await done;
    assert.equal(result.exitCode, 0);
    assert.ok(result.wallMs < 1100, `expected overlap, wall=${result.wallMs}ms`);
  });

  it("terminate() kills the whole process tree and reports interruption", async () => {
    const out = sink();
    // Parent spawns a grandchild (like npm -> node) and prints both pids.
    const code = `
      const { spawn } = require("node:child_process");
      const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log("PIDS " + process.pid + " " + g.pid);
      setInterval(() => {}, 1000);
    `;
    const { done, terminate } = runPipelines([node("tree", code)], {
      stdout: out.stream,
      stderr: sink().stream,
    });
    let match = null;
    for (let i = 0; i < 100 && !match; i += 1) {
      await sleep(50);
      match = /PIDS (\d+) (\d+)/.exec(out.text());
    }
    assert.ok(match, "child never reported its pids");
    const [, parentPid, grandchildPid] = match.map(Number);
    assert.ok(alive(parentPid) && alive(grandchildPid));

    terminate();
    const result = await done;
    assert.equal(result.interrupted, true);
    assert.equal(result.exitCode, 130);
    assert.match(formatSummary(result), /tree\s+TERMINATED/);
    await sleep(300);
    assert.equal(alive(parentPid), false, "pipeline process survived terminate()");
    assert.equal(alive(grandchildPid), false, "grandchild process was orphaned");
  });

  it("escalates to SIGKILL when the pipeline exits on SIGTERM but a descendant ignores it", { skip: process.platform === "win32" }, async () => {
    const out = sink();
    // Parent exits as soon as it is told to stop; the grandchild ignores SIGTERM,
    // so only escalation against the retained process group can remove it.
    const code = `
      const { spawn } = require("node:child_process");
      const g = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log("PIDS " + process.pid + " " + g.pid);
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);
    `;
    const { done, terminate } = runPipelines([node("stubborn", code)], {
      stdout: out.stream,
      stderr: sink().stream,
      killGraceMs: 400,
    });
    let match = null;
    for (let i = 0; i < 100 && !match; i += 1) {
      await sleep(50);
      match = /PIDS (\d+) (\d+)/.exec(out.text());
    }
    assert.ok(match, "child never reported its pids");
    const [, parentPid, grandchildPid] = match.map(Number);
    await sleep(150); // let the grandchild install its SIGTERM handler

    terminate();
    const result = await done;
    assert.equal(result.interrupted, true);
    assert.equal(alive(parentPid), false);
    assert.equal(alive(grandchildPid), false, "SIGTERM-ignoring descendant survived escalation");
    assert.ok(result.wallMs >= 350, `escalation should wait out the grace period, wall=${result.wallMs}ms`);
  });
});
