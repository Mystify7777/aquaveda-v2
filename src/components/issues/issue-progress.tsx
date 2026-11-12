import { formatDate } from "@/lib/format-date";
import type { IssueDetailData } from "@/lib/api/types/issue";
import { NEXT_ACTION_COPY } from "@/lib/issues/progress";

/**
 * "Where is this issue, and what is it waiting on" (#148 / ADR-0008 section 6).
 * Renders ONLY what the backend derived: `nextAction` (a code; the wording is
 * ours), `waitingSince` (shown as the server's date, never computed against
 * the clock), the accepted assignee, and `resolutionDisputed` as a read-only
 * notice. It decides nothing, offers no action, and shows no dispute detail.
 * Server-compatible (no state, no effects).
 */
export function IssueProgress({ issue }: { issue: IssueDetailData }) {
  const copy = issue.nextAction ? NEXT_ACTION_COPY[issue.nextAction] : null;
  const since = issue.waitingSince ? formatDate(issue.waitingSince) : "";
  // Shown exactly when the contract supplies an accepted assignee. Absence is
  // already stated by `nextAction` ("Waiting for someone to take
  // responsibility"), and the frontend does not decide when responsibility is
  // a meaningful concept.
  const assignee = issue.assignee;

  return (
    <section aria-labelledby="issue-progress-heading" className="space-y-3 border-t pt-4">
      <h2 id="issue-progress-heading" className="font-display text-lg font-semibold">
        Progress
      </h2>

      {copy && (
        <div className="space-y-1">
          <p className="font-medium">{copy.label}</p>
          <p className="text-muted-foreground text-sm">{copy.description}</p>
        </div>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {since && (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Since</dt>
            <dd>
              <time dateTime={issue.waitingSince ?? undefined}>{since}</time>
            </dd>
          </div>
        )}
        {assignee && (
          <div className="space-y-1">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Responsible party</dt>
            <dd>
              {assignee.actor ? assignee.actor.name : "Accepted (account unavailable)"}
              {formatDate(assignee.acceptedAt) && (
                <span className="text-muted-foreground">
                  {" · accepted "}
                  <time dateTime={assignee.acceptedAt}>{formatDate(assignee.acceptedAt)}</time>
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {issue.resolutionDisputed && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">Resolution disputed</p>
          <p className="text-muted-foreground">An expert review is pending.</p>
        </div>
      )}
    </section>
  );
}
