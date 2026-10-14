import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type {
  CreatedKnowledgeDraft,
  CreateKnowledgePayload,
  KnowledgeArticle,
  KnowledgeListQuery,
  MyKnowledgeQuery,
  ReviewQueueQuery,
  ReviseKnowledgePayload,
  WorkflowKnowledge,
  WorkflowKnowledgeSummary,
  KnowledgeLifecycleResult,
} from "./types/knowledge";

export function getKnowledgeList(query?: KnowledgeListQuery) {
  return apiRequest<PaginatedResponse<KnowledgeArticle>>(
    buildApiUrl("/api/v1/knowledge", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getKnowledgeArticle(knowledgeId: string) {
  return apiRequest<KnowledgeArticle>(
    buildApiUrl(`/api/v1/knowledge/${knowledgeId}`),
    { cache: "no-store" },
  );
}

export function createKnowledge(payload: CreateKnowledgePayload) {
  return apiRequest<CreatedKnowledgeDraft>(buildApiUrl("/api/v1/knowledge"), {
    method: "POST",
    // apiRequest sets no Content-Type; express.json() ignores bodies without it.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function lifecycleUrl(knowledgeId: string, action: string) {
  return buildApiUrl(`/api/v1/knowledge/${encodeURIComponent(knowledgeId)}/${action}`);
}

export function submitKnowledge(knowledgeId: string) {
  return apiRequest<KnowledgeLifecycleResult>(lifecycleUrl(knowledgeId, "submit"), { method: "POST" });
}

export function approveKnowledge(knowledgeId: string) {
  return apiRequest<KnowledgeLifecycleResult>(lifecycleUrl(knowledgeId, "approve"), { method: "POST" });
}

export function rejectKnowledge(knowledgeId: string, feedback: string) {
  return apiRequest<KnowledgeLifecycleResult>(lifecycleUrl(knowledgeId, "reject"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ feedback }),
  });
}

export function reviseKnowledge(knowledgeId: string, payload: ReviseKnowledgePayload) {
  return apiRequest<KnowledgeLifecycleResult>(lifecycleUrl(knowledgeId, "revise"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

// Authenticated workflow reads (Issue #74). Client-side only in practice:
// the session cookie belongs to the API origin, so a Next server render
// cannot forward it.

export function getMyKnowledge(query?: MyKnowledgeQuery) {
  return apiRequest<PaginatedResponse<WorkflowKnowledgeSummary>>(
    buildApiUrl("/api/v1/knowledge/mine", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getReviewQueue(query?: ReviewQueueQuery) {
  return apiRequest<PaginatedResponse<WorkflowKnowledgeSummary>>(
    buildApiUrl("/api/v1/knowledge/review-queue", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getKnowledgeWorkflow(knowledgeId: string) {
  return apiRequest<WorkflowKnowledge>(lifecycleUrl(knowledgeId, "workflow"), { cache: "no-store" });
}
