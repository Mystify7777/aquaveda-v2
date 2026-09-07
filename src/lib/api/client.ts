import type { ApiResponse } from "./types";

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

/**
 * Shared frontend API boundary.
 *
 * Credentials are included so browser HttpOnly cookies are sent with
 * credentialed requests when the frontend connects to the backend.
 */
export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
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