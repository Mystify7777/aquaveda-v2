/**
 * Production ADMIN bootstrap CLI (#102).
 *
 * Operational tool for securely establishing the initial administrator account
 * in a production environment. Unlike `provision-admin.js` (#89, development-only),
 * this tool operates strictly on production targets and requires explicit operator
 * confirmation.
 *
 * Security & Guardrails:
 * - Requires explicit production target (NODE_ENV=production or --target-env=production).
 * - Requires manual string confirmation (CONFIRM-PRODUCTION-BOOTSTRAP).
 * - Requires an independently supplied expected database name (--expect-db /
 *   BOOTSTRAP_EXPECTED_DB) that exactly matches the MONGO_URI database, is not a
 *   dev/test/E2E/system name, and a TLS-capable, non-loopback URI (#109). All of
 *   this is checked before any connection is attempted. See bootstrap-target.js.
 * - Refuses to elevate existing non-admin accounts (USER, EXPERT).
 * - Idempotent: repeated runs against an existing ADMIN report unchanged without
 *   modifying passwords or emitting tokens.
 * - Zero session emission: creates no active session or JWT tokens.
 * - Secret-safe (#110): the ADMIN password is accepted only from deployment secret
 *   injection (ADMIN_PASSWORD env) or a hidden, no-echo interactive prompt entered
 *   twice. A plaintext `--password` CLI argument is refused (it is visible in
 *   process listings and shell history). Unexpected failures print only an error
 *   name/code, never driver messages that may embed connection details.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { hashPassword, verifyPassword } from "../src/services/auth-tokens.js";
import { registerSchema } from "../src/validation/auth.validation.js";
import { TargetValidationError, validateBootstrapTarget } from "./bootstrap-target.js";
import { safeErrorTag } from "../src/config/safe-error.js";
import { PromptAborted, promptHidden } from "./secret-prompt.js";

export const REQUIRED_CONFIRMATION = "CONFIRM-PRODUCTION-BOOTSTRAP";
export const DEFAULT_ADMIN_NAME = "Production Admin";

export class BootstrapRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "BootstrapRefusal";
  }
}

/**
 * Parses CLI flags in the format --key=value or --key value or --flag.
 *
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv = []) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    }
  }
  return flags;
}

/**
 * Resolves and validates bootstrap configuration. Pure validation: fails closed
 * before any database connection attempt.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @param {{
 *   prompt?: ((query: string) => Promise<string>) | null,
 *   promptSecret?: ((query: string) => Promise<string>) | null
 * }} [options] `prompt` is for non-secret values only; the password is only ever
 *   requested through `promptSecret` (hidden input).
 * @returns {Promise<{ name: string, email: string, password: string, mongoUri: string }>}
 */
export async function resolveBootstrapConfig(
  env = process.env,
  argv = [],
  { prompt = null, promptSecret = null } = {},
) {
  const flags = parseArgs(argv);

  // 0. Plaintext password arguments are not supported (#110). Checked first and
  // regardless of any other input, so a supplied secret is never processed.
  if (Object.hasOwn(flags, "password")) {
    throw new BootstrapRefusal(
      "Refusing to bootstrap: --password is not supported because command-line arguments are " +
        "visible in process listings and shell history. Provide ADMIN_PASSWORD through deployment " +
        "secret injection, or omit it to enter it at the hidden interactive prompt.",
    );
  }

  // 1. Environment check: require explicit production intent
  const targetEnv = flags["target-env"] || env.TARGET_ENV || env.NODE_ENV;
  if (targetEnv !== "production") {
    throw new BootstrapRefusal(
      `Refusing to bootstrap: target environment must be "production" (got "${targetEnv || "undefined"}"). ` +
        'Set NODE_ENV=production or pass --target-env=production.',
    );
  }

  // 2. Manual confirmation check
  let confirmation = flags.confirm || env.CONFIRM_PRODUCTION_BOOTSTRAP;
  if (!confirmation && prompt) {
    confirmation = (await prompt(`Type '${REQUIRED_CONFIRMATION}' to confirm production bootstrap: `))?.trim();
  }
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new BootstrapRefusal(
      `Refusing to bootstrap: explicit confirmation required. Expected "${REQUIRED_CONFIRMATION}".`,
    );
  }

  // 3. Database target validation (#109). Independent of NODE_ENV, the
  // production-intent flag and the confirmation above: it only looks at the URI
  // and the separately supplied expected database name. For BOTH `--mongo-uri`
  // and `--expect-db`, a flag that was supplied but is empty or bare (boolean)
  // is passed through and refused; it never silently falls back to the
  // environment variable. The environment is consulted only when the flag is
  // genuinely absent, so the value validated is always the one the operator chose.
  const rawMongoUri = flags["mongo-uri"] !== undefined ? flags["mongo-uri"] : env.MONGO_URI;
  if (!rawMongoUri || typeof rawMongoUri !== "string" || !rawMongoUri.trim()) {
    throw new BootstrapRefusal("Refusing to bootstrap: MONGO_URI is missing or empty.");
  }
  const expectedDb = flags["expect-db"] !== undefined ? flags["expect-db"] : env.BOOTSTRAP_EXPECTED_DB;
  let target;
  try {
    target = validateBootstrapTarget({ uri: rawMongoUri, expectedDb });
  } catch (error) {
    if (error instanceof TargetValidationError) {
      throw new BootstrapRefusal(`Refusing to bootstrap: ${error.message}`);
    }
    throw error;
  }
  // The exact validated string; never a normalised or re-derived copy.
  const mongoUri = target.uri;

  // 4. Identity & Credential resolution (env vars, flags, or interactive prompt)
  let email = flags.email || env.ADMIN_EMAIL || env.ADMIN_BOOTSTRAP_EMAIL;
  let password = env.ADMIN_PASSWORD || env.ADMIN_BOOTSTRAP_PASSWORD;
  const name = (flags.name || env.ADMIN_NAME || env.ADMIN_BOOTSTRAP_NAME || DEFAULT_ADMIN_NAME).toString().trim();

  if (!email && prompt) {
    email = (await prompt("Enter ADMIN_EMAIL: "))?.trim();
  }
  if (!password && promptSecret) {
    // Entered twice: bootstrap is create-once and never rotates, so a typo here
    // would permanently lock in an unknown password.
    password = await promptSecret("Enter ADMIN_PASSWORD (input hidden): ");
    const confirmation = await promptSecret("Confirm ADMIN_PASSWORD (input hidden): ");
    if (password !== confirmation) {
      throw new BootstrapRefusal("Refusing to bootstrap: the two ADMIN_PASSWORD entries did not match.");
    }
  }

  if (!email) {
    throw new BootstrapRefusal("Refusing to bootstrap: ADMIN_EMAIL is required.");
  }
  if (!password) {
    throw new BootstrapRefusal(
      "Refusing to bootstrap: ADMIN_PASSWORD is required (set it via secret injection, or run in an interactive terminal).",
    );
  }

  // 5. Schema validation via standard registration rules
  const parsed = registerSchema.safeParse({
    name,
    email,
    password,
  });

  if (!parsed.success) {
    const label = { email: "ADMIN_EMAIL", password: "ADMIN_PASSWORD", name: "ADMIN_NAME" };
    const problems = parsed.error.issues
      .map((i) => `${label[i.path[0]] ?? i.path[0]}: ${i.message}`)
      .join("; ");
    throw new BootstrapRefusal(`Refusing to bootstrap: invalid bootstrap configuration (${problems}).`);
  }

  return Object.freeze({
    ...parsed.data,
    mongoUri,
  });
}

/**
 * Provisions the ADMIN account against the database with strict role boundaries.
 *
 * @param {{ name: string, email: string, password: string }} config
 * @returns {Promise<{ outcome: "created" | "unchanged", email: string, passwordMatchesConfig?: boolean }>}
 */
export async function bootstrapAdmin({ name, email, password }) {
  const existing = await User.findOne({ email }).select("+passwordHash");
  if (existing) {
    return describeExisting(existing, password);
  }

  const passwordHash = await hashPassword(password);
  try {
    await User.create({ name, email, passwordHash, role: "ADMIN" });
  } catch (err) {
    // Handle potential concurrency race on the unique email index
    if (err?.code === 11000) {
      const winner = await User.findOne({ email }).select("+passwordHash");
      if (winner) return describeExisting(winner, password);
    }
    throw err;
  }

  return { outcome: "created", email };
}

/**
 * Handles existing accounts: refuses promotion of non-admin roles; reports idempotency for admin.
 */
async function describeExisting(user, password) {
  if (user.role !== "ADMIN") {
    throw new BootstrapRefusal(
      `Refusing to bootstrap: ${user.email} already exists with role ${user.role}. ` +
        "Existing accounts are never elevated by this tool.",
    );
  }

  return {
    outcome: "unchanged",
    email: user.email,
    passwordMatchesConfig: await verifyPassword(password, user.passwordHash),
  };
}

/**
 * Coordinates configuration resolution, database connection, and execution.
 * `connect` is only reached after the target has been fully validated, and it
 * receives exactly the validated URI string.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [argv]
 * @param {{
 *   connect?: (uri: string) => Promise<unknown>,
 *   bootstrap?: typeof bootstrapAdmin,
 *   prompt?: ((query: string) => Promise<string>) | null,
 *   promptSecret?: ((query: string) => Promise<string>) | null
 * }} [deps]
 */
export async function runBootstrap(
  env = process.env,
  argv = process.argv.slice(2),
  {
    connect = (uri) => connectDB({ uri, redactErrors: true }),
    bootstrap = bootstrapAdmin,
    prompt = null,
    promptSecret = null,
  } = {},
) {
  const config = await resolveBootstrapConfig(env, argv, { prompt, promptSecret });
  await connect(config.mongoUri);
  return bootstrap(config);
}

/**
 * Operator-facing failure text. Messages of BootstrapRefusal are written by this
 * tool; PromptAborted messages are fixed strings. Anything else (driver, DNS,
 * library errors) may embed hosts, URIs or credentials, so only a strictly
 * sanitized name/code tag is shown (see safe-error.js).
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeFailure(error) {
  if (error instanceof BootstrapRefusal || error instanceof PromptAborted) {
    return error.message;
  }
  return `unexpected failure: ${safeErrorTag(error)}. Details are withheld to avoid disclosing credentials or connection details.`;
}

/**
 * Prints the operator-facing outcome of a successful bootstrap.
 */
function reportOutcome(result, { log, warn }) {
  if (result.outcome === "created") {
    log(`[bootstrap-admin] created ADMIN ${result.email}`);
  } else {
    log(`[bootstrap-admin] ADMIN ${result.email} already exists; nothing changed`);
    if (result.passwordMatchesConfig === false) {
      warn(
        "[bootstrap-admin] note: the existing password differs from supplied password " +
          "(not modified; use authorized recovery procedures if credential rotation is needed).",
      );
    }
  }
}

/**
 * Full CLI orchestration (#111): resolve config -> connect -> bootstrap/report
 * -> cleanup, returning the process exit code instead of touching `process`.
 *
 * Contract:
 * - Cleanup (`disconnect`) is attempted and AWAITED exactly once whenever a
 *   connection attempt was started, on success and on every failure path
 *   (including a rejected or throwing `connect`). It is not called when the
 *   run was refused before any connection attempt (nothing to clean up).
 * - Cleanup never throws out of here and never replaces the primary error:
 *   the primary failure is reported first, a cleanup failure is reported as an
 *   additional line.
 * - A cleanup failure after a successful operation exits non-zero (the account
 *   operation itself is committed and idempotent; the message says so).
 * - Every failure line goes through `describeFailure` (no raw driver text).
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   argv?: string[],
 *   deps?: {
 *     connect?: (uri: string) => Promise<unknown>,
 *     bootstrap?: typeof bootstrapAdmin,
 *     prompt?: ((query: string) => Promise<string>) | null,
 *     promptSecret?: ((query: string) => Promise<string>) | null,
 *     disconnect?: () => Promise<unknown>,
 *   },
 *   log?: (line: string) => void,
 *   warn?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} [options]
 * @returns {Promise<0 | 1>}
 */
export async function runCli({
  env = process.env,
  argv = process.argv.slice(2),
  deps = {},
  log = console.log,
  warn = console.warn,
  error = console.error,
} = {}) {
  const {
    connect = (uri) => connectDB({ uri, redactErrors: true }),
    bootstrap = bootstrapAdmin,
    prompt = null,
    promptSecret = null,
    disconnect = disconnectDB,
  } = deps;

  let connectAttempted = false;
  let primaryFailed = false;

  try {
    const result = await runBootstrap(env, argv, {
      connect: (uri) => {
        connectAttempted = true;
        return connect(uri);
      },
      bootstrap,
      prompt,
      promptSecret,
    });
    reportOutcome(result, { log, warn });
  } catch (primary) {
    primaryFailed = true;
    error(`[bootstrap-admin] ${describeFailure(primary)}`);
  }

  let cleanupFailed = false;
  if (connectAttempted) {
    try {
      await disconnect();
    } catch (cleanup) {
      cleanupFailed = true;
      error(
        primaryFailed
          ? `[bootstrap-admin] cleanup also failed: ${describeFailure(cleanup)}`
          : `[bootstrap-admin] bootstrap completed, but cleanup failed: ${describeFailure(cleanup)} ` +
              "The account operation was not rolled back and is safe to re-run.",
      );
    }
  }

  return primaryFailed || cleanupFailed ? 1 : 0;
}

/**
 * Process entry point: wires real TTY prompts (unless overridden) and maps the
 * orchestration result to `process.exitCode`.
 *
 * @param {Parameters<typeof runCli>[0]} [options]
 */
export async function main(options = {}) {
  const tty = Boolean(process.stdin.isTTY);
  const interactivePrompt = tty
    ? async (query) => {
        const rl = readline.createInterface({ input: defaultStdin, output: defaultStdout });
        try {
          return await rl.question(query);
        } finally {
          rl.close();
        }
      }
    : null;
  const interactiveSecretPrompt = tty
    ? (query) => promptHidden(query, { input: defaultStdin, output: defaultStdout })
    : null;

  process.exitCode = await runCli({
    ...options,
    deps: { prompt: interactivePrompt, promptSecret: interactiveSecretPrompt, ...options.deps },
  });
}

// Execute when invoked directly from CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  // Backstop for wiring failures outside runCli; cleanup lives inside runCli.
  main().catch((error) => {
    console.error(`[bootstrap-admin] ${describeFailure(error)}`);
    process.exitCode = 1;
  });
}
