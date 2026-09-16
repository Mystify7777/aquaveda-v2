import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type { Issue, IssueListQuery } from "./types/issue";

export function getIssues(query?: IssueListQuery) {
  return apiRequest<PaginatedResponse<Issue>>(
    buildApiUrl("/api/v1/issues", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getIssue(issueId: string) {
  return apiRequest<Issue>(buildApiUrl(`/api/v1/issues/${issueId}`), {
    cache: "no-store",
  });
}
