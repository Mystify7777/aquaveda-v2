export const AUTH_STATUSES = [
    "initializing",
    "authenticated",
    "anonymous",
    "session-failure",
    "unavailable",
    // Hard-suspended account recognized at bootstrap (#251): the session is not
    // "authenticated" for the application surface, and not anonymous either.
    "suspended",
];

// Automatic recovery is intentionally short and bounded: initial request +
// two retries, with a small backoff to give a cold-starting backend time to wake.
export const AUTH_BOOTSTRAP_RETRY_DELAYS_MS = [500, 1500];

/**
 * Account states the frontend interprets (#251). Everything else (ACTIVE, absent,
 * or a state the UI does not model yet, e.g. DELETION_PENDING) is "no restriction
 * known": the backend stays the authority and per-request codes (#248) still apply.
 */
const RESTRICTION_BY_ACCOUNT_STATE = Object.freeze({
    MUTED: "muted",
    HARD_SUSPENDED: "suspended",
});

export function restrictionForAccountState(accountState) {
    return typeof accountState === "string" &&
        Object.hasOwn(RESTRICTION_BY_ACCOUNT_STATE, accountState)
        ? RESTRICTION_BY_ACCOUNT_STATE[accountState]
        : null;
}

/** A refresh answered with the explicit suspension code (hard-suspension.md). */
export function isAccountSuspendedRejection(error) {
    return (
        error?.kind === "http" &&
        error.status === 403 &&
        error.code === "ACCOUNT_SUSPENDED"
    );
}

const SUSPENDED_RESULT = Object.freeze({ status: "suspended", user: null, restriction: "suspended" });

/** MUTED stays authenticated (read access, not logged out); HARD_SUSPENDED does not. */
export function sessionResultForUser(user) {
    const restriction = restrictionForAccountState(user?.accountState);
    if (restriction === "suspended") return { ...SUSPENDED_RESULT };
    return restriction
        ? { status: "authenticated", user, restriction }
        : { status: "authenticated", user };
}

export function isExpectedRefreshRejection(error) {
    return (
        error?.kind === "http" &&
        error.status === 401 &&
        error.code === "REFRESH_FAILED"
    );
}

export function statusForInitializationFailure(error) {
    return error?.kind === "network" ? "unavailable" : "session-failure";
}

export async function initializeAuthSession({ getCurrentUser, refreshSession }) {
    try {
        const currentUser = await getCurrentUser();
        if (currentUser) return sessionResultForUser(currentUser);

        let refreshedUser;
        try {
            refreshedUser = await refreshSession();
        } catch (error) {
            if (error?.kind === "network") throw error;
            if (isAccountSuspendedRejection(error)) return { ...SUSPENDED_RESULT };
            if (!isExpectedRefreshRejection(error)) throw error;
        }

        if (refreshedUser) {
            // /refresh does not report account state; learn it from /me. Best
            // effort: a failure here never downgrades a session that just refreshed.
            try {
                const resolved = await getCurrentUser();
                if (resolved) return sessionResultForUser(resolved);
            } catch {
                // fall through to the refreshed user
            }
            return sessionResultForUser(refreshedUser);
        }

        return { status: "anonymous", user: null };
    } catch (error) {
        return {
            status: statusForInitializationFailure(error),
            user: null,
        };
    }
}

function wait(ms, sleep) {
    return sleep(ms);
}

/**
 * Bounded retry wrapper for the existing /me + /refresh bootstrap contract.
 * Only an explicit "unavailable" result is retried; anonymous and
 * session-failure remain terminal. The final result preserves the classifier.
 */
export async function initializeAuthSessionWithRetry({
    getCurrentUser,
    refreshSession,
    retryDelays = AUTH_BOOTSTRAP_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
    let result = await initializeAuthSession({ getCurrentUser, refreshSession });

    for (const delay of retryDelays) {
        if (result.status !== "unavailable") break;
        await wait(delay, sleep);
        result = await initializeAuthSession({ getCurrentUser, refreshSession });
    }

    return result;
}
