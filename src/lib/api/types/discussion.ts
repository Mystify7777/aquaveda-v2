import type { PublicActor } from "./actor";
import type { PaginatedResponse } from "./pagination";

export type DiscussionCategory = "QUESTION" | "DISCUSSION" | "IDEA";
export type DiscussionStatus = "ACTIVE" | "HIDDEN";

export interface Discussion {
  _id: string;
  title: string;
  body: string;
  category: DiscussionCategory;
  status: DiscussionStatus;
  author: PublicActor | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDiscussionPayload {
  title: string;
  body: string;
  category: DiscussionCategory;
}

export type DiscussionListResponse = PaginatedResponse<Discussion>;
