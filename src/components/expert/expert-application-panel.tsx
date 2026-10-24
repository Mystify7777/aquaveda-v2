"use client";

import * as React from "react";
import Link from "next/link";

import { ExpertApplicationForm } from "@/components/expert/expert-application-form";
import { ExpertApplicationTimeline } from "@/components/expert/expert-application-timeline";
import { useExpertStatus } from "@/components/expert/expert-status-provider";
import { SubmissionDetails } from "@/components/expert/submission-details";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { applyForExpert } from "@/lib/api/expert-application";
import type { ExpertSubmissionRequest } from "@/lib/api/types/expert-application";
import { toExpertActionFailure, type ExpertActionFailure } from "@/lib/expert/action-failure";
import { KNOWLEDGE_REVIEW_HREF } from "@/lib/expert/role-links";
import { EXPERT_STATUS_LABELS } from "@/lib/expert/status";
import { draftFromSubmission } from "@/lib/expert/submission-form";
import { latestSubmission } from "@/lib/expert/timeline";

const LEGACY_PENDING = "Submitted before application details were collected, so there are no details to show.";

function Intro() {
  return (
    <section aria-label="About Expert status" className="space-y-2 text-sm leading-relaxed">
      <p>Experts review the Knowledge articles that community members submit.</p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>An administrator reviews each application; you gain Expert access only if it is approved.</li>
        <li>Approval grants Knowledge review access only, not administrator powers.</li>
        <li>What you write below is read by administrators when they decide. It is not shown publicly.</li>
      </ul>
    </section>
  );
}

/**
 * The signed-in user's Expert application: details form, status, timeline.
 * Status comes from the single shared provider (the nav chip reads the same
 * source). Applicant identity is always the session; eligibility shown here
 * is UX only: the backend decides (a non-USER gets 403, a pending/approved
 * applicant gets INVALID_STATE). Approval is reflected without a reload by
 * re-reading the session user (`refreshUser`).
 */
export function ExpertApplicationPanel() {
  const { user, refreshUser } = useAuth();
  const expert = useExpertStatus();
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ExpertActionFailure | null>(null);
  const [activation, setActivation] = React.useState<"idle" | "failed">("idle");
  const inFlight = React.useRef(false); // state lags a render; this blocks double-submits
  const activationTried = React.useRef<string | null>(null);

  const role = user?.role;
  const application = expert.application;
  const approvedButStillUser = role === "USER" && application?.status === "approved";

  const activate = React.useCallback(async () => {
    setActivation("idle");
    const next = await refreshUser();
    if (!next || next.role === "USER") setActivation("failed");
  }, [refreshUser]);

  React.useEffect(() => {
    if (!approvedButStillUser || !user || activationTried.current === user.id) return;
    activationTried.current = user.id;
    void activate();
  }, [approvedButStillUser, user, activate]);

  async function apply(request: ExpertSubmissionRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      expert.setApplication(await applyForExpert(request));
    } catch (error) {
      const next = toExpertActionFailure(error, "apply");
      setFailure(next);
      if (next.kind === "stale") void expert.refresh(); // our view was out of date; show the real state
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (role === "EXPERT") {
    return (
      <div className="space-y-3 text-sm leading-relaxed">
        <p role="status">You are a verified Expert.</p>
        <Button asChild>
          <Link href={KNOWLEDGE_REVIEW_HREF}>Open the review queue</Link>
        </Button>
      </div>
    );
  }
  if (role !== "USER") {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        Applications are for member accounts. Your account already has elevated access.
      </p>
    );
  }

  if (expert.status === "idle" || expert.status === "loading") {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading your application...</span>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }
  if (expert.status === "error" || !application) {
    const error = expert.error;
    return (
      <LoadError
        message={error ? loadErrorMessage(error, "your Expert application") : "We could not load your Expert application. Try again."}
        onRetry={() => void expert.refresh()}
        signIn={error?.status === 401}
      />
    );
  }

  const rejection = application.status === "rejected" ? application.history.at(-1) : undefined;
  const submission = latestSubmission(application.history);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold">Your application</h2>
        <Badge variant={application.status === "approved" ? "default" : "outline"}>
          {application.status === "none" ? "Not applied" : EXPERT_STATUS_LABELS[application.status]}
        </Badge>
      </div>

      {expert.stale && (
        <div role="status" className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span>This may be out of date: we could not refresh it just now.</span>
          <Button size="sm" variant="outline" onClick={() => void expert.refresh()}>
            Try again
          </Button>
        </div>
      )}

      {application.status === "none" && (
        <>
          <Intro />
          <ExpertApplicationForm pending={pending} failure={failure} submitLabel="Submit application" onSubmit={(r) => void apply(r)} />
        </>
      )}

      {application.status === "pending" && (
        <>
          <p role="status" className="text-sm leading-relaxed">
            Your application is awaiting review by an administrator. You will gain Expert access if it is approved.
          </p>
          <section aria-label="Your submission" className="space-y-2">
            <h2 className="font-display text-lg font-semibold">What you submitted</h2>
            <SubmissionDetails submission={submission} legacyMessage={LEGACY_PENDING} />
          </section>
        </>
      )}

      {application.status === "rejected" && (
        <>
          <div className="space-y-1 text-sm leading-relaxed">
            <p>Your application was not approved.</p>
            {rejection?.note && (
              <p className="text-muted-foreground">
                Reviewer note: <span className="text-foreground">“{rejection.note}”</span>
              </p>
            )}
          </div>
          <section aria-label="Apply again" className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Apply again</h2>
            <p className="text-muted-foreground text-sm">
              {submission
                ? "Your previous answers are filled in so you can improve them. You will need to accept the acknowledgement again."
                : "Tell us about your experience below."}
            </p>
            <ExpertApplicationForm
              key={application.history.length}
              initial={draftFromSubmission(submission)}
              pending={pending}
              failure={failure}
              submitLabel="Apply again"
              onSubmit={(r) => void apply(r)}
            />
          </section>
        </>
      )}

      {application.status === "approved" && (
        <div className="space-y-3 text-sm leading-relaxed">
          <p role="status">Your application was approved. You are a verified Expert.</p>
          {activation === "failed" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">We could not activate your Expert tools just now.</p>
              <Button variant="outline" onClick={() => void activate()}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Activating your Expert tools...</p>
          )}
        </div>
      )}

      <ExpertApplicationTimeline status={application.status} history={application.history} />
    </div>
  );
}
