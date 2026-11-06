"use client";

import { StatTile } from "@/components/dashboard/stat-tile";
import { StatusBreakdown, type BreakdownRow } from "@/components/dashboard/status-breakdown";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboard } from "@/lib/api/dashboard";
import type { Dashboard } from "@/lib/api/types/dashboard";
import { useApiResource } from "@/lib/api/use-api-resource";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/issues/status";
import { KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS } from "@/lib/knowledge/status";

const issueRows = (byStatus: Dashboard["platform"]["issues"]["byStatus"]): BreakdownRow[] =>
  ISSUE_STATUSES.map((s) => ({ key: s, label: ISSUE_STATUS_LABELS[s], count: byStatus[s] }));

const knowledgeRows = (byStatus: Dashboard["mine"]["knowledge"]["byStatus"]): BreakdownRow[] =>
  KNOWLEDGE_STATUSES.map((s) => ({ key: s, label: KNOWLEDGE_STATUS_LABELS[s], count: byStatus[s] }));

function DashboardSkeleton() {
  return (
    <div role="status" className="space-y-10">
      <span className="sr-only">Loading your dashboard...</span>
      {[3, 4].map((tiles) => (
        <div key={tiles} className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: tiles }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 w-full rounded-xl" />
            {tiles === 4 && <Skeleton className="h-56 w-full rounded-xl" />}
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardContent({ data }: { data: Dashboard }) {
  const { platform, mine } = data;
  return (
    <div className="space-y-12">
      <section aria-labelledby="dashboard-platform" className="space-y-4">
        <div>
          <h2 id="dashboard-platform" className="font-display text-xl font-semibold">
            Across AquaVeda
          </h2>
          <p className="text-muted-foreground text-sm">Totals for the whole platform.</p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Issues reported" value={platform.issues.total} />
          <StatTile label="Approved articles" value={platform.knowledge.approved} />
          <StatTile label="Projects" value={platform.projects.total} />
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <StatusBreakdown
            title="Issues by status"
            totalLabel="All issues"
            total={platform.issues.total}
            rows={issueRows(platform.issues.byStatus)}
          />
        </div>
      </section>

      <section aria-labelledby="dashboard-mine" className="space-y-4">
        <div>
          <h2 id="dashboard-mine" className="font-display text-xl font-semibold">
            Your activity
          </h2>
          <p className="text-muted-foreground text-sm">Counts of what you have contributed.</p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Issues you reported" value={mine.issuesReported.total} />
          <StatTile label="Articles you wrote" value={mine.knowledge.total} />
          <StatTile label="Projects you created" value={mine.projects.created} />
          <StatTile label="Projects you contribute to" value={mine.projects.contributing} />
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <StatusBreakdown
            title="Your issues by status"
            totalLabel="All your issues"
            total={mine.issuesReported.total}
            rows={issueRows(mine.issuesReported.byStatus)}
          />
          <StatusBreakdown
            title="Your articles by status"
            totalLabel="All your articles"
            total={mine.knowledge.total}
            rows={knowledgeRows(mine.knowledge.byStatus)}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * Renders `GET /api/v1/dashboard` (#53) and nothing else: no other endpoint
 * is called and no number is derived here. Auth is enforced by the protected
 * layout; the fetch is client-side because it needs the API-origin session
 * cookie. An all-zero response is a normal, complete render, not an error.
 */
export function DashboardView() {
  const { resource, reload } = useApiResource(getDashboard, "dashboard");

  if (resource.status === "loading") return <DashboardSkeleton />;
  if (resource.status === "error") {
    return (
      <LoadError
        message={loadErrorMessage(resource.error, "your dashboard")}
        onRetry={reload}
        signIn={resource.error.status === 401}
      />
    );
  }
  return <DashboardContent data={resource.data} />;
}
