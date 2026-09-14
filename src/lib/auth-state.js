export const AUTH_STATUSES = [
    "initializing",
    "authenticated",
    "anonymous",
    "session-failure",
    "unavailable",
];

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