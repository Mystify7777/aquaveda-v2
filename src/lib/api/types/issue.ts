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
  /** Present on the public detail/list DTOs (#142); not rendered by the timeline, which uses `activity`. */
  _id?: string;
  actorProfile?: PublicActor | null;
  note?: string;
}

export interface Issue {
  _id: string;
  title: string;
  description: string;
  location: IssueLocation;
  /**
   * Optional reporter-supplied place name (#134). UNTRUSTED display text:
   * plain text only, not a verified address, never geometry. Absent on
   * legacy and GPS/manual-coordinate reports.
   */
  locationLabel?: string;
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
  /** Normalized by the contract in `lib/issues/location-contract`; omit when unset. */
  locationLabel?: string;
  category?: IssueCategory;
  severity?: IssueSeverity;
}

/**
 * What an Issue is waiting on, as a stable backend code (#148, ADR-0008 section
 * 6). Computed server-side and identical for every viewer; the frontend owns
 * only the wording (`lib/issues/progress.ts`). `null` only for a status outside
 * the lifecycle, never for a valid Issue.
 */
export type IssueNextAction =
  | "awaiting_acknowledgement"
  | "awaiting_responsible_party"
  | "awaiting_start"
  | "work_in_progress"
  | "awaiting_verification"
  | "verified";

/** Event types of the public activity log (`server/src/domain/issue-activity.js`, ADR-0007 section 8). */
export type IssueActivityType =
  | "report_submitted"
  | "status_changed"
  | "responsibility_offered"
  | "responsibility_accepted"
  | "responsibility_declined"
  | "responsibility_released"
  | "responsibility_withdrawn"
  | "responsibility_revoked";

/**
 * One entry of the server-provided public activity log, already in the
 * server's order and already redacted (a pending grantee, withdraw/revoke
 * notes etc. never appear). Rendered as received, never rebuilt client-side.
 */
export interface IssueActivityEntry {
  id: string;
  type: IssueActivityType;
  timestamp: string;
  actor: PublicActor | null;
  /** Public transition note (UNTRUSTED user text) or null. */
  note: string | null;
  fromStatus?: IssueStatus | null;
  toStatus?: IssueStatus;
}

/** The accepted responsible party; a pending offer is never public. */
export interface IssueAssignee {
  actor: PublicActor | null;
  acceptedAt: string;
}

/**
 * The public Issue detail read (`GET /api/v1/issues/:id`): the list shape plus
 * the accepted assignee, the public activity log (#142) and the derived
 * progress fields (#148). List items and the create response do NOT carry
 * these, which is why they are a separate type.
 */
export interface IssueDetailData extends Issue {
  assignee: IssueAssignee | null;
  activity: IssueActivityEntry[];
  nextAction: IssueNextAction | null;
  /** ISO time the Issue entered its current status (server-derived); null if unknown. Never computed here. */
  waitingSince: string | null;
  /** `false` today only because dispute storage does not exist yet (DSH/PRG-148-4); read-only here. */
  resolutionDisputed: boolean;
}
