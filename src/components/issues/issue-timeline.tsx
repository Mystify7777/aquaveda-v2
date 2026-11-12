import { formatDateTime } from "@/lib/format-date";
import type { IssueActivityEntry } from "@/lib/api/types/issue";
import { describeActivity } from "@/lib/issues/progress";

const KIND_LABEL = { status: "Status", responsibility: "Responsibility" } as const;
const ROLE_LABEL: Partial<Record<string, string>> = { EXPERT: "Expert", ADMIN: "Admin" };

function actorText(actor: IssueActivityEntry["actor"]): string | null {
  if (!actor) return null;
  const role = ROLE_LABEL[actor.role];
  return role ? `${actor.name} (${role})` : actor.name;
}

/**
 * The Issue's public activity log as a vertical timeline (#148 slice).
 *
 * Renders the server-provided entries exactly as received: in the server's
 * order (never re-sorted), already redacted (a pending grantee and private
 * notes are never in the payload), never merged with `statusHistory` or any
 * other source. Each entry carries a TEXT kind label ("Status" or
 * "Responsibility"), so the two kinds are distinguishable without color.
 *
 * Transition notes are public, user-controlled text: rendered as plain React
 * text (`whitespace-pre-line`), never interpreted as markup, and never able
 * to introduce headings into the page outline.
 */
export function IssueTimeline({ activity }: { activity: IssueActivityEntry[] }) {
  return (
    <section aria-labelledby="issue-timeline-heading" className="space-y-3 border-t pt-4">
      <h2 id="issue-timeline-heading" className="font-display text-lg font-semibold">
        Timeline
      </h2>
      {activity.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity recorded.</p>
      ) : (
        <ol className="border-border space-y-5 border-l pl-5 text-sm">
          {activity.map((entry) => {
            const { kind, title } = describeActivity(entry);
            const by = actorText(entry.actor);
            return (
              <li key={entry.id} className="relative space-y-1">
                <span
                  aria-hidden="true"
                  className="bg-border absolute top-1.5 -left-[1.6rem] size-2 rounded-full"
                />
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {KIND_LABEL[kind]}
                </p>
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground text-xs">
                  <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                  {by && <> · by {by}</>}
                </p>
                {entry.note && <p className="break-words whitespace-pre-line">{entry.note}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
