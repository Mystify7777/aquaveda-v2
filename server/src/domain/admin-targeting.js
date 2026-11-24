/**
 * Administrator targeting protection (ADR-0012 D2/D8, #255). Pure: no Mongoose,
 * no I/O. The rule depends ONLY on role and identity, never on the target's
 * account state (an ACTIVE, MUTED or HARD_SUSPENDED Admin is equally protected).
 */

export const ADMIN_ROLE = "ADMIN";

/** Client-safe `details.reason` values (also in `src/http/reasons.js`). */
export const ADMIN_TARGET_REASONS = Object.freeze({
  SELF: "SELF_TARGET_PROHIBITED",
  ADMIN: "ADMIN_TARGET_PROTECTED",
});

/**
 * Mongo filter fragment pinned into every product (non-SYSTEM) governance write.
 * A role change does not bump `accountStateVersion`, so without this pin a target
 * promoted to ADMIN between the pre-read and the write would still match. `$ne`
 * also matches documents that predate the `role` default (never an Admin).
 */
export const NOT_ADMIN_FILTER = Object.freeze({ role: { $ne: ADMIN_ROLE } });

/**
 * The reason a governance operation by `actorId` against `target` is
 * prohibited, or `null` when it is permitted. Self is evaluated first (D8).
 */
export function adminTargetingViolation({ actorId, target }) {
  if (String(target?._id) === String(actorId)) return ADMIN_TARGET_REASONS.SELF;
  if (target?.role === ADMIN_ROLE) return ADMIN_TARGET_REASONS.ADMIN;
  return null;
}
