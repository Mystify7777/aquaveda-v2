import { ACCOUNT_STATES } from "./account-state.js";

/**
 * Admin directory query semantics (#181). Pure: no Mongoose, no I/O.
 * See docs/architecture/admin-directory.md.
 */

export const DIRECTORY_ROLES = Object.freeze(["USER", "EXPERT", "ADMIN"]);
export const DIRECTORY_STATES = Object.freeze(Object.values(ACCOUNT_STATES));
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build the Mongo filter. `q` is matched as an anchored, escaped prefix on
 * email (stored lowercase) and name (case-insensitive), or an exact `_id` when
 * 24-hex. Caller guarantees `q` is already trimmed and within bounds.
 */
export function buildDirectoryFilter({ role, accountState, q } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (accountState) filter.accountState = accountState;
  if (q) {
    const or = [
      { email: { $regex: `^${escapeRegex(q.toLowerCase())}` } },
      { name: { $regex: `^${escapeRegex(q)}`, $options: "i" } },
    ];
    if (OBJECT_ID_PATTERN.test(q)) or.push({ _id: q });
    filter.$or = or;
  }
  return filter;
}
