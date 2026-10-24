import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type {
  ExpertApplicationForReview,
  ExpertApplicationQueueQuery,
  ExpertDecisionRequest,
  ExpertSubmissionRequest,
  MyExpertApplication,
} from "./types/expert-application";
import type { PaginatedResponse } from "./types/pagination";

/**
 * Expert-application endpoints (#91). Client-side only in practice: the
 * session cookie belongs to the API origin. Nothing here carries a role,
 * applicant id, or reviewer id as authority — the applicant and reviewer are
 * always the authenticated actor; `userId` below only NAMES which pending
 * application an ADMIN is deciding, and the backend authorizes the decision.
 * The only request bodies are the strict submission and `{ revision, note }`.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };
const base = "/api/v1/expert-application";

/** Body = the strict submission (EXP-L9+). The acknowledgement carries only its version. */
export function applyForExpert(submission: ExpertSubmissionRequest) {
  return apiRequest<MyExpertApplication>(buildApiUrl(base), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(submission),
  });
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

/** `revision` is required (EXP-L11); `note` optional (trimmed 1-500), omitted when blank. */
export function approveExpertApplication(userId: string, { revision, note }: ExpertDecisionRequest) {
  return apiRequest<ExpertApplicationForReview>(
    buildApiUrl(`${base}/${encodeURIComponent(userId)}/approve`),
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(note ? { revision, note } : { revision }),
    },
  );
}

/** `revision` and `note` are both required (note 10-500 trimmed; EXP-L11/L12). */
export function rejectExpertApplication(userId: string, { revision, note }: ExpertDecisionRequest) {
  return apiRequest<ExpertApplicationForReview>(
    buildApiUrl(`${base}/${encodeURIComponent(userId)}/reject`),
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ revision, note }),
    },
  );
}
