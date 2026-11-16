import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import {
  ACTION_SPECS,
  buildActionBody,
  type ActionInput,
  type WorkflowAction,
} from "@/lib/issues/issue-actions";

/** Only `actions` is consumed by the frontend; the rest is passed through untouched. */
export interface IssueWorkflow {
  actions: string[];
  [key: string]: unknown;
}

export interface IssueActionResult {
  issue: unknown;
  workflow: IssueWorkflow;
}

const issueUrl = (issueId: string, suffix: string) =>
  buildApiUrl(`/api/v1/issues/${encodeURIComponent(issueId)}/${suffix}`);

/** Viewer-specific; requires an authenticated actor (401 for anonymous). */
export function getIssueWorkflow(issueId: string, options: { signal?: AbortSignal } = {}) {
  return apiRequest<IssueWorkflow>(issueUrl(issueId, "workflow"), {
    cache: "no-store",
    signal: options.signal,
  });
}

export function executeIssueAction(issueId: string, action: WorkflowAction, input: ActionInput) {
  return apiRequest<IssueActionResult>(issueUrl(issueId, ACTION_SPECS[action].path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildActionBody(action, input)),
  });
}
