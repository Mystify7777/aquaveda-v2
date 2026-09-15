import type { AuthUser } from "./types";

import { ApiError, apiRequest } from "./client";

const AUTH_PATH = "/api/v1/auth";

type LoginPayload = {
    email: string;
    password: string;
};

type RegisterPayload = LoginPayload & {
    name: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseAuthUser(value: unknown): AuthUser {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.role !== "string"
    ) {
        throw new ApiError("Unexpected authentication response", "response");
    }

    return { id: value.id, role: value.role };
}

async function getAuthUser(path: string, init?: RequestInit) {
    const data = await apiRequest<{ user: AuthUser | null }>(
        `${AUTH_PATH}${path}`,
        init,
    );

    if (data.user === null) return null;
    return parseAuthUser(data.user);
}

export function getCurrentUser() {
    return getAuthUser("/me");
}

export function login(payload: LoginPayload) {
    return getAuthUser("/login", {
        method: "POST",
        body: JSON.stringify(payload),
    }).then((user) => {
        if (!user) throw new ApiError("Unexpected authentication response", "response");
        return user;
    });
}

export function register(payload: RegisterPayload) {
    return getAuthUser("/register", {
        method: "POST",
        body: JSON.stringify(payload),
    }).then((user) => {
        if (!user) throw new ApiError("Unexpected authentication response", "response");
        return user;
    });
}

export async function logout() {
    await apiRequest<null>(`${AUTH_PATH}/logout`, { method: "POST" });
}

export function refreshSession() {
    return getAuthUser("/refresh", { method: "POST" }).then((user) => {
        if (!user) throw new ApiError("Unexpected authentication response", "response");
        return user;
    });
}