import type { IssueStatus } from "./issue";
import type { KnowledgeStatus } from "./knowledge";

/**
 * `GET /api/v1/dashboard` response data (backend contract #53,
 * docs/architecture/dashboard-contract.md). Every value is a non-negative
 * integer and always present (zero-filled). Computed entirely server-side;
 * the frontend renders it and never derives any of it.
 */
export interface DashboardIssueCounts {
  total: number;
  byStatus: Record<IssueStatus, number>;
}

export interface DashboardKnowledgeCounts {
  total: number;
  byStatus: Record<KnowledgeStatus, number>;
}

export interface Dashboard {
  /** Aggregates of already-public data. */
  platform: {
    issues: DashboardIssueCounts;
    knowledge: { approved: number };
    projects: { total: number };
  };
  /** The authenticated caller's own records only. */
  mine: {
    issuesReported: DashboardIssueCounts;
    knowledge: DashboardKnowledgeCounts;
    /** Disjoint: `contributing` excludes projects the caller created. */
    projects: { created: number; contributing: number };
  };
}
