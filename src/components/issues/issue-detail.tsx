import { UserText } from "@/components/content/user-text";
import { CopyIssueId } from "@/components/issues/copy-issue-id";
import { LOCATION_FALLBACK_TEXT, readableLocation } from "@/components/issues/issue-location";
import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import { IssueProgress } from "@/components/issues/issue-progress";
import { IssueStatusBadge } from "@/components/issues/issue-status-badge";
import { IssueTimeline } from "@/components/issues/issue-timeline";
import { formatDate } from "@/lib/format-date";
import type { IssueDetailData } from "@/lib/api/types/issue";
import { toLatLng } from "@/lib/issues/geo";
import { categoryLabel, severityLabel } from "@/lib/issues/labels";
import { isProjectEligible } from "@/lib/issues/status";

/**
 * Read-only public Issue detail. It presents the server's progression read
 * model (#148): a "Progress" summary (what the issue is waiting on, since
 * when, who is responsible, whether the resolution is disputed) and the
 * public activity "Timeline". Everything shown is supplied by the backend
 * DTO; nothing is derived or authorized here. No transition, progress-note or
 * dispute controls exist on this surface (ADR-0008 later slices).
 */
export function IssueDetail({ issue }: { issue: IssueDetailData }) {
  const position = toLatLng(issue.location);
  const locationName = readableLocation(issue);
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

      <UserText text={issue.description} />

      <IssueProgress issue={issue} />

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
        <div className="space-y-1 sm:col-span-2">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Issue ID
            {isProjectEligible(issue.status) && (
              <span className="font-normal normal-case"> (for creating a project)</span>
            )}
          </dt>
          <dd>
            <CopyIssueId issueId={issue._id} showId />
          </dd>
        </div>
        {(position || locationName) && (
          <div className="space-y-1 sm:col-span-2">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Location</dt>
            <dd className="space-y-0.5">
              <p dir="auto" className={locationName ? "break-words" : "text-muted-foreground italic"}>
                {locationName ?? LOCATION_FALLBACK_TEXT}
              </p>
              {locationName && (
                <p className="text-muted-foreground text-xs">
                  Place name entered by the reporter; not a verified address. The map uses the coordinates below.
                </p>
              )}
              {position && (
                <p className="text-muted-foreground font-mono text-xs">
                  {position[0].toFixed(5)}, {position[1].toFixed(5)}
                </p>
              )}
            </dd>
          </div>
        )}
      </dl>

      <IssueMapLoader issues={[issue]} label="Map showing this issue's location" heightClassName="h-64" />

      <IssueTimeline activity={issue.activity} />
    </article>
  );
}
