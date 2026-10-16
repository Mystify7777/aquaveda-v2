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
 * - Refuses to elevate existing non-admin accounts (USER, EXPERT).
 * - Idempotent: repeated runs against an existing ADMIN report unchanged without
 *   modifying passwords or emitting tokens.
 * - Zero session emission: creates no active session or JWT tokens.
 * - Secret-safe: never logs raw passwords or password hashes.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { hashPassword, verifyPassword } from "../src/services/auth-tokens.js";
import { registerSchema } from "../src/validation/auth.validation.js";

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
 * @param {{ prompt?: ((query: string) => Promise<string>) | null }} [options]
 * @returns {Promise<{ name: string, email: string, password: string, mongoUri: string }>}
 */
export async function resolveBootstrapConfig(env = process.env, argv = [], { prompt = null } = {}) {
  const flags = parseArgs(argv);

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

  // 3. Database URI validation
  const mongoUri = flags["mongo-uri"] || env.MONGO_URI;
  if (!mongoUri || typeof mongoUri !== "string" || !mongoUri.trim()) {
    throw new BootstrapRefusal("Refusing to bootstrap: MONGO_URI is missing or empty.");
  }

  // 4. Identity & Credential resolution (env vars, flags, or interactive prompt)
  let email = flags.email || env.ADMIN_EMAIL || env.ADMIN_BOOTSTRAP_EMAIL;
  let password = flags.password || env.ADMIN_PASSWORD || env.ADMIN_BOOTSTRAP_PASSWORD;
  const name = (flags.name || env.ADMIN_NAME || env.ADMIN_BOOTSTRAP_NAME || DEFAULT_ADMIN_NAME).toString().trim();

  if (!email && prompt) {
    email = (await prompt("Enter ADMIN_EMAIL: "))?.trim();
  }
  if (!password && prompt) {
    password = (await prompt("Enter ADMIN_PASSWORD: "))?.trim();
  }

  if (!email) {
    throw new BootstrapRefusal("Refusing to bootstrap: ADMIN_EMAIL is required.");
  }
  if (!password) {
    throw new BootstrapRefusal("Refusing to bootstrap: ADMIN_PASSWORD is required.");
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
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [argv]
 * @param {{
 *   connect?: (uri: string) => Promise<unknown>,
 *   bootstrap?: typeof bootstrapAdmin,
 *   prompt?: ((query: string) => Promise<string>) | null
 * }} [deps]
 */
export async function runBootstrap(
  env = process.env,
  argv = process.argv.slice(2),
  {
    connect = (uri) => connectDB({ uri }),
    bootstrap = bootstrapAdmin,
    prompt = null,
  } = {},
) {
  const config = await resolveBootstrapConfig(env, argv, { prompt });
  await connect(config.mongoUri);
  return bootstrap(config);
}

async function main() {
  const interactivePrompt = process.stdin.isTTY
    ? async (query) => {
        const rl = readline.createInterface({ input: defaultStdin, output: defaultStdout });
        try {
          return await rl.question(query);
        } finally {
          rl.close();
        }
      }
    : null;

  const result = await runBootstrap(process.env, process.argv.slice(2), {
    prompt: interactivePrompt,
  });

  if (result.outcome === "created") {
    console.log(`[bootstrap-admin] created ADMIN ${result.email}`);
  } else {
    console.log(`[bootstrap-admin] ADMIN ${result.email} already exists; nothing changed`);
    if (result.passwordMatchesConfig === false) {
      console.warn(
        "[bootstrap-admin] note: the existing password differs from supplied password " +
          "(not modified; use authorized recovery procedures if credential rotation is needed).",
      );
    }
  }
}

// Execute when invoked directly from CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main()
    .catch((error) => {
      console.error(`[bootstrap-admin] ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
