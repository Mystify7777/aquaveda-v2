/**
 * Root `npm run verify` entry point (#101): runs the independent frontend and
 * backend pipelines concurrently. Each pipeline is the existing package-level
 * command, so `verify:frontend`, `verify:backend` and `verify:sequential`
 * remain available for focused or serial runs. See docs/engineering/testing.md.
 */
import { fileURLToPath } from "node:url";

import { formatSummary, runPipelines } from "./verify/run-pipelines.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// `npm run verify` sets npm_execpath; invoking npm-cli.js via this Node binary
// avoids a shell (and Windows .cmd spawning). Fallback covers direct `node` use.
const npmCli = process.env.npm_execpath;
function npmRun(script) {
  return npmCli
    ? { command: process.execPath, args: [npmCli, "run", script] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", script], shell: true };
}

const pipelines = [
  { name: "backend", cwd: root, ...npmRun("verify:backend") },
  { name: "frontend", cwd: root, ...npmRun("verify:frontend") },
];

const { done, terminate } = runPipelines(pipelines);

let signalled = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  try {
    process.on(signal, () => {
      signalled ??= signal;
      process.stderr.write(`\nverify: received ${signal}, terminating pipelines...\n`);
      terminate();
    });
  } catch {
    // SIGBREAK is unavailable on non-Windows platforms.
  }
}
// Last resort if this process exits abnormally while children are alive.
process.on("exit", () => terminate("SIGKILL"));

const summary = await done;
process.stdout.write(formatSummary(summary));
process.exitCode = signalled === "SIGTERM" ? 143 : summary.exitCode;
