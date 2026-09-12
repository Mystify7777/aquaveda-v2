import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AUTH_STATUSES,
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
        assert.notEqual("anonymous", "session-failure");
    });

    it("distinguishes session failure from network unavailability", () => {
        assert.equal(
            statusForInitializationFailure({ kind: "response" }),
            "session-failure",
        );
        assert.equal(
            statusForInitializationFailure({ kind: "network" }),
            "unavailable",
        );
        assert.notEqual(
            statusForInitializationFailure({ kind: "response" }),
            statusForInitializationFailure({ kind: "network" }),
        );
    });

    it("never classifies a network/backend failure as anonymous", () => {
        assert.equal(
            isExpectedRefreshRejection({ kind: "network" }),
            false,
        );
        assert.notEqual(
            statusForInitializationFailure({ kind: "network" }),
            "anonymous",
        );
    });
});