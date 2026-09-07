import { z } from "zod";

/**
 * Auth request-shape validation.
 *
 * Zod's job here, exactly as in issue.validation.js: "is this request
 * shaped correctly?" — plus, for email specifically, canonicalizing it
 * (trim + lowercase) so the value that reaches the service layer is
 * already normalized. Zod does NOT own:
 * - credential correctness (service layer — password verification)
 * - email uniqueness (service + DB unique-index layer)
 * - password hashing (service layer)
 * - session/token issuance (service layer)
 *
 * Note on canonicalization living in two places: this schema
 * normalizes email so routes pass already-normalized data forward, but
 * `auth.service.js`'s `register()`/`login()` ALSO canonicalize
 * independently. That is not accidental duplication — every service
 * function in this project is called directly by tests, bypassing
 * Zod/routes entirely, so a service that only worked correctly when
 * fronted by this schema would be a real correctness gap for every
 * other caller. Both layers agree on the same transform for the same
 * reason `objectIdString`'s shape check and a service's own defensive
 * CastError handling both exist without contradicting each other.
 */

const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Registration payload.
 *
 * Password policy (decision-register.md / authentication-implementation-
 * plan.md Phase G, already locked): minimum 8 characters, a reasonable
 * maximum purely to reject pathological input (not a security control),
 * and deliberately NO composition rules (no mandatory uppercase/
 * lowercase/symbol/digit) — composition rules are widely considered
 * outdated guidance that pushes users toward predictable patterns
 * without meaningfully raising resistance to real attacks, and add
 * friction disproportionate to this project's locked security posture.
 */
export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`),
  // `.toLowerCase()` is Zod's cleanest native mechanism for this: it's a
  // plain string transform chained directly onto `.email()`'s format
  // check, applied to the already-trimmed value, with no custom
  // `.transform()`/`.refine()` boilerplate needed for something this
  // simple.
  email: z.string().trim().toLowerCase().email("must be a valid email address"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `password must be at most ${MAX_PASSWORD_LENGTH} characters`),
  // No composition `.regex()` checks here — deliberate, see header
  // comment. Do not add "must contain a symbol/digit/etc." rules
  // without a new, explicit review — this omission is a locked
  // decision, not an oversight.
});

/**
 * Login payload.
 *
 * Deliberately does NOT apply registerSchema's password length bounds.
 * A login attempt must still reach credential verification (the actual
 * hash comparison) regardless of whether the supplied password would
 * satisfy today's registration policy — a password created under an
 * older or different policy, or simply a wrong guess of any length,
 * must fail on WRONG CREDENTIALS, not on shape validation. Rejecting a
 * too-short/too-long login attempt at the schema layer would leak
 * information (a specific "your input is malformed" response) instead
 * of the deliberately generic INVALID_CREDENTIALS the service layer
 * already produces for every wrong-password case.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("must be a valid email address"),
  password: z.string().min(1, "password is required"),
});
