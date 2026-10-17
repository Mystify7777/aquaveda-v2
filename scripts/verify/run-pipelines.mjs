/**
 * Concurrent pipeline runner for root `npm run verify` (#101).
 *
 * Dependency-free and platform-neutral: no shell strings, no POSIX-only
 * utilities. Each pipeline is one child process; output is line-prefixed
 * with the pipeline name; every pipeline runs to completion (no fail-fast)
 * so a single run reports every failing pipeline; the aggregate exit code is
 * non-zero if ANY pipeline fails to start, exits non-zero, or is killed.
 */
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_KILL_GRACE_MS = 5000;

/** Prefixes complete lines; buffers a trailing partial line until flushed. */
export function createLinePrefixer(prefix, write) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) write(`${prefix}${line}\n`);
    },
    flush() {
      if (pending) write(`${prefix}${pending}\n`);
      pending = "";
    },
  };
}

/**
 * Signals a pipeline's whole process tree by its retained group id. The id is
 * kept after the group leader exits: a descendant can outlive its parent, and
 * on POSIX a pgid stays valid (and un-reusable) while any member is alive.
 * On Windows `taskkill /T` walks the tree from a live parent, so a descendant
 * orphaned after its parent already exited cannot be located (platform limit).
 */
function killGroup(pid, signal) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pid, signal); // negative pid = the process group
    }
  } catch {
    // Group already empty; nothing to signal.
  }
}

function groupAlive(pid) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ name: string, command: string, args?: string[], cwd?: string }[]} pipelines
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv, killGraceMs?: number }} [options]
 * @returns {{ done: Promise<{ exitCode: number, wallMs: number, results: object[] }>, terminate: (signal?: string) => void }}
 */
export function runPipelines(pipelines, options = {}) {
  const out = options.stdout ?? process.stdout;
  const err = options.stderr ?? process.stderr;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const baseEnv = { ...(options.env ?? process.env) };
  if (out.isTTY && !("NO_COLOR" in baseEnv) && !("FORCE_COLOR" in baseEnv)) baseEnv.FORCE_COLOR = "1";

  const width = Math.max(...pipelines.map((p) => p.name.length));
  const started = Date.now();
  const groupIds = []; // retained independently of child exit state
  let interrupted = false;
  let deadline = 0;

  const runs = pipelines.map((pipeline) => {
    const prefix = `[${pipeline.name}]`.padEnd(width + 3) + " ";
    const outLines = createLinePrefixer(prefix, (s) => out.write(s));
    const errLines = createLinePrefixer(prefix, (s) => err.write(s));
    const t0 = Date.now();

    return new Promise((resolve) => {
      const finish = (result) => {
        outLines.flush();
        errLines.flush();
        resolve({ name: pipeline.name, durationMs: Date.now() - t0, ...result });
      };
      let child;
      try {
        child = spawn(pipeline.command, pipeline.args ?? [], {
          cwd: pipeline.cwd,
          shell: pipeline.shell ?? false,
          env: baseEnv,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32", // own process group, so the tree is killable
          windowsHide: true,
        });
      } catch (error) {
        err.write(`${prefix}failed to start: ${error.message}\n`);
        finish({ code: 1, signal: null, ok: false });
        return;
      }
      if (child.pid) groupIds.push(child.pid);
      child.stdout.setEncoding("utf8").on("data", (d) => outLines.push(d));
      child.stderr.setEncoding("utf8").on("data", (d) => errLines.push(d));
      child.once("error", (error) => {
        err.write(`${prefix}failed to start: ${error.message}\n`);
        finish({ code: 1, signal: null, ok: false });
      });
      child.once("close", (code, signal) => {
        finish({ code, signal, ok: code === 0 && signal === null });
      });
    });
  });

  function terminate(signal = "SIGTERM") {
    if (interrupted) return;
    interrupted = true;
    deadline = Date.now() + killGraceMs;
    for (const pid of groupIds) killGroup(pid, signal);
  }

  /**
   * After an interrupt, do not report completion until every group is empty:
   * a descendant may ignore the polite signal and outlive its parent, so
   * escalate to SIGKILL against the retained group ids at the deadline.
   */
  async function settleGroups() {
    while (groupIds.some(groupAlive) && Date.now() < deadline) await sleep(50);
    const survivors = groupIds.filter(groupAlive);
    if (survivors.length === 0) return;
    for (const pid of survivors) killGroup(pid, "SIGKILL");
    const hardStop = Date.now() + 1000;
    while (groupIds.some(groupAlive) && Date.now() < hardStop) await sleep(25);
  }

  const done = Promise.all(runs).then(async (results) => {
    if (interrupted) await settleGroups();
    const failed = results.some((r) => !r.ok);
    return {
      exitCode: interrupted ? 130 : failed ? 1 : 0,
      interrupted,
      wallMs: Date.now() - started,
      results,
    };
  });

  return { done, terminate };
}

export function formatSummary({ results, wallMs, interrupted }) {
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const lines = ["", interrupted ? "verify: interrupted" : "verify: summary"];
  for (const r of results) {
    // Under an interrupt a pipeline never "failed": it was terminated (on Windows
    // taskkill /F surfaces as exit 1), so say that instead of a misleading FAIL.
    const status = r.ok
      ? "PASS"
      : interrupted
        ? "TERMINATED"
        : `FAIL (${r.signal ? `signal ${r.signal}` : `exit ${r.code}`})`;
    lines.push(`  ${r.name.padEnd(10)} ${status.padEnd(22)} ${secs(r.durationMs)}`);
  }
  lines.push(`  ${"wall".padEnd(10)} ${"".padEnd(22)} ${secs(wallMs)}`);
  return lines.join("\n") + "\n";
}
