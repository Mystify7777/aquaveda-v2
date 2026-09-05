import type { ApiResponse } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  let body: ApiResponse<T>;

  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError("Invalid API response");
  }

  if (!response.ok || !body.success || body.data === null) {
    throw new ApiError(
      body.message || "Request failed",
      !body.success ? body.code : undefined,
    );
  }

  return body.data;
}