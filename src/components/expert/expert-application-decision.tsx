"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveExpertApplication, rejectExpertApplication } from "@/lib/api/expert-application";
import type { ExpertApplicationForReview } from "@/lib/api/types/expert-application";
import { toExpertActionFailure, type ExpertActionFailure } from "@/lib/expert/action-failure";

export type ExpertDecision = {
  userId: string;
  name: string;
  decision: "approved" | "rejected";
  result: ExpertApplicationForReview;
};

const NOTE_MAX = 500;

/**
 * Approve (with explicit confirmation) or reject (optional note) one pending
 * application. Both call the existing backend endpoints; the role grant is
 * the backend's atomic write — nothing here changes a role. Rendered for any
 * signed-in viewer of the queue route; an unauthorized caller's request is
 * refused by the backend and that refusal is shown.
 */
export function ExpertApplicationDecision({
  userId,
  name,
  onDecided,
  onStale,
}: {
  userId: string;
  name: string;
  onDecided: (decision: ExpertDecision) => void;
  onStale: () => void;
}) {
  const [mode, setMode] = React.useState<"idle" | "confirm-approve" | "rejecting">("idle");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [failure, setFailure] = React.useState<ExpertActionFailure | null>(null);
  // One guard for both actions: `pending` lags a render and approve/reject must never overlap.
  const inFlight = React.useRef(false);
  const noteId = React.useId();

  async function run(kind: "approve" | "reject", call: () => Promise<ExpertApplicationForReview>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    setFailure(null);
    try {
      const result = await call();
      onDecided({ userId, name, decision: kind === "approve" ? "approved" : "rejected", result });
    } catch (error) {
      const next = toExpertActionFailure(error, "decide");
      setFailure(next);
      if (next.kind === "stale") onStale();
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function handleReject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    void run("reject", () => rejectExpertApplication(userId, trimmed || undefined));
  }

  const busy = pending !== null;

  return (
    <div className="space-y-3">
      {failure && (
        <div
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm"
        >
          <p>{failure.message}</p>
          {failure.kind === "session" && (
            <Button asChild size="sm">
              <Link href="/auth/login">Sign in</Link>
            </Button>
          )}
        </div>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("confirm-approve")} disabled={busy}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("rejecting")} disabled={busy}>
            Reject
          </Button>
        </div>
      )}

      {mode === "confirm-approve" && (
        <div className="space-y-2" role="group" aria-label={`Confirm approval for ${name}`}>
          <p className="text-sm">
            Grant Expert status to <strong>{name}</strong>? They will be able to review Knowledge articles.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void run("approve", () => approveExpertApplication(userId))}
              disabled={busy}
              aria-busy={pending === "approve"}
            >
              {pending === "approve" ? "Approving..." : "Confirm approval"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "rejecting" && (
        <form onSubmit={handleReject} aria-busy={pending === "reject"} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              Note for the applicant (optional)
            </label>
            <Textarea
              id={noteId}
              className="min-h-20"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            <p className="text-muted-foreground text-xs">
              {note.length}/{NOTE_MAX}. The applicant can see this note.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>
              {pending === "reject" ? "Rejecting..." : "Confirm rejection"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
