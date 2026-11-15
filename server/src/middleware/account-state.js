import { ACCOUNT_STATES } from "../domain/account-state.js";
import { sendError } from "../http/respond.js";
import { DomainErrorCode } from "../services/errors.js";

/**
 * Enforces the current account lifecycle state for authenticated
 * application capabilities.
 *
 * Mounted after the auth router so /auth/me, /auth/logout, and
 * /auth/refresh remain available as part of the account recovery/session
 * boundary. Domain/application routes are blocked when the current User
 * state is HARD_SUSPENDED, DELETION_PENDING, or PERMANENTLY_DELETED.
 *
 * MUTED deliberately passes through here: MUTE is a contribution
 * restriction, not an authentication/access block, and is enforced by
 * the dedicated contribution-governance issue (#174).
 */
export function accountStateMiddleware(req, res, next) {
  const state = req.accountState;

  if (
    !state ||
    state === ACCOUNT_STATES.ACTIVE ||
    state === ACCOUNT_STATES.MUTED
  ) {
    next();
    return;
  }

  const errorByState = {
    [ACCOUNT_STATES.HARD_SUSPENDED]: {
      code: DomainErrorCode.ACCOUNT_SUSPENDED,
      message: "Account access is suspended",
    },
    [ACCOUNT_STATES.DELETION_PENDING]: {
      code: DomainErrorCode.ACCOUNT_DELETION_PENDING,
      message: "Account deletion is pending",
    },
    [ACCOUNT_STATES.PERMANENTLY_DELETED]: {
      code: DomainErrorCode.ACCOUNT_PERMANENTLY_DELETED,
      message: "Account is permanently deleted",
    },
  };

  const error = errorByState[state];

  if (!error) {
    // Unknown persisted state must fail closed rather than silently
    // granting access to a value the current authorization boundary does
    // not understand.
    sendError(res, {
      code: DomainErrorCode.FORBIDDEN,
      message: "Forbidden",
    });
    return;
  }

  sendError(res, error);
}

export default accountStateMiddleware;
