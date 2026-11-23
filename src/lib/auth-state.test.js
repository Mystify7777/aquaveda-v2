import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AUTH_BOOTSTRAP_RETRY_DELAYS_MS,
    AUTH_STATUSES,
    initializeAuthSession,
    initializeAuthSessionWithRetry,
    isAccountSuspendedRejection,
    isExpectedRefreshRejection,
    restrictionForAccountState,
    sessionResultForUser,
    statusForInitializationFailure,
} from "./auth-state.js";

describe("AuthProvider session-state classification", () => {
    it("keeps the five existing session states intact and adds suspended", () => {
        assert.deepEqual(AUTH_STATUSES, [
            "initializing",
            "authenticated",
            "anonymous",
            "session-failure",
            "unavailable",
            "suspended",
        ]);
    });

    it("distinguishes confirmed anonymous from session failure", () => {
        const expectedRejection = {
            kind: "http",
            status: 401,
            code: "REFRESH_FAILED",
        };

        assert.equal(isExpectedRefreshRejection(expectedRejection), true);
        assert.equal(isExpectedRefreshRejection({ kind: "http", status: 401 }), false);
        assert.equal(isExpectedRefreshRejection({ kind: "http", status: 200, code: "REFRESH_FAILED" }), false);
        assert.equal(isExpectedRefreshRejection({ kind: "http", status: 500, code: "REFRESH_FAILED" }), false);
        assert.notEqual("anonymous", "session-failure");
    });

    describe("AuthProvider bootstrap contract", () => {
        it("confirms anonymous after an anonymous /me and expected refresh rejection", async () => {
            const result = await initializeAuthSession({
                getCurrentUser: async () => null,
                refreshSession: async () => {
                    throw { kind: "http", status: 401, code: "REFRESH_FAILED" };
                },
            });
            assert.deepEqual(result, { status: "anonymous", user: null });
        });

        it("marks a /me network failure as unavailable", async () => {
            const result = await initializeAuthSession({
                getCurrentUser: async () => { throw { kind: "network" }; },
                refreshSession: async () => { throw new Error("refresh should not run"); },
            });
            assert.deepEqual(result, { status: "unavailable", user: null });
        });

        it("marks an unexpected /me API failure as session-failure", async () => {
            const result = await initializeAuthSession({
                getCurrentUser: async () => { throw { kind: "http", status: 500, code: "INTERNAL_ERROR" }; },
                refreshSession: async () => { throw new Error("refresh should not run"); },
            });
            assert.deepEqual(result, { status: "session-failure", user: null });
        });

        it("marks a /refresh network failure as unavailable", async () => {
            const result = await initializeAuthSession({
                getCurrentUser: async () => null,
                refreshSession: async () => { throw { kind: "network" }; },
            });
            assert.deepEqual(result, { status: "unavailable", user: null });
        });

        it("marks an unexpected /refresh API failure as session-failure", async () => {
            const result = await initializeAuthSession({
                getCurrentUser: async () => null,
                refreshSession: async () => { throw { kind: "http", status: 401, code: "OTHER_FAILURE" }; },
            });
            assert.deepEqual(result, { status: "session-failure", user: null });
        });
    });

    it("distinguishes session failure from network unavailability", () => {
        assert.equal(statusForInitializationFailure({ kind: "response" }), "session-failure");
        assert.equal(statusForInitializationFailure({ kind: "network" }), "unavailable");
        assert.notEqual(statusForInitializationFailure({ kind: "response" }), statusForInitializationFailure({ kind: "network" }));
    });

    it("never classifies a network/backend failure as anonymous", () => {
        assert.equal(isExpectedRefreshRejection({ kind: "network" }), false);
        assert.notEqual(statusForInitializationFailure({ kind: "network" }), "anonymous");
    });
});

describe("initializeAuthSessionWithRetry", () => {
    it("recovers when the backend becomes available during the retry window", async () => {
        let attempts = 0;
        const delays = [];
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser: async () => {
                attempts += 1;
                if (attempts < 3) throw { kind: "network" };
                return { id: "u1", role: "USER" };
            },
            refreshSession: async () => { throw new Error("refresh should not run"); },
            sleep: async (ms) => { delays.push(ms); },
        });

        assert.deepEqual(result, { status: "authenticated", user: { id: "u1", role: "USER" } });
        assert.equal(attempts, 3);
        assert.deepEqual(delays, AUTH_BOOTSTRAP_RETRY_DELAYS_MS);
    });

    it("stops after the configured retries and preserves unavailable", async () => {
        let attempts = 0;
        const delays = [];
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser: async () => { attempts += 1; throw { kind: "network" }; },
            refreshSession: async () => { throw new Error("refresh should not run"); },
            sleep: async (ms) => { delays.push(ms); },
        });

        assert.deepEqual(result, { status: "unavailable", user: null });
        assert.equal(attempts, AUTH_BOOTSTRAP_RETRY_DELAYS_MS.length + 1);
        assert.deepEqual(delays, AUTH_BOOTSTRAP_RETRY_DELAYS_MS);
    });

    it("does not retry an expected anonymous session", async () => {
        let meCalls = 0, refreshCalls = 0, sleeps = 0;
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser: async () => { meCalls += 1; return null; },
            refreshSession: async () => {
                refreshCalls += 1;
                throw { kind: "http", status: 401, code: "REFRESH_FAILED" };
            },
            sleep: async () => { sleeps += 1; },
        });

        assert.deepEqual(result, { status: "anonymous", user: null });
        assert.equal(meCalls, 1);
        assert.equal(refreshCalls, 1);
        assert.equal(sleeps, 0);
    });

    it("does not retry definitive authentication/session failures", async () => {
        let attempts = 0, sleeps = 0;
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser: async () => {
                attempts += 1;
                throw { kind: "http", status: 401, code: "UNAUTHORIZED" };
            },
            refreshSession: async () => { throw new Error("refresh should not run"); },
            sleep: async () => { sleeps += 1; },
        });

        assert.deepEqual(result, { status: "session-failure", user: null });
        assert.equal(attempts, 1);
        assert.equal(sleeps, 0);
    });

    it("keeps explicit backoff short and bounded", () => {
        assert.deepEqual(AUTH_BOOTSTRAP_RETRY_DELAYS_MS, [500, 1500]);
    });
});

describe("bootstrap account state (#251)", () => {
    const user = (accountState) => ({ id: "u1", role: "USER", ...(accountState ? { accountState } : {}) });
    const never = async () => { throw new Error("must not be called"); };
    const refreshFails = (error) => async () => { throw error; };

    it("restrictionForAccountState interprets only MUTED and HARD_SUSPENDED", () => {
        assert.equal(restrictionForAccountState("MUTED"), "muted");
        assert.equal(restrictionForAccountState("HARD_SUSPENDED"), "suspended");
        for (const other of ["ACTIVE", "DELETION_PENDING", "PERMANENTLY_DELETED", "muted", "", "toString", "__proto__", undefined, null, 7, {}]) {
            assert.equal(restrictionForAccountState(other), null, String(other));
        }
    });

    it("ACTIVE and absent state: authenticated, result shape unchanged", async () => {
        for (const u of [user("ACTIVE"), user()]) {
            assert.deepEqual(await initializeAuthSession({ getCurrentUser: async () => u, refreshSession: never }), {
                status: "authenticated",
                user: u,
            });
        }
    });

    it("MUTED: stays authenticated with its user (not logged out) and carries the restriction", async () => {
        const u = user("MUTED");
        assert.deepEqual(await initializeAuthSession({ getCurrentUser: async () => u, refreshSession: never }), {
            status: "authenticated",
            user: u,
            restriction: "muted",
        });
    });

    it("HARD_SUSPENDED from /me: status suspended and NO user (never enters the authenticated surface)", async () => {
        assert.deepEqual(
            await initializeAuthSession({ getCurrentUser: async () => user("HARD_SUSPENDED"), refreshSession: never }),
            { status: "suspended", user: null, restriction: "suspended" },
        );
    });

    it("anonymous (no user, refresh rejected as expected) stays anonymous", async () => {
        const result = await initializeAuthSession({
            getCurrentUser: async () => null,
            refreshSession: refreshFails({ kind: "http", status: 401, code: "REFRESH_FAILED" }),
        });
        assert.deepEqual(result, { status: "anonymous", user: null });
    });

    it("refresh answering ACCOUNT_SUSPENDED is recognized as suspended; other 403s keep session-failure", async () => {
        const suspended = { kind: "http", status: 403, code: "ACCOUNT_SUSPENDED" };
        assert.equal(isAccountSuspendedRejection(suspended), true);
        assert.equal(isAccountSuspendedRejection({ kind: "http", status: 403, code: "FORBIDDEN" }), false);
        assert.equal(isAccountSuspendedRejection({ kind: "http", status: 401, code: "ACCOUNT_SUSPENDED" }), false);
        assert.equal(isAccountSuspendedRejection({ kind: "network", status: 403, code: "ACCOUNT_SUSPENDED" }), false);
        assert.deepEqual(
            await initializeAuthSession({ getCurrentUser: async () => null, refreshSession: refreshFails(suspended) }),
            { status: "suspended", user: null, restriction: "suspended" },
        );
        assert.deepEqual(
            await initializeAuthSession({
                getCurrentUser: async () => null,
                refreshSession: refreshFails({ kind: "http", status: 403, code: "FORBIDDEN" }),
            }),
            { status: "session-failure", user: null },
        );
    });

    it("refreshed session: state is learned from /me (muted, suspended); /me failure never downgrades it", async () => {
        const refreshed = user();
        let calls = 0;
        const me = (impl) => async () => { calls += 1; return calls === 1 ? null : impl(); };
        assert.deepEqual(
            await initializeAuthSession({ getCurrentUser: me(async () => user("MUTED")), refreshSession: async () => refreshed }),
            { status: "authenticated", user: user("MUTED"), restriction: "muted" },
        );
        calls = 0;
        assert.deepEqual(
            await initializeAuthSession({ getCurrentUser: me(async () => user("HARD_SUSPENDED")), refreshSession: async () => refreshed }),
            { status: "suspended", user: null, restriction: "suspended" },
        );
        for (const failure of [{ kind: "network" }, { kind: "http", status: 500 }]) {
            calls = 0;
            assert.deepEqual(
                await initializeAuthSession({ getCurrentUser: me(async () => { throw failure; }), refreshSession: async () => refreshed }),
                { status: "authenticated", user: refreshed },
            );
        }
        calls = 0;
        assert.deepEqual(
            await initializeAuthSession({ getCurrentUser: me(async () => null), refreshSession: async () => refreshed }),
            { status: "authenticated", user: refreshed },
        );
    });

    it("failure classification is unchanged: network -> unavailable (retried), other -> session-failure", async () => {
        assert.equal((await initializeAuthSession({ getCurrentUser: async () => { throw { kind: "network" }; }, refreshSession: never })).status, "unavailable");
        assert.equal((await initializeAuthSession({ getCurrentUser: async () => { throw { kind: "http", status: 500 }; }, refreshSession: never })).status, "session-failure");
        let attempts = 0;
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser: async () => { attempts += 1; if (attempts < 3) throw { kind: "network" }; return user("HARD_SUSPENDED"); },
            refreshSession: never,
            sleep: async () => {},
        });
        assert.equal(attempts, 3);
        assert.equal(result.status, "suspended");
    });

    it("sessionResultForUser mirrors the bootstrap mapping", () => {
        assert.equal(sessionResultForUser(user("HARD_SUSPENDED")).user, null);
        assert.equal(sessionResultForUser(user("MUTED")).status, "authenticated");
    });
});
