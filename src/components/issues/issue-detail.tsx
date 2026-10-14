import { CopyIssueId } from "@/components/issues/copy-issue-id";
import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import { IssueStatusBadge } from "@/components/issues/issue-status-badge";
import { formatDate } from "@/lib/format-date";
import type { Issue } from "@/lib/api/types/issue";
import { toLatLng } from "@/lib/issues/geo";
import { categoryLabel, severityLabel } from "@/lib/issues/labels";
import { ISSUE_STATUS_LABELS, isProjectEligible } from "@/lib/issues/status";

/**
 * Read-only public Issue detail. Status history is displayed as recorded
 * (from → to, timestamp); `actor` is an unpopulated id in the public DTO
 * and is not shown. No transition controls exist here — the lifecycle
 * write path and its unresolved authority (D-3a) are out of this surface.
 */
export function IssueDetail({ issue }: { issue: Issue }) {
  const position = toLatLng(issue.location);
  const category = categoryLabel(issue.category);
  const severity = severityLabel(issue.severity);

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{issue.title}</h1>
          <IssueStatusBadge status={issue.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          Reported by {issue.reportedBy.name} ·{" "}
          <time dateTime={issue.createdAt}>{formatDate(issue.createdAt)}</time>
        </p>
      </header>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{issue.description}</p>

      <dl className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
        {category && (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Category</dt>
            <dd>{category}</dd>
          </div>
        )}
        {severity && (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Severity</dt>
            <dd>{severity}</dd>
          </div>
        )}
        {isProjectEligible(issue.status) && (
          <div className="space-y-1 sm:col-span-2">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Issue ID <span className="font-normal normal-case">(for creating a project)</span>
            </dt>
            <dd>
              <CopyIssueId issueId={issue._id} showId />
            </dd>
          </div>
        )}
        {position && (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Location</dt>
            <dd className="font-mono">
              {position[0].toFixed(5)}, {position[1].toFixed(5)}
            </dd>
          </div>
        )}
      </dl>

      <IssueMapLoader issues={[issue]} label="Map showing this issue's location" heightClassName="h-64" />

      <section aria-labelledby="status-history-heading" className="space-y-3 border-t pt-4">
        <h2 id="status-history-heading" className="font-display text-lg font-semibold">
          Status history
        </h2>
        {issue.statusHistory.length === 0 ? (
          <p className="text-muted-foreground text-sm">No status changes recorded.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {issue.statusHistory.map((entry, i) => (
              <li key={i}>
                {entry.fromStatus
                  ? `${ISSUE_STATUS_LABELS[entry.fromStatus]} → ${ISSUE_STATUS_LABELS[entry.toStatus]}`
                  : `Reported as ${ISSUE_STATUS_LABELS[entry.toStatus]}`}
                {" · "}
                <time dateTime={entry.timestamp}>{formatDate(entry.timestamp)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
