import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CommentThread } from "@/components/comments/comment-thread";
import { DiscussionComposer } from "@/components/comments/discussion-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { getDiscussion } from "@/lib/api/discussions";
import { formatDate } from "@/lib/format-date";
import { cleanMetadataText, publicPageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ discussionId: string }>;
}): Promise<Metadata> {
  const { discussionId } = await params;
  const canonical = `/community/discussions/${encodeURIComponent(discussionId)}`;

  try {
    const discussion = await getDiscussion(discussionId);
    return publicPageMetadata({
      title: discussion.title,
      description: cleanMetadataText(discussion.body),
      canonical,
      type: "article",
    });
  } catch {
    return publicPageMetadata({
      title: "Discussion",
      description: "Public community discussion on AquaVeda.",
      canonical,
      type: "article",
    });
  }
}

function categoryLabel(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default async function DiscussionPage({ params }: { params: Promise<{ discussionId: string }> }) {
  const { discussionId } = await params;
  const href = "/community/discussions/" + encodeURIComponent(discussionId);

  let discussion;
  try {
    discussion = await getDiscussion(discussionId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED")) notFound();
    return <Shell><LoadError message={loadErrorMessage(error, "this discussion")} retryHref={href} /></Shell>;
  }

  if (discussion.status !== "ACTIVE") notFound();

  return (
    <Shell>
      <Link href="/community" className="text-muted-foreground hover:text-foreground w-fit text-sm">← Community</Link>
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="bg-primary/10 text-foreground rounded-full px-2.5 py-1 text-xs font-medium">{categoryLabel(discussion.category)}</span>
            <time className="text-muted-foreground text-xs" dateTime={discussion.createdAt}>{formatDate(discussion.createdAt)}</time>
          </div>
          <CardTitle className="text-2xl leading-tight sm:text-3xl">{discussion.title}</CardTitle>
          <p className="text-muted-foreground text-sm">By {discussion.author?.name ?? "Unknown author"}</p>
        </CardHeader>
        <CardContent><p className="whitespace-pre-wrap text-sm leading-7">{discussion.body}</p></CardContent>
      </Card>

      <section aria-labelledby="discussion-heading" className="space-y-4 border-t pt-6">
        <div>
          <h2 id="discussion-heading" className="font-display text-xl font-semibold">Conversation</h2>
          <p className="text-muted-foreground mt-1 text-sm">Public reading is available to everyone. Replies are limited to one level.</p>
        </div>
        <Suspense fallback={<div role="status"><span className="sr-only">Loading comments...</span><Skeleton className="h-20 w-full" /></div>}>
          <CommentThread refType="DISCUSSION" refId={discussion._id} retryHref={href} />
        </Suspense>
        <DiscussionComposer refType="DISCUSSION" refId={discussion._id} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">{children}</div>;
}