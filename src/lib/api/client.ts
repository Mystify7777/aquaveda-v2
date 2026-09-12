import type { ApiFailure, ApiSuccess } from "./types";

export type ApiErrorKind = "http" | "network" | "response";

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly kind: ApiErrorKind,
        public readonly status?: number,
        public readonly code?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

function buildUrl(input: RequestInfo | URL) {
    if (input instanceof URL) return input.toString();
    if (typeof input === "string" && input.startsWith("http")) return input;
    if (typeof input === "string" && API_BASE_URL) {
        return `${API_BASE_URL}${input}`;
    }
    if (typeof input === "string") return input;
    return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isApiFailure(value: unknown): value is ApiFailure {
    return (
        isRecord(value) &&
        value.success === false &&
        value.data === null &&
        typeof value.message === "string"
    );
}

function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
    return (
        isRecord(value) &&
        value.success === true &&
        "data" in value &&
        typeof value.message === "string"
    );
}

async function requestJson(
    input: RequestInfo | URL,
    init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
        response = await fetch(buildUrl(input), {
            ...init,
            credentials: "include",
            headers,
        });
    } catch (error) {
        throw new ApiError(
            error instanceof Error ? error.message : "Network request failed",
            "network",
        );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const responseText = await response.text();

    if (!responseText.trim()) {
        throw new ApiError(
            response.ok
                ? "Empty API response"
                : `Request failed with status ${response.status}`,
            response.ok ? "response" : "http",
            response.status,
        );
    }

    if (!contentType.includes("application/json")) {
        throw new ApiError(
            response.ok
                ? "Unexpected API response format"
                : `Request failed with status ${response.status}`,
            response.ok ? "response" : "http",
            response.status,
        );
    }

    let body: unknown;
    try {
        body = JSON.parse(responseText) as unknown;
    } catch {
        throw new ApiError(
            response.ok
                ? "Invalid API response"
                : `Request failed with status ${response.status}`,
            response.ok ? "response" : "http",
            response.status,
        );
    }

    return { response, body };
}

function throwHttpError(response: Response, body: unknown): never {
    const failure = isRecord(body) ? body : {};
    throw new ApiError(
        typeof failure.message === "string"
            ? failure.message
            : `Request failed with status ${response.status}`,
        "http",
        response.status,
        typeof failure.code === "string" ? failure.code : undefined,
    );
}

export async function apiRequestRaw(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<unknown> {
    const { response, body } = await requestJson(input, init);
    if (!response.ok) throwHttpError(response, body);
    return body;
}

/** Shared Issue #7-compatible client for the generic { success, data } API. */
export async function apiRequest<T>(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<T> {
    const { response, body } = await requestJson(input, init);

    if (isApiFailure(body)) {
        throw new ApiError(
            body.message,
            "http",
            response.status,
            body.code,
        );
    }

    if (!isApiSuccess<T>(body)) {
        if (!response.ok) throwHttpError(response, body);
        throw new ApiError("Request failed", "response", response.status);
    }

    if (!response.ok) throwHttpError(response, body);

    return body.data;
}
