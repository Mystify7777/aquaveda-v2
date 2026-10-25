/** Expert-application contract (backend #91 / EXP-L1–L8). */

export type ExpertApplicationStatus = "pending" | "approved" | "rejected";
export type MyExpertApplicationStatus = "none" | ExpertApplicationStatus;

/** A submitted application (EXP-L9+). The acknowledgement hash is never sent to clients. */
export interface ExpertSubmission {
  expertiseAreas: string[];
  experience: string;
  affiliation?: string;
  references: string[];
  acknowledgement?: { version: number; acceptedAt: string };
}

/** Request body of POST /expert-application. The client supplies only the acknowledgement VERSION. */
export interface ExpertSubmissionRequest {
  expertiseAreas: string[];
  experience: string;
  affiliation?: string;
  references?: string[];
  acknowledgement: { version: number };
}

/** Body of approve (note optional) and reject (note required). `revision` = history length the reviewer saw. */
export interface ExpertDecisionRequest {
  revision: number;
  note?: string;
}

export interface ApplicantHistoryEntry {
  fromStatus: ExpertApplicationStatus | null;
  toStatus: ExpertApplicationStatus;
  note?: string;
  /**
   * Present only on `toStatus: "pending"` entries: the submission, or `null`
   * for a legacy application submitted before details were collected.
   */
  submission?: ExpertSubmission | null;
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
  /** history.length of this snapshot; sent back with the decision (EXP-L11). */
  revision: number;
  /** Submission of the latest pending entry; `null` = legacy application. */
  submission: ExpertSubmission | null;
  history: ReviewerHistoryEntry[];
}

export interface ExpertApplicationQueueQuery {
  page?: number;
  limit?: number;
}
