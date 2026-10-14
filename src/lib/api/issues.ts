import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type { CreateIssuePayload, Issue, IssueListQuery } from "./types/issue";

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

export function createIssue(payload: CreateIssuePayload) {
  return apiRequest<Issue>(buildApiUrl("/api/v1/issues"), {
    method: "POST",
    // apiRequest sets no Content-Type; express.json() ignores bodies without it.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
