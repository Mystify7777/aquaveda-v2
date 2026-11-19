"use client";

import * as React from "react";

import {
    getCurrentUser,
    login as loginRequest,
    logout as logoutRequest,
    refreshSession,
    register as registerRequest,
} from "@/lib/api/auth";
import { initializeAuthSessionWithRetry } from "@/lib/auth-state";
import type { AuthUser } from "@/lib/api/types";

export type AuthStatus =
    | "initializing"
    | "authenticated"
    | "anonymous"
    | "session-failure"
    | "unavailable";

type AuthContextValue = {
    status: AuthStatus;
    user: AuthUser | null;
    login: typeof loginRequest;
    register: typeof registerRequest;
    logout: () => Promise<void>;
    refreshUser: () => Promise<AuthUser | null>;
    /** Retry the existing /me + /refresh bootstrap contract after unavailability. */
    retryInitialization: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = React.useState<AuthStatus>("initializing");
    const [user, setUser] = React.useState<AuthUser | null>(null);
    const [retrying, setRetrying] = React.useState(false);
    const requestGeneration = React.useRef(0);
    const retryGeneration = React.useRef(0);

    const setAuthenticated = React.useCallback((nextUser: AuthUser) => {
        setUser(nextUser);
        setStatus("authenticated");
        return nextUser;
    }, []);

    const login = React.useCallback(
        async (payload: Parameters<typeof loginRequest>[0]) => {
            const generation = ++requestGeneration.current;
            retryGeneration.current += 1;
            const nextUser = await loginRequest(payload);
            if (generation === requestGeneration.current) setAuthenticated(nextUser);
            return nextUser;
        },
        [setAuthenticated],
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
        await logoutRequest();
        if (generation === requestGeneration.current) {
            setUser(null);
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

        if (generation !== retryGeneration.current) return;
        if (result.user) {
            setAuthenticated(result.user);
        } else {
            setUser(null);
            setStatus(result.status as AuthStatus);
        }
    }, [setAuthenticated]);

    const retryInitialization = React.useCallback(async () => {
        // Only expose retry when the initial bounded attempt ended in the
        // explicit unavailable state. No manual retry of definitive auth errors.
        if (status !== "unavailable" || retrying) return;
        const generation = ++retryGeneration.current;
        setRetrying(true);
        setStatus("initializing");
        try {
            await runInitialization(generation);
        } finally {
            if (generation === retryGeneration.current) setRetrying(false);
        }
    }, [status, retrying, runInitialization]);

    React.useEffect(() => {
        let active = true;
        const generation = ++retryGeneration.current;
        const isCurrent = () => active && generation === retryGeneration.current;

        async function initialize() {
            const result = await initializeAuthSessionWithRetry({
                getCurrentUser,
                refreshSession,
            });

            if (!isCurrent()) return;
            if (result.user) {
                setAuthenticated(result.user);
            } else {
                setUser(null);
                setStatus(result.status as AuthStatus);
            }
        }

        void initialize();
        return () => {
            active = false;
            // Invalidates an in-flight retry result on unmount/Strict Mode cleanup.
            if (retryGeneration.current === generation) retryGeneration.current += 1;
        };
    }, [setAuthenticated]);

    const value = React.useMemo(
        () => ({ status, user, login, register, logout, refreshUser, retryInitialization }),
        [status, user, login, register, logout, refreshUser, retryInitialization],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = React.useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}
