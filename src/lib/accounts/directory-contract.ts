/**
 * Frontend view of the Admin directory query contract (#181, used by #250).
 *
 * The backend domain module is the single source of truth for the roles, states
 * and `q` bounds; this file only re-exports it (typed) so the cross-package
 * import path lives in one place, the same boundary pattern as
 * `src/lib/issues/discovery-contract.ts`. The backend module is pure. Do not
 * re-implement or copy these rules anywhere in `src/`.
 */
import {
  DIRECTORY_ROLES,
  DIRECTORY_STATES,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from "../../../server/src/domain/account-directory.js";

export { DIRECTORY_ROLES, DIRECTORY_STATES, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH };
