export const AUTH_STATUSES = [
    "initializing",
    "authenticated",
    "anonymous",
    "session-failure",
    "unavailable",
];

// Automatic recovery is intentionally short and bounded: initial request +
// two retries, with a small backoff to give a cold-starting backend time to wake.
export const AUTH_BOOTSTRAP_RETRY_DELAYS_MS = [500, 1500];

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
        if (currentUser) {
            return { status: "authenticated", user: currentUser };
        }

        try {
            const refreshedUser = await refreshSession();
            return { status: "authenticated", user: refreshedUser };
        } catch (error) {
            if (error?.kind === "network") throw error;
            if (!isExpectedRefreshRejection(error)) throw error;
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
