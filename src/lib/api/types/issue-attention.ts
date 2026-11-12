import type { IssueCategory, IssueSeverity } from "@/lib/issues/classification";
import type { IssueStatus, IssueNextAction } from "./issue";
import type { PaginatedResponse, PaginationQuery } from "./pagination";

/** Explicit server contract for GET /api/v1/issues/attention (#148). */
export const ATTENTION_QUEUES = [
  "unacknowledged",
  "unassigned",
  "awaiting_verification",
] as const;

export type AttentionQueue = (typeof ATTENTION_QUEUES)[number];

export interface AttentionQueueItem {
  _id: string;
  title: string;
  category: IssueCategory | "";
  severity: IssueSeverity | "";
  status: IssueStatus;
  nextAction: IssueNextAction;
  /** Server-derived timestamp; null means the source has no known age. */
  waitingSince: string | null;
  responsibility: "none" | "pending" | "accepted";
}

export interface AttentionQueueQuery extends PaginationQuery {
  queue: AttentionQueue;
}

export type AttentionQueuePage = PaginatedResponse<AttentionQueueItem> & {
  queue: AttentionQueue;
};
