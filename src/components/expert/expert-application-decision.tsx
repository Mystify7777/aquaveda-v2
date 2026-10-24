"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveExpertApplication, rejectExpertApplication } from "@/lib/api/expert-application";
import type { ExpertApplicationForReview } from "@/lib/api/types/expert-application";
import { toExpertActionFailure, type ExpertActionFailure } from "@/lib/expert/action-failure";
import {
  NOTE_MAX_LENGTH,
  REJECT_NOTE_MIN_LENGTH,
  validateDecisionNote,
} from "@/lib/expert/submission-contract";

export type ExpertDecision = {
  userId: string;
  name: string;
  decision: "approved" | "rejected";
  result: ExpertApplicationForReview;
};

/**
 * Approve (explicit confirmation, optional welcome note) or reject (required
 * explanatory note) ONE pending application, always naming the `revision` the
 * reviewer saw (EXP-L11), so a decision can never land on a newer submission than
 * the one reviewed. Note rules come from the shared contract. The role grant is
 * the backend's atomic write; nothing here changes a role. A refusal (including
 * a stale revision) is shown and reported through `onStale`.
 *
 * Parents key this component by `userId:revision`, so any change of the reviewed
 * snapshot resets it (no half-typed note carried onto a different version).
 */
export function ExpertApplicationDecision({
  userId,
  name,
  revision,
  onDecided,
  onStale,
}: {
  userId: string;
  name: string;
  revision: number;
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
  const helpId = React.useId();

  const noteCheck = validateDecisionNote(note.trim() === "" && mode !== "rejecting" ? undefined : note, {
    required: mode === "rejecting",
  });
  const trimmedLength = note.trim().length;

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
    if (!noteCheck.ok || noteCheck.value === undefined) return;
    const trimmed = noteCheck.value;
    void run("reject", () => rejectExpertApplication(userId, { revision, note: trimmed }));
  }

  const busy = pending !== null;
  const approveNoteInvalid = mode === "confirm-approve" && !noteCheck.ok;

  return (
    <div className="space-y-3">
      {failure && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm">
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
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              Welcome note for the applicant <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Textarea
              id={noteId}
              className="min-h-16"
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              aria-invalid={approveNoteInvalid}
              aria-describedby={helpId}
            />
            <p id={helpId} className="text-muted-foreground text-xs">
              {approveNoteInvalid && !noteCheck.ok ? noteCheck.reason : `${trimmedLength}/${NOTE_MAX_LENGTH}. The applicant can see this note.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                void run("approve", () =>
                  approveExpertApplication(userId, {
                    revision,
                    ...(noteCheck.ok && noteCheck.value ? { note: noteCheck.value } : {}),
                  }),
                )
              }
              disabled={busy || approveNoteInvalid}
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
              Reason for the applicant
            </label>
            <Textarea
              id={noteId}
              className="min-h-20"
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              aria-invalid={trimmedLength > 0 && !noteCheck.ok}
              aria-describedby={helpId}
            />
            <p id={helpId} className="text-muted-foreground text-xs">
              Explain why, in at least {REJECT_NOTE_MIN_LENGTH} characters, so the applicant knows what to change.{" "}
              {trimmedLength}/{NOTE_MAX_LENGTH}. The applicant can see this note.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={busy || !noteCheck.ok} aria-busy={pending === "reject"}>
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
