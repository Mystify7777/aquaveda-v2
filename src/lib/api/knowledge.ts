import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type {
  CreatedKnowledgeDraft,
  CreateKnowledgePayload,
  KnowledgeArticle,
  KnowledgeListQuery,
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
