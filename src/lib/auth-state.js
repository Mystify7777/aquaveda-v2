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
        (error.status === 401 || error.code === "REFRESH_FAILED")
    );
}

export function statusForInitializationFailure(error) {
    return error?.kind === "network" ? "unavailable" : "session-failure";
}