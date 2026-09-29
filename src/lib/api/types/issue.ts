import type { PublicActor } from "./actor";
import type { PaginationQuery } from "./pagination";

export type IssueStatus =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "verified";

export interface IssueLocation {
  type: "Point";
  coordinates: [number, number];
}

export interface IssueStatusHistoryEntry {
  fromStatus: IssueStatus | null;
  toStatus: IssueStatus;
  actor: string;
  timestamp: string;
}

export interface Issue {
  _id: string;
  title: string;
  description: string;
  location: IssueLocation;
  severity: string;
  category: string;
  domain: string;
  status: IssueStatus;
  reportedBy: PublicActor;
  statusHistory: IssueStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface IssueListQuery extends PaginationQuery {
  status?: IssueStatus;
}

/**
 * Fields of POST /api/v1/issues consumed by the reporting flow (#44).
 * The backend also accepts optional `severity`/`category` strings (and
 * strips `domain`); they are deliberately not modeled here until #67
 * defines their semantics and canonical vocabulary.
 */
export interface CreateIssuePayload {
  title: string;
  description: string;
  location: IssueLocation;
}
