import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { Dashboard } from "./types/dashboard";

/**
 * The Dashboard read (#53). Authenticated: the session cookie is sent by
 * `apiRequest`. Per-user, so never cached.
 */
export function getDashboard(init?: { signal?: AbortSignal }) {
  return apiRequest<Dashboard>(buildApiUrl("/api/v1/dashboard"), { cache: "no-store", signal: init?.signal });
}
