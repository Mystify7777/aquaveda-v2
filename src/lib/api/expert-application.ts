import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type {
  ExpertApplicationForReview,
  ExpertApplicationQueueQuery,
  MyExpertApplication,
} from "./types/expert-application";
import type { PaginatedResponse } from "./types/pagination";

/**
 * Expert-application endpoints (#91). Client-side only in practice: the
 * session cookie belongs to the API origin. Nothing here carries a role,
 * applicant id, or reviewer id as authority — the applicant and reviewer are
 * always the authenticated actor; `userId` below only NAMES which pending
 * application an ADMIN is deciding, and the backend authorizes the decision.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const base = "/api/v1/expert-application";

export function applyForExpert() {
  // Backend body schema is an empty strict object; no fields exist to send.
  return apiRequest<MyExpertApplication>(buildApiUrl(base), { method: "POST" });
}

export function getMyExpertApplication() {
  return apiRequest<MyExpertApplication>(buildApiUrl(`${base}/me`), { cache: "no-store" });
}

export function getPendingExpertApplications(query?: ExpertApplicationQueueQuery) {
  return apiRequest<PaginatedResponse<ExpertApplicationForReview>>(
    buildApiUrl(base, query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function approveExpertApplication(userId: string) {
  return apiRequest<ExpertApplicationForReview>(
    buildApiUrl(`${base}/${encodeURIComponent(userId)}/approve`),
    { method: "POST" },
  );
}

/** `note` is the only supported field (optional, 1-500 chars); omitted when blank. */
export function rejectExpertApplication(userId: string, note?: string) {
  return apiRequest<ExpertApplicationForReview>(
    buildApiUrl(`${base}/${encodeURIComponent(userId)}/reject`),
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}
