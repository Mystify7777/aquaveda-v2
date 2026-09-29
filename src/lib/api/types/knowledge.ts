import type { PublicActor } from "./actor";
import type { PaginationQuery } from "./pagination";

export type KnowledgeStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface KnowledgeReviewHistoryEntry {
  decision: "approved" | "rejected";
  reviewer: PublicActor;
  feedback?: string;
  timestamp: string;
}

export interface KnowledgeArticle {
  _id: string;
  title: string;
  body: string;
  region: string;
  status: KnowledgeStatus;
  author: PublicActor;
  reviewHistory: KnowledgeReviewHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeListQuery = PaginationQuery;

/** Body of POST /api/v1/knowledge. `region` is intentionally not modeled (semantics undefined). */
export interface CreateKnowledgePayload {
  title: string;
  body: string;
}

/**
 * Fields the create endpoint actually returns that the frontend consumes.
 * The response is the raw created document (author is an unpopulated id),
 * so it is deliberately not typed as KnowledgeArticle.
 */
export type CreatedKnowledgeDraft = Pick<KnowledgeArticle, "_id" | "title" | "status">;
