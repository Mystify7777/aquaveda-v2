"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { submitKnowledge } from "@/lib/api/knowledge";
import type { KnowledgeLifecycleResult } from "@/lib/api/types/knowledge";

type Failure = { kind: "session" | "other"; message: string };

function toFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return {
        kind: "other",
        message: "The service is unreachable right now. Check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return { kind: "session", message: "Your session is no longer valid. Sign in again to submit this draft." };
    }
    if (error.status === 403) {
      return { kind: "other", message: "Only the author of this draft can submit it for review." };
    }
    if (error.status === 404) {
      return { kind: "other", message: "This draft could not be found." };
    }
    if (error.code === "INVALID_STATE" || error.code === "STATE_RACE") {
      return { kind: "other", message: "This draft is no longer in a state that can be submitted." };
    }
  }
  return { kind: "other", message: "We could not submit your draft. Try again." };
}

/**
 * draft -> pending_review (POST /api/v1/knowledge/:id/submit). Rendered only
 * where the caller just created the draft; the backend still enforces
 * author-only and current-status preconditions.
 */
export function KnowledgeSubmitAction({
  knowledgeId,
  onSubmitted,
}: {
  knowledgeId: string;
  onSubmitted: (result: KnowledgeLifecycleResult) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<Failure | null>(null);
  // Ref guard: `pending` state lags a render, so rapid double clicks could both pass a state check.
  const inFlight = React.useRef(false);

  async function handleClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      onSubmitted(await submitKnowledge(knowledgeId));
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {failure && (
        <div
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm"
        >
          <p>{failure.message}</p>
          {failure.kind === "session" && (
            <Button asChild size="sm" variant="outline">
              <Link href="/auth/login">Sign in</Link>
            </Button>
          )}
        </div>
      )}
      <Button onClick={handleClick} disabled={pending} aria-busy={pending}>
        {pending ? "Submitting..." : "Submit for review"}
      </Button>
    </div>
  );
}
