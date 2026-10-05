import type { IssueCategory, IssueSeverity } from "@/lib/issues/classification";
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
  /**
   * Canonical value, or "" when unclassified (server domain/issue-classification.js).
   * Assumes no pre-#67 free-text rows exist; see domain-model.md "Read-type assumption".
   */
  severity: IssueSeverity | "";
  category: IssueCategory | "";
  domain: string;
  status: IssueStatus;
  reportedBy: PublicActor;
  statusHistory: IssueStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Query of GET /api/v1/issues. Discovery parameters are the locked #41
 * contract (docs/architecture/issue-discovery-contract.md): all optional,
 * combined with AND. `q` and `bbox` are sent as validated strings
 * (`bbox` = "west,south,east,north").
 */
export interface IssueListQuery extends PaginationQuery {
  status?: IssueStatus;
  category?: IssueCategory;
  severity?: IssueSeverity;
  q?: string;
  bbox?: string;
}

/**
 * Body of POST /api/v1/issues. `category`/`severity` are optional and, when
 * present, must be canonical values (#67). The backend strips `domain`.
 */
export interface CreateIssuePayload {
  title: string;
  description: string;
  location: IssueLocation;
  category?: IssueCategory;
  severity?: IssueSeverity;
}
