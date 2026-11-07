import type { ApiResponse } from "./types";

/**
 * - `http`      the API answered with a failure (existing semantics)
 * - `network`   no usable answer: the request could not be completed. A request
 *               that exceeded its time limit is ALSO `network` (so every existing
 *               "service unreachable" presentation keeps applying) but carries
 *               `reason: "timeout"`; use `isApiTimeout()` to tell them apart.
 * - `response`  the API answered with something unusable (existing semantics)
 * - `aborted`   the CALLER cancelled the request through its own `signal`. This
 *               is a cancellation, not a failure: owners that abort on purpose
 *               (unmount, key change, a newer search) should ignore it.
 */
export type ApiErrorKind = "http" | "network" | "response" | "aborted";
export type ApiErrorReason = "timeout";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly status?: number,
    public readonly code?: string,
    public readonly reason?: ApiErrorReason,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request exceeded its time limit (see `DEFAULT_API_TIMEOUT_MS`). */
export const isApiTimeout = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.reason === "timeout";

/** The caller cancelled the request via its own `AbortSignal`. */
export const isApiAbort = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.kind === "aborted";

/**
 * Default time limit for one request, covering connection, headers AND reading
 * the body. Generous enough for a cold or busy API, bounded so authenticated UI
 * can never wait forever. Override per call with `timeoutMs`.
 */
export const DEFAULT_API_TIMEOUT_MS = 15_000;

export type ApiRequestInit = RequestInit & {
  /** Time limit for this request in ms (default `DEFAULT_API_TIMEOUT_MS`). */
  timeoutMs?: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

function buildUrl(input: RequestInfo | URL) {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string" && /^https?:\/\//.test(input)) return input;
  if (
    typeof input === "string" &&
    input.startsWith("/api/v1/") &&
    API_BASE_URL
  ) {
    return `${API_BASE_URL}${input}`;
  }
  return input;
}

/**
 * Shared frontend API boundary.
 *
 * Credentials are included so browser HttpOnly cookies are sent with
 * credentialed requests when the frontend connects to the backend.
 *
 * Lifetime: every request is cancellable and time-bounded. One internal
 * AbortController governs the fetch AND the body read; it aborts when the
 * time limit (`timeoutMs`, default `DEFAULT_API_TIMEOUT_MS`) elapses or when
 * the caller's own `signal` aborts, so the underlying request is really
 * cancelled, not merely abandoned. Outcomes are distinguishable:
 *   - time limit      -> ApiError kind "network", reason "timeout" (isApiTimeout)
 *   - caller abort    -> ApiError kind "aborted" (isApiAbort); never a failure
 *   - other transport -> ApiError kind "network"
 *   - API answers     -> unchanged http / response semantics
 * Composition uses a plain AbortController plus a listener on the caller's
 * signal (not AbortSignal.any/timeout), so it works in every supported
 * browser and under fake timers in tests.
 */
export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: ApiRequestInit,
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal: callerSignal, ...fetchInit } = init ?? {};

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  /** Timeout wins over a coincident caller abort only if it fired first. */
  const interruption = (): ApiError | null => {
    if (timedOut) return new ApiError("Request timed out", "network", undefined, undefined, "timeout");
    if (callerSignal?.aborted) return new ApiError("Request was cancelled", "aborted");
    return null;
  };

  let response: Response;
  let responseText: string;

  try {
    try {
      const headers = new Headers(fetchInit.headers);

      if (typeof fetchInit.body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      response = await fetch(buildUrl(input), {
        ...fetchInit,
        headers,
        credentials: "include",
        signal: controller.signal,
      });
    } catch (error) {
      throw (
        interruption() ??
        new ApiError(error instanceof Error ? error.message : "Network request failed", "network")
      );
    }

    try {
      responseText = await response.text();
    } catch (error) {
      // Only an interruption is classified here; any other body-read failure
      // propagates unchanged (as before this boundary was time-bounded).
      throw interruption() ?? error;
    }
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  const contentType = response.headers.get("content-type") ?? "";

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

  let body: ApiResponse<T>;

  try {
    body = JSON.parse(responseText) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      response.ok
        ? "Invalid API response"
        : `Request failed with status ${response.status}`,
      response.ok ? "response" : "http",
      response.status,
    );
  }

  if (!body.success) {
    throw new ApiError(
      body.message || "Request failed",
      "http",
      response.status,
      body.code,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      body.message || `Request failed with status ${response.status}`,
      "http",
      response.status,
    );
  }

  return body.data;
}
