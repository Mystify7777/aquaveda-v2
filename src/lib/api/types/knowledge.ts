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
