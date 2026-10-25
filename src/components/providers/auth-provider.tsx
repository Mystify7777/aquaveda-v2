"use client";

import * as React from "react";

import {
    getCurrentUser,
    login as loginRequest,
    logout as logoutRequest,
    refreshSession,
    register as registerRequest,
} from "@/lib/api/auth";
import { initializeAuthSession } from "@/lib/auth-state";
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
    /**
     * Re-read the signed-in user from the authoritative `/auth/me` (fresh role
     * per EXP-L7) into provider state, e.g. after an Expert approval changed the
     * role. No token rotation and no reload. Resolves the new user, or `null`
     * when the read failed or was superseded by a login/logout/account switch
     * (state is then left exactly as it was; session failures are handled by
     * the normal initialization path, not here).
     */
    refreshUser: () => Promise<AuthUser | null>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = React.useState<AuthStatus>("initializing");
    const [user, setUser] = React.useState<AuthUser | null>(null);
    const requestGeneration = React.useRef(0);

    const setAuthenticated = React.useCallback((nextUser: AuthUser) => {
        setUser(nextUser);
        setStatus("authenticated");
        return nextUser;
    }, []);

    const login = React.useCallback(
        async (payload: Parameters<typeof loginRequest>[0]) => {
            const generation = ++requestGeneration.current;
            const nextUser = await loginRequest(payload);
            if (generation === requestGeneration.current) setAuthenticated(nextUser);
            return nextUser;
        },
        [setAuthenticated],
    );

    const register = React.useCallback(
        async (payload: Parameters<typeof registerRequest>[0]) => {
            const generation = ++requestGeneration.current;
            const nextUser = await registerRequest(payload);
            if (generation === requestGeneration.current) setAuthenticated(nextUser);
            return nextUser;
        },
        [setAuthenticated],
    );

    const logout = React.useCallback(async () => {
        const generation = ++requestGeneration.current;
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

    React.useEffect(() => {
        let active = true;
        const initializationGeneration = requestGeneration.current;
        const isCurrent = () =>
            active && requestGeneration.current === initializationGeneration;

        async function initialize() {
            const result = await initializeAuthSession({
                getCurrentUser,
                refreshSession,
            });

            if (isCurrent()) {
                if (result.user) {
                    setAuthenticated(result.user);
                } else {
                    setUser(null);
                    setStatus(result.status as AuthStatus);
                }
            }
        }

        void initialize();
        return () => {
            active = false;
        };
    }, [setAuthenticated]);

    const value = React.useMemo(
        () => ({ status, user, login, register, logout, refreshUser }),
        [status, user, login, register, logout, refreshUser],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = React.useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}