"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveKnowledge, rejectKnowledge } from "@/lib/api/knowledge";
import type { KnowledgeLifecycleResult } from "@/lib/api/types/knowledge";
import { toActionFailure, type ActionFailure } from "@/lib/knowledge/action-failure";

export type ReviewDecision = { decision: "approved" | "rejected"; result: KnowledgeLifecycleResult };

/**
 * pending_review -> approved | rejected. Rendered by the caller only for
 * a pending article the viewer did not write; the backend still decides
 * whether the actor may review (EXPERT-only, reviewer !== author) and
 * whether the article is still pending.
 */
export function KnowledgeReviewActions({
  knowledgeId,
  onDecided,
}: {
  knowledgeId: string;
  onDecided: (decision: ReviewDecision) => void;
}) {
  const [rejecting, setRejecting] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [feedbackError, setFeedbackError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [failure, setFailure] = React.useState<ActionFailure | null>(null);
  // One guard for both actions: `pending` state lags a render, and approve/reject must never overlap.
  const inFlight = React.useRef(false);
  const feedbackRef = React.useRef<HTMLTextAreaElement>(null);
  const feedbackId = React.useId();

  async function run(kind: "approve" | "reject", call: () => Promise<KnowledgeLifecycleResult>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    setFailure(null);
    try {
      const result = await call();
      onDecided({ decision: kind === "approve" ? "approved" : "rejected", result });
    } catch (error) {
      setFailure(toActionFailure(error, "review"));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function handleReject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = feedback.trim();
    if (!trimmed) {
      setFeedbackError("Feedback is required to reject an article.");
      feedbackRef.current?.focus();
      return;
    }
    setFeedbackError(null);
    void run("reject", () => rejectKnowledge(knowledgeId, trimmed));
  }

  const busy = pending !== null;

  return (
    <section aria-labelledby={`${feedbackId}-heading`} className="space-y-3 border-t pt-4">
      <h2 id={`${feedbackId}-heading`} className="font-display text-lg font-semibold">
        Review decision
      </h2>

      {failure && (
        <div
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm"
        >
          <p>{failure.message}</p>
          <Button asChild size="sm" variant="outline">
            <Link href={failure.kind === "session" ? "/auth/login" : "/learn/review"}>
              {failure.kind === "session" ? "Sign in" : "Back to review queue"}
            </Link>
          </Button>
        </div>
      )}

      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run("approve", () => approveKnowledge(knowledgeId))} disabled={busy} aria-busy={pending === "approve"}>
            {pending === "approve" ? "Approving..." : "Approve"}
          </Button>
          <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
            Reject
          </Button>
        </div>
      ) : (
        <form onSubmit={handleReject} noValidate aria-busy={pending === "reject"} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={feedbackId} className="text-sm font-medium">
              Feedback for the author
            </label>
            <Textarea
              id={feedbackId}
              ref={feedbackRef}
              className="min-h-24"
              value={feedback}
              onChange={(e) => {
                setFeedback(e.target.value);
                if (feedbackError) setFeedbackError(null);
              }}
              disabled={busy}
              aria-required="true"
              aria-invalid={!!feedbackError}
              aria-describedby={feedbackError ? `${feedbackId}-error` : undefined}
              autoFocus
            />
            {feedbackError && (
              <p id={`${feedbackId}-error`} className="text-destructive text-xs">
                {feedbackError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>
              {pending === "reject" ? "Rejecting..." : "Confirm rejection"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
