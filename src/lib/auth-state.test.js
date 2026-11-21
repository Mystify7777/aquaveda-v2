import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AUTH_BOOTSTRAP_RETRY_DELAYS_MS,
    AUTH_STATUSES,
    initializeAuthSession,
    initializeAuthSessionWithRetry,
    isExpectedRefreshRejection,
    statusForInitializationFailure,
} from "./auth-state.js";

describe("AuthProvider session-state classification", () => {
    it("keeps all five session states intact", () => {
        assert.deepEqual(AUTH_STATUSES, [
            "initializing",
            "authenticated",
            "anonymous",
            "session-failure",
            "unavailable",
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
