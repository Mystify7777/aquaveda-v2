import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { IssueRecommendations } from "./types/recommendation";

export function getIssueRecommendations(issueId: string, options?: { signal?: AbortSignal }) {
  return apiRequest<IssueRecommendations>(
    buildApiUrl(`/api/v1/issues/${encodeURIComponent(issueId)}/recommendations`),
    { method: "GET", cache: "no-store", signal: options?.signal },
  );
}
