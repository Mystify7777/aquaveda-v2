"use client";

import * as React from "react";

import {
    getCurrentUser,
    login as loginRequest,
    logout as logoutRequest,
    refreshSession,
    register as registerRequest,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import type { AuthUser } from "@/lib/api/types";

type AuthStatus = "loading" | "anonymous" | "authenticated";

type AuthContextValue = {
    status: AuthStatus;
    user: AuthUser | null;
    login: typeof loginRequest;
    register: typeof registerRequest;
    logout: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = React.useState<AuthStatus>("loading");
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

    React.useEffect(() => {
        let active = true;
        const initializationGeneration = requestGeneration.current;

        const isCurrent = () =>
            active && requestGeneration.current === initializationGeneration;

        async function initialize() {
            try {
                const currentUser = await getCurrentUser();
                if (currentUser) {
                    if (isCurrent()) setAuthenticated(currentUser);
                    return;
                }

                // /me intentionally resolves invalid access cookies as anonymous. A
                // single refresh attempt lets a valid refresh cookie restore a session
                // without exposing or inspecting either token in the browser.
                try {
                    const refreshedUser = await refreshSession();
                    if (isCurrent()) setAuthenticated(refreshedUser);
                    return;
                } catch (error) {
                    if (error instanceof ApiError && error.kind === "network") {
                        throw error;
                    }
                }

                if (isCurrent()) {
                    setUser(null);
                    setStatus("anonymous");
                }
            } catch {
                if (isCurrent()) {
                    setUser(null);
                    setStatus("anonymous");
                }
            }
        }

        void initialize();
        return () => {
            active = false;
        };
    }, [setAuthenticated]);

    const value = React.useMemo(
        () => ({ status, user, login, register, logout }),
        [status, user, login, register, logout],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = React.useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
}
