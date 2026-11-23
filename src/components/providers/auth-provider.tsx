"use client";

import * as React from "react";

import {
    getCurrentUser,
    login as loginRequest,
    logout as logoutRequest,
    refreshSession,
    register as registerRequest,
} from "@/lib/api/auth";
import type { AccountRestriction } from "@/lib/api/account-restriction";
import { initializeAuthSessionWithRetry, restrictionForAccountState } from "@/lib/auth-state";
import type { AuthUser } from "@/lib/api/types";

export type AuthStatus =
    | "initializing"
    | "authenticated"
    | "anonymous"
    | "session-failure"
    | "unavailable"
    // Hard-suspended account recognized from /auth/me (#251). `user` is null: the
    // normal authenticated application surface is never entered.
    | "suspended";

type AuthContextValue = {
    status: AuthStatus;
    user: AuthUser | null;
    /**
     * `muted` (status stays "authenticated": read access kept, not logged out),
     * `suspended` (status "suspended"), otherwise null. Derived from /auth/me's
     * `accountState`; the backend remains the authority (#248 covers per-request codes).
     */
    restriction: AccountRestriction | null;
    login: typeof loginRequest;
    register: typeof registerRequest;
    logout: () => Promise<void>;
    refreshUser: () => Promise<AuthUser | null>;
    retryInitialization: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = React.useState<AuthStatus>("initializing");
    const [user, setUser] = React.useState<AuthUser | null>(null);
    const [restriction, setRestriction] = React.useState<AccountRestriction | null>(null);
    const requestGeneration = React.useRef(0);
    const retryGeneration = React.useRef(0);
    const manualRetryInFlight = React.useRef(false);
    const mounted = React.useRef(false);

    /** Apply a resolved session user; the only place restriction state is derived. */
    const setAuthenticated = React.useCallback((nextUser: AuthUser) => {
        const next = restrictionForAccountState(nextUser.accountState) as AccountRestriction | null;
        setRestriction(next);
        if (next === "suspended") {
            setUser(null);
            setStatus("suspended");
            return null;
        }
        setUser(nextUser);
        setStatus("authenticated");
        return nextUser;
    }, []);

    /** login/register/refresh responses carry no accountState: learn it from /me, best effort. */
    const withAccountState = React.useCallback(async (sessionUser: AuthUser) => {
        try {
            return (await getCurrentUser()) ?? sessionUser;
        } catch {
            return sessionUser;
        }
    }, []);

    const login = React.useCallback(
        async (payload: Parameters<typeof loginRequest>[0]) => {
            const generation = ++requestGeneration.current;
            retryGeneration.current += 1;
            const nextUser = await loginRequest(payload);
            const resolved = await withAccountState(nextUser);
            if (generation === requestGeneration.current) setAuthenticated(resolved);
            return nextUser;
        },
        [setAuthenticated, withAccountState],
    );

    const register = React.useCallback(
        async (payload: Parameters<typeof registerRequest>[0]) => {
            const generation = ++requestGeneration.current;
            retryGeneration.current += 1;
            const nextUser = await registerRequest(payload);
            if (generation === requestGeneration.current) setAuthenticated(nextUser);
            return nextUser;
        },
        [setAuthenticated],
    );

    const logout = React.useCallback(async () => {
        const generation = ++requestGeneration.current;
        retryGeneration.current += 1;
        manualRetryInFlight.current = false;
        await logoutRequest();
        if (generation === requestGeneration.current) {
            setUser(null);
            setRestriction(null);
            setStatus("anonymous");
        }
    }, []);

    const refreshUser = React.useCallback(async () => {
        const generation = requestGeneration.current;
        try {
            const nextUser = await getCurrentUser();
            if (!nextUser || generation !== requestGeneration.current) return null;
            return setAuthenticated(nextUser);
        } catch {
            return null;
        }
    }, [setAuthenticated]);

    const runInitialization = React.useCallback(async (generation: number) => {
        const result = await initializeAuthSessionWithRetry({
            getCurrentUser,
            refreshSession,
        });

        if (!mounted.current || generation !== retryGeneration.current || requestGeneration.current !== generation) return;
        if (result.user) {
            setAuthenticated(result.user);
        } else {
            setUser(null);
            setRestriction(result.status === "suspended" ? "suspended" : null);
            setStatus(result.status as AuthStatus);
        }
    }, [setAuthenticated]);

    const retryInitialization = React.useCallback(async () => {
        if (status !== "unavailable" || manualRetryInFlight.current) return;
        manualRetryInFlight.current = true;
        const generation = ++retryGeneration.current;
        requestGeneration.current = generation;
        setStatus("initializing");
        try {
            await runInitialization(generation);
        } catch {
            if (mounted.current && generation === retryGeneration.current) {
                setStatus("unavailable");
            }
        } finally {
            if (generation === retryGeneration.current) {
                manualRetryInFlight.current = false;
            }
        }
    }, [status, runInitialization]);

    React.useEffect(() => {
        mounted.current = true;
        const generation = ++retryGeneration.current;
        requestGeneration.current = generation;
        void runInitialization(generation);

        return () => {
            mounted.current = false;
            // Invalidates results from an in-flight retry on unmount/Strict Mode cleanup.
            if (retryGeneration.current === generation) retryGeneration.current += 1;
            manualRetryInFlight.current = false;
        };
    }, [runInitialization]);

    const value = React.useMemo(
        () => ({ status, user, restriction, login, register, logout, refreshUser, retryInitialization }),
        [status, user, restriction, login, register, logout, refreshUser, retryInitialization],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = React.useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}
