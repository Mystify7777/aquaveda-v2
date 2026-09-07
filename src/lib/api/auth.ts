import { ApiError, apiRequestRaw } from "./client";
import type { AuthUser, BackendAuthUser } from "./types";

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

function isAuthUser(value: unknown): value is AuthUser {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.role === "string"
    );
}

function isBackendAuthUser(value: unknown): value is BackendAuthUser {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.role === "string" &&
        typeof value.name === "string" &&
        typeof value.email === "string"
    );
}

function parseSuccess(value: unknown) {
    if (!isRecord(value) || value.success !== true) {
        throw new ApiError("Unexpected authentication response", "response");
    }
    return value;
}

async function authRequest<T>(
    path: string,
    init: RequestInit | undefined,
    parseUser: (value: unknown) => T,
) {
    const response = parseSuccess(
        await apiRequestRaw(`${AUTH_PATH}${path}`, init),
    );

    return parseUser(response.user);
}

export function getCurrentUser() {
    return authRequest("/me", undefined, (value) => {
        if (value === null) return null;
        if (isAuthUser(value)) return value;
        throw new ApiError("Unexpected authentication response", "response");
    });
}

export function login(payload: LoginPayload) {
    return authRequest("/login", {
        method: "POST",
        body: JSON.stringify(payload),
    }, (value) => {
        if (isBackendAuthUser(value)) return { id: value.id, role: value.role };
        throw new ApiError("Unexpected authentication response", "response");
    });
}

export function register(payload: RegisterPayload) {
    return authRequest("/register", {
        method: "POST",
        body: JSON.stringify(payload),
    }, (value) => {
        if (isBackendAuthUser(value)) return { id: value.id, role: value.role };
        throw new ApiError("Unexpected authentication response", "response");
    });
}

export async function logout() {
    const response = parseSuccess(
        await apiRequestRaw(`${AUTH_PATH}/logout`, { method: "POST" }),
    );
    if ("user" in response) {
        throw new ApiError("Unexpected authentication response", "response");
    }
}

export function refreshSession() {
    return authRequest("/refresh", { method: "POST" }, (value) => {
        if (isBackendAuthUser(value)) return { id: value.id, role: value.role };
        throw new ApiError("Unexpected authentication response", "response");
    });
}
