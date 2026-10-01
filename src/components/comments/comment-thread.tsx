import { ReplyToggle } from "@/components/comments/discussion-actions";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { ApiError } from "@/lib/api/client";
import { getCommentThread } from "@/lib/api/comments";
import { formatDate } from "@/lib/format-date";
import type { Comment, CommentRefType } from "@/lib/api/types/comment";

function CommentBody({ comment }: { comment: Comment }) {
  return (
    <>
      <p className="text-muted-foreground text-xs">
        {comment.author.name} · <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
      </p>
      <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
    </>
  );
}

/**
 * Read-only thread over GET /api/v1/comments?refType&refId: top-level
 * comments with at most one level of `replies`. Async Server Component;
 * a read failure degrades to an inline alert without affecting the page.
 */
export async function CommentThread({
  refType,
  refId,
  retryHref,
}: {
  refType: CommentRefType;
  refId: string;
  retryHref: string;
}) {
  let comments: Comment[];
  try {
    comments = await getCommentThread(refType, refId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return <LoadError message={loadErrorMessage(error, "comments")} retryHref={retryHref} />;
  }

  if (comments.length === 0) {
    return <p className="text-muted-foreground text-sm">No comments yet. Start the discussion.</p>;
  }

  return (
    <ul className="space-y-6">
      {comments.map((comment) => (
        <li key={comment._id} className="space-y-2">
          <CommentBody comment={comment} />
          {comment.replies.length > 0 && (
            <ul aria-label={`Replies to ${comment.author.name}`} className="border-l-2 space-y-4 pl-4">
              {comment.replies.map((reply) => (
                <li key={reply._id} className="space-y-1">
                  <CommentBody comment={reply} />
                </li>
              ))}
            </ul>
          )}
          <ReplyToggle
            refType={refType}
            refId={refId}
            parentComment={comment._id}
            authorName={comment.author.name}
          />
        </li>
      ))}
    </ul>
  );
}
