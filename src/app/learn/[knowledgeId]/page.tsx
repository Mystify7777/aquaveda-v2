import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CommentThread } from "@/components/comments/comment-thread";
import { DiscussionComposer } from "@/components/comments/discussion-actions";
import { KnowledgeArticleView } from "@/components/knowledge/knowledge-article";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { getKnowledgeArticle } from "@/lib/api/knowledge";

export const metadata: Metadata = { title: "Article" };

/**
 * Public Knowledge detail (#51). The backend returns 404 for anything not
 * approved (drafts are indistinguishable from missing), and 400
 * VALIDATION_FAILED for a malformed ID; both are "not found" to a visitor.
 * The status check below is a defensive boundary, not a lifecycle rule.
 */
export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ knowledgeId: string }>;
}) {
  const { knowledgeId } = await params;
  const href = `/learn/${encodeURIComponent(knowledgeId)}`;

  let article;
  try {
    article = await getKnowledgeArticle(knowledgeId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED")) {
      notFound();
    }
    return (
      <Shell>
        <LoadError message={loadErrorMessage(error, "this article")} retryHref={href} />
      </Shell>
    );
  }

  if (article.status !== "approved") notFound();

  return (
    <Shell>
      <KnowledgeArticleView article={article} />
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
          <CommentThread refType="WIKI" refId={article._id} retryHref={href} />
        </Suspense>
        <DiscussionComposer refType="WIKI" refId={article._id} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Link href="/learn" className="text-muted-foreground hover:text-foreground w-fit text-sm">
        ← All articles
      </Link>
      {children}
    </div>
  );
}
