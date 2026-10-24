import type {
  ApplicantHistoryEntry,
  MyExpertApplicationStatus,
} from "@/lib/api/types/expert-application";
import { buildTimeline } from "@/lib/expert/timeline";
import { formatDate } from "@/lib/format-date";

/**
 * Submitted -> (Awaiting review) -> Approved / Not approved, from the persisted
 * history. States no review-time promise. The latest cycle is the end of the list.
 */
export function ExpertApplicationTimeline({
  status,
  history,
}: {
  status: MyExpertApplicationStatus;
  history: ApplicantHistoryEntry[];
}) {
  const items = buildTimeline(status, history);
  if (items.length === 0) return null;
  return (
    <section aria-label="Application timeline" className="space-y-2">
      <h2 className="font-display text-lg font-semibold">Timeline</h2>
      <ol className="space-y-2 text-sm">
        {items.map((item, i) => (
          <li key={`${item.kind}-${item.at ?? "now"}-${i}`} className="flex flex-col">
            <span>
              <span className="font-medium">{item.label}</span>
              <span className="text-muted-foreground">
                {" · "}
                {item.at ? <time dateTime={item.at}>{formatDate(item.at)}</time> : "current status"}
              </span>
            </span>
            {item.note && (
              <span className="text-muted-foreground">
                Reviewer note: <span className="text-foreground">“{item.note}”</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {status === "pending" && (
        <p className="text-muted-foreground text-xs">
          Administrators review applications as they can; there is no fixed review time.
        </p>
      )}
    </section>
  );
}
