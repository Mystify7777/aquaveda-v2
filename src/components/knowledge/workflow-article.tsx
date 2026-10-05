"use client";

import * as React from "react";
import Link from "next/link";

import { KnowledgeReviewActions, type ReviewDecision } from "@/components/knowledge/knowledge-review-actions";
import { KnowledgeReviseForm } from "@/components/knowledge/knowledge-revise-form";
import { KnowledgeSubmitAction } from "@/components/knowledge/knowledge-submit-action";
import { WorkflowArticleView } from "@/components/knowledge/workflow-article-view";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getKnowledgeWorkflow } from "@/lib/api/knowledge";
import { useApiResource } from "@/lib/api/use-api-resource";

/**
 * Workflow detail (GET /knowledge/:id/workflow) with the lifecycle actions
 * that apply to the article's current status.
 *
 * Which controls appear is derived from `status` and whether the viewer
 * is the article's author (session identity, presentation only):
 *   draft            + author      -> submit
 *   rejected         + author      -> revise
 *   pending_review   + not author  -> approve / reject
 * The backend only returns an article to its author, or to an EXPERT
 * while pending, and re-authorizes every write, so this never grants a
 * capability — it avoids rendering controls that can only fail.
 */
export function WorkflowArticle({ knowledgeId }: { knowledgeId: string }) {
  const { user } = useAuth();
  const { resource, reload } = useApiResource(() => getKnowledgeWorkflow(knowledgeId), `wf:${knowledgeId}`);
  const [decision, setDecision] = React.useState<ReviewDecision | null>(null);
  const decisionRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (decision) decisionRef.current?.focus();
  }, [decision]);

  if (resource.status === "loading") {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">Loading article...</span>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (resource.status === "error") {
    const { error } = resource;
    // The backend answers "missing" and "not yours" identically (404); a malformed id is 400.
    if (error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED")) {
      return (
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Article not found</h1>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            This article doesn&apos;t exist, or you don&apos;t have access to it.
          </p>
          <Button asChild>
            <Link href="/learn/mine">Back to your articles</Link>
          </Button>
        </div>
      );
    }
    return (
      <LoadError
        message={loadErrorMessage(error, "this article")}
        onRetry={reload}
        signIn={error.status === 401}
      />
    );
  }

  if (decision) {
    return (
      <div role="status" className="space-y-4">
        <h1 ref={decisionRef} tabIndex={-1} className="font-display text-2xl font-semibold outline-none">
          {decision.decision === "approved" ? "Article approved" : "Article rejected"}
        </h1>
        <p className="text-muted-foreground text-sm">
          &ldquo;{decision.result.title}&rdquo;{" "}
          {decision.decision === "approved"
            ? "is now published."
            : "was returned to its author with your feedback."}
        </p>
        <Button asChild>
          <Link href="/learn/review">Back to review queue</Link>
        </Button>
      </div>
    );
  }

  const article = resource.data;
  const isAuthor = !!user && !!article.author && user.id === article.author._id;

  return (
    <div className="flex flex-col gap-6">
      <WorkflowArticleView article={article} />

      {article.status === "draft" && isAuthor && (
        <section aria-label="Submit for review" className="border-t pt-4">
          <KnowledgeSubmitAction knowledgeId={article._id} onSubmitted={reload} />
        </section>
      )}
      {article.status === "rejected" && isAuthor && (
        <KnowledgeReviseForm
          knowledgeId={article._id}
          initial={{ title: article.title, body: article.body }}
          onRevised={reload}
        />
      )}
      {article.status === "pending_review" && !isAuthor && (
        <KnowledgeReviewActions knowledgeId={article._id} onDecided={setDecision} />
      )}

      {article.status === "approved" && (
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/learn/${article._id}`}>View published article</Link>
        </Button>
      )}
    </div>
  );
}
