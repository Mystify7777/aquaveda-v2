/**
 * Local ADMIN provisioning (#89) — library half. Development-only.
 *
 * `resolveProvisioningConfig(env)` is pure (no DB) and is the ONLY producer
 * of a config accepted by `provisionAdmin`. It fails closed unless ALL of:
 *   - NODE_ENV is not "production";
 *   - ALLOW_DEV_ADMIN_PROVISIONING === "true" (explicit local opt-in);
 *   - MONGO_URI is a loopback host AND a database ending `_dev`
 *     (local-db-guard.js — NODE_ENV alone is never treated as proof);
 *   - the bootstrap identity passes the same Zod rules as registration.
 *
 * `provisionAdmin(config)` provisions exactly ONE explicit identity
 * (ADMIN_BOOTSTRAP_EMAIL). It never elevates an existing non-ADMIN account
 * and never overwrites an existing account's password. It is not reachable
 * over HTTP and is not imported by anything under src/.
 */
import { User } from "../src/models/User.js";
import { hashPassword, verifyPassword } from "../src/services/auth-tokens.js";
import { registerSchema } from "../src/validation/auth.validation.js";
import { assertLocalDatabase } from "./local-db-guard.js";

const DEFAULT_NAME = "Local Admin";

export class ProvisioningRefusal extends Error {}

export function resolveProvisioningConfig(env) {
  if (env.NODE_ENV === "production") {
    throw new ProvisioningRefusal("Refusing to provision: NODE_ENV is production.");
  }
  if (env.ALLOW_DEV_ADMIN_PROVISIONING !== "true") {
    throw new ProvisioningRefusal(
      'Refusing to provision: set ALLOW_DEV_ADMIN_PROVISIONING=true to explicitly opt in (local development only).',
    );
  }
  assertLocalDatabase(env.DEV_MONGO_URI, {
    suffix: "_dev",
    action: "provision",
    subject: "Admin provisioning",
  });

  const parsed = registerSchema.safeParse({
    name: env.ADMIN_BOOTSTRAP_NAME?.trim() || DEFAULT_NAME,
    email: env.ADMIN_BOOTSTRAP_EMAIL,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  if (!parsed.success) {
    // Field names and rule messages only — never echo submitted values.
    const label = { email: "ADMIN_BOOTSTRAP_EMAIL", password: "ADMIN_BOOTSTRAP_PASSWORD", name: "ADMIN_BOOTSTRAP_NAME" };
    const problems = parsed.error.issues
      .map((i) => `${label[i.path[0]] ?? i.path[0]}: ${i.message}`)
      .join("; ");
    throw new ProvisioningRefusal(`Refusing to provision: invalid bootstrap configuration (${problems}).`);
  }
  return Object.freeze({ ...parsed.data });
}

/**
 * @returns {{ outcome: "created" | "unchanged", email: string, passwordMatchesConfig?: boolean }}
 * @throws {ProvisioningRefusal} when the email belongs to a non-ADMIN account.
 */
export async function provisionAdmin({ name, email, password }) {
  const existing = await User.findOne({ email }).select("+passwordHash");
  if (existing) return describeExisting(existing, password);

  const passwordHash = await hashPassword(password);
  try {
    await User.create({ name, email, passwordHash, role: "ADMIN" });
  } catch (err) {
    // Lost a race with a concurrent run: the unique index decides; re-read.
    if (err?.code === 11000) {
      const winner = await User.findOne({ email }).select("+passwordHash");
      if (winner) return describeExisting(winner, password);
    }
    throw err;
  }
  return { outcome: "created", email };
}

async function describeExisting(user, password) {
  if (user.role !== "ADMIN") {
    throw new ProvisioningRefusal(
      `Refusing to provision: ${user.email} already exists with role ${user.role}. ` +
        "Existing accounts are never elevated by this tool; use a different ADMIN_BOOTSTRAP_EMAIL.",
    );
  }
  return {
    outcome: "unchanged",
    email: user.email,
    // Reported, never applied: an existing password is not overwritten.
    passwordMatchesConfig: await verifyPassword(password, user.passwordHash),
  };
}
