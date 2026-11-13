import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { AttentionQueuePage, AttentionQueueQuery } from "./types/issue-attention";

/**
 * EXPERT-only, read-only needs-attention queue (#148).
 * The backend determines authorization, queue membership, ordering and pages.
 * Do not cache this role-scoped response or derive membership in the client.
 */
export function getIssueAttentionQueue(query: AttentionQueueQuery, init?: { signal?: AbortSignal }) {
  return apiRequest<AttentionQueuePage>(
    buildApiUrl("/api/v1/issues/attention", {
      queue: query.queue,
      page: query.page,
      limit: query.limit,
    }),
    { cache: "no-store", signal: init?.signal },
  );
}
