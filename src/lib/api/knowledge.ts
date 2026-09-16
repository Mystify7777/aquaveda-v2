import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type { KnowledgeArticle, KnowledgeListQuery } from "./types/knowledge";

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
