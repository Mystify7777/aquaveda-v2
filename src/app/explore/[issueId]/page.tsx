import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CommentThread } from "@/components/comments/comment-thread";
import { DiscussionComposer } from "@/components/comments/discussion-actions";
import { IssueDetail } from "@/components/issues/issue-detail";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { getIssue } from "@/lib/api/issues";

export const metadata: Metadata = { title: "Issue" };

/**
 * Public Issue detail (#50). 404 (unknown) and 400 VALIDATION_FAILED
 * (malformed id) both mean "no such issue" to a visitor; transport/server
 * failures are a retryable alert. The discussion (ISSUE comments, #48 read
 * contract + #46 composer) is mounted per the approved plan.
 */
export default async function IssuePage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  const href = `/explore/${encodeURIComponent(issueId)}`;

  let issue;
  try {
    issue = await getIssue(issueId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED")) {
      notFound();
    }
    return (
      <Shell>
        <LoadError message={loadErrorMessage(error, "this issue")} retryHref={href} />
      </Shell>
    );
  }

  return (
    <Shell>
      <IssueDetail issue={issue} />
      <section aria-labelledby="discussion-heading" className="space-y-4 border-t pt-6">
        <h2 id="discussion-heading" className="font-display text-xl font-semibold">
          Discussion
        </h2>
        <Suspense
          fallback={
            <div role="status">
              <span className="sr-only">Loading comments...</span>
              <Skeleton className="h-16 w-full" />
            </div>
          }
        >
          <CommentThread refType="ISSUE" refId={issue._id} retryHref={href} />
        </Suspense>
        <DiscussionComposer refType="ISSUE" refId={issue._id} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Link href="/explore" className="text-muted-foreground hover:text-foreground w-fit text-sm">
        ← All issues
      </Link>
      {children}
    </div>
  );
}
