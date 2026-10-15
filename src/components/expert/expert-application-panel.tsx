"use client";

import * as React from "react";
import Link from "next/link";

import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { applyForExpert, getMyExpertApplication } from "@/lib/api/expert-application";
import type { MyExpertApplication } from "@/lib/api/types/expert-application";
import { useApiResource } from "@/lib/api/use-api-resource";
import { toExpertActionFailure, type ExpertActionFailure } from "@/lib/expert/action-failure";
import { KNOWLEDGE_REVIEW_HREF } from "@/lib/expert/role-links";
import { EXPERT_STATUS_LABELS } from "@/lib/expert/status";
import { formatDate } from "@/lib/format-date";

function History({ application }: { application: MyExpertApplication }) {
  if (application.history.length === 0) return null;
  return (
    <section aria-label="Application history" className="space-y-2">
      <h2 className="font-display text-lg font-semibold">History</h2>
      <ol className="space-y-1 text-sm">
        {application.history.map((entry, i) => (
          <li key={`${entry.timestamp}-${i}`} className="text-muted-foreground">
            {formatDate(entry.timestamp)} — {EXPERT_STATUS_LABELS[entry.toStatus]}
            {entry.note ? <span className="text-foreground"> · “{entry.note}”</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The signed-in user's Expert application: apply, and see the current state.
 * Applicant identity is always the session; the only request is an empty POST.
 * Eligibility shown here (USER and none/rejected) is UX — the backend decides
 * (a non-USER gets 403, a pending/approved applicant gets INVALID_STATE).
 */
export function ExpertApplicationPanel() {
  const { user } = useAuth();
  const { resource, reload } = useApiResource(getMyExpertApplication, "expert-application:me");
  const [submitted, setSubmitted] = React.useState<MyExpertApplication | null>(null);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ExpertActionFailure | null>(null);
  const inFlight = React.useRef(false); // state lags a render; this blocks double-submits

  async function apply() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      setSubmitted(await applyForExpert());
    } catch (error) {
      const next = toExpertActionFailure(error, "apply");
      setFailure(next);
      if (next.kind === "stale") {
        setSubmitted(null);
        reload(); // our view was out of date; show the real state
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (resource.status === "loading") {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading your application...</span>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }
  if (resource.status === "error") {
    return (
      <LoadError
        message={loadErrorMessage(resource.error, "your Expert application")}
        onRetry={reload}
        signIn={resource.error.status === 401}
      />
    );
  }

  const application = submitted ?? resource.data;
  const role = user?.role;
  const canApply = role === "USER" && (application.status === "none" || application.status === "rejected");
  const rejection = application.status === "rejected" ? application.history.at(-1) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold">Your application</h2>
        <Badge variant={application.status === "approved" ? "default" : "outline"}>
          {application.status === "none" ? "Not applied" : EXPERT_STATUS_LABELS[application.status]}
        </Badge>
      </div>

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

      {application.status === "none" && (
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          {role === "USER"
            ? "Experts review Knowledge articles submitted by the community. An administrator reviews each request; you gain Expert access only if it is approved."
            : "Applications are for member accounts. Your account already has elevated access."}
        </p>
      )}

      {application.status === "pending" && (
        <p role="status" className="text-sm leading-relaxed">
          Your application is awaiting review by an administrator. You will gain Expert access if it is approved.
        </p>
      )}

      {application.status === "rejected" && (
        <div className="space-y-1 text-sm leading-relaxed">
          <p>Your application was not approved.</p>
          {rejection?.note && (
            <p className="text-muted-foreground">
              Reviewer note: <span className="text-foreground">“{rejection.note}”</span>
            </p>
          )}
          {canApply && <p className="text-muted-foreground">You may apply again.</p>}
        </div>
      )}

      {application.status === "approved" && (
        <div className="space-y-3 text-sm leading-relaxed">
          <p role="status">Your application was approved. You are a verified Expert.</p>
          {role === "EXPERT" ? (
            <Button asChild>
              <Link href={KNOWLEDGE_REVIEW_HREF}>Open the review queue</Link>
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                Reload to activate Expert tools in this session.
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          )}
        </div>
      )}

      {canApply && (
        <Button onClick={() => void apply()} disabled={pending} aria-busy={pending}>
          {pending
            ? "Submitting..."
            : application.status === "rejected"
              ? "Apply again"
              : "Apply to become an Expert"}
        </Button>
      )}

      <History application={application} />
    </div>
  );
}
