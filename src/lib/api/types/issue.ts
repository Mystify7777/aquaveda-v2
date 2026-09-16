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
