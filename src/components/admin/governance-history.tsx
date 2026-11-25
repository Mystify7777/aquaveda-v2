import { actionLabel, transitionStateLabel } from "@/lib/accounts/presentation";
import type { AdminGovernanceEvent } from "@/lib/api/types/accounts";
import { formatDateTime } from "@/lib/format-date";

function actorText(event: AdminGovernanceEvent): string {
  if (event.actorType === "SYSTEM") return "System (automatic)";
  if (!event.actor) return "Unknown actor";
  return event.actor.name ?? "Unknown administrator";
}

/**
 * Governance history exactly as the API returns it (order preserved: newest
 * first; never re-sorted). Renders ONLY the allowlisted fields; the private
 * reason, references and idempotency key are never part of the payload and are
 * never read here. `safeReason` is the user-safe explanation only.
 */
export function GovernanceHistory({ events }: { events: AdminGovernanceEvent[] }) {
  return (
    <ol aria-label="Governance history" className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="border-border space-y-1 rounded-lg border p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{actionLabel(event.action)}</p>
            <time dateTime={event.occurredAt} className="text-muted-foreground text-xs">
              {formatDateTime(event.occurredAt)}
            </time>
          </div>
          <p className="text-muted-foreground text-xs">
            {transitionStateLabel(event.previousState)} to {transitionStateLabel(event.resultingState)}
            {" · "}
            By {actorText(event)}
          </p>
          {event.safeReason && <p>{event.safeReason}</p>}
        </li>
      ))}
    </ol>
  );
}
