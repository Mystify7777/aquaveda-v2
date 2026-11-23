import type { PublicActor } from "./actor";
import type { PaginationQuery } from "./pagination";

export type KnowledgeStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface KnowledgeReviewHistoryEntry {
  decision: "approved" | "rejected";
  /** Unpopulated User id: public reads populate `author` only, not `reviewer`. */
  reviewer: string;
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

/** Canonical authoring payload for POST /api/v1/knowledge. */
export interface CreateKnowledgePayload {
  title: string;
  body: string;
  region?: string;
  category: string;
  topics?: string[];
}

/**
 * Fields the create endpoint actually returns that the frontend consumes.
 * The response is the raw created document (author is an unpopulated id),
 * so it is deliberately not typed as KnowledgeArticle.
 */
export type CreatedKnowledgeDraft = Pick<KnowledgeArticle, "_id" | "title" | "status">;

/**
 * Result of the lifecycle writes (submit / approve / reject / revise):
 * the raw updated document, of which the frontend consumes only these
 * fields (author is an unpopulated id there).
 */
export type KnowledgeLifecycleResult = Pick<KnowledgeArticle, "_id" | "title" | "status">;

/** Partial authoring payload for POST /api/v1/knowledge/:id/revise. */
export interface ReviseKnowledgePayload {
  title?: string;
  body?: string;
  region?: string;
  category?: string;
  topics?: string[];
}

export interface KnowledgeTaxonomyTerm { slug: string; displayName: string; }
export interface KnowledgeTaxonomy { categories: KnowledgeTaxonomyTerm[]; topics: KnowledgeTaxonomyTerm[]; }

// --- Authenticated workflow reads (Issue #74) ---------------------------

/** Query of GET /api/v1/knowledge/mine. The owner is the authenticated session, never a parameter. */
export interface MyKnowledgeQuery extends PaginationQuery {
  status?: KnowledgeStatus;
}

/** Query of GET /api/v1/knowledge/review-queue (pending_review only, fixed by the backend). */
export type ReviewQueueQuery = PaginationQuery;

/** List item of /mine and /review-queue: no `body`, no `reviewHistory`. */
export interface WorkflowKnowledgeSummary {
  _id: string;
  title: string;
  region: string;
  status: KnowledgeStatus;
  author: PublicActor | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowReviewEntry {
  decision: "approved" | "rejected";
  /** Null when the reviewer's account no longer resolves. */
  reviewer: PublicActor | null;
  feedback?: string;
  timestamp: string;
}

/** Full article from GET /api/v1/knowledge/:id/workflow. */
export interface WorkflowKnowledge extends WorkflowKnowledgeSummary {
  body: string;
  reviewHistory: WorkflowReviewEntry[];
}
