import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type {
  AdminAccountEntry,
  AdminDirectoryPage,
  AdminDirectoryQuery,
  AdminHistoryPage,
} from "./types/accounts";

/**
 * Admin account-governance READ endpoints (#181). Read-only by construction: this
 * module has no mutation function and must not gain one (mute/suspend/lift belong
 * to the mutation contracts, ADR-0010/ADR-0012, #255). Client-side only in
 * practice (the session cookie belongs to the API origin). The backend authorizes
 * (ADMIN only); the UI role gate is presentation, not authority.
 */
const base = "/api/v1/accounts";

type Init = { signal?: AbortSignal };

export function getAccountDirectory(query: AdminDirectoryQuery = {}, init?: Init) {
  return apiRequest<AdminDirectoryPage>(
    buildApiUrl(base, query as Record<string, string | number | undefined>),
    { cache: "no-store", signal: init?.signal },
  );
}

export function getAccountEntry(userId: string, init?: Init) {
  return apiRequest<AdminAccountEntry>(buildApiUrl(`${base}/${encodeURIComponent(userId)}`), {
    cache: "no-store",
    signal: init?.signal,
  });
}

export function getAccountHistory(userId: string, query: { page?: number } = {}, init?: Init) {
  return apiRequest<AdminHistoryPage>(
    buildApiUrl(`${base}/${encodeURIComponent(userId)}/history`, query as Record<string, number | undefined>),
    { cache: "no-store", signal: init?.signal },
  );
}
