/** Expert-application contract (backend #91 / EXP-L1–L8). */

export type ExpertApplicationStatus = "pending" | "approved" | "rejected";
export type MyExpertApplicationStatus = "none" | ExpertApplicationStatus;

export interface ApplicantHistoryEntry {
  fromStatus: ExpertApplicationStatus | null;
  toStatus: ExpertApplicationStatus;
  note?: string;
  timestamp: string;
}

/** GET /expert-application/me and POST /expert-application. No reviewer identity. */
export interface MyExpertApplication {
  status: MyExpertApplicationStatus;
  history: ApplicantHistoryEntry[];
}

export interface ReviewerHistoryEntry extends ApplicantHistoryEntry {
  actor: string;
}

/** ADMIN queue item, and the result of approve/reject. No email by design. */
export interface ExpertApplicationForReview {
  userId: string;
  name: string;
  bio?: string;
  status: ExpertApplicationStatus;
  requestedAt?: string;
  history: ReviewerHistoryEntry[];
}

export interface ExpertApplicationQueueQuery {
  page?: number;
  limit?: number;
}
