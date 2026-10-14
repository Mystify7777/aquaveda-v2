"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { CommentComposer } from "@/components/comments/comment-composer";
import { Button } from "@/components/ui/button";
import type { CommentRefType } from "@/lib/api/types/comment";

/** Top-level composer; refreshes the server-rendered thread after a post. */
export function DiscussionComposer({ refType, refId }: { refType: CommentRefType; refId: string }) {
  const router = useRouter();
  return <CommentComposer refType={refType} refId={refId} onCreated={() => router.refresh()} />;
}

/** Disclosure that mounts a reply composer (one nesting level, per the backend contract). */
export function ReplyToggle({
  refType,
  refId,
  parentComment,
  authorName,
}: {
  refType: CommentRefType;
  refId: string;
  parentComment: string;
  authorName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const panelId = React.useId();

  return (
    <div className="space-y-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Reply to ${authorName}`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Cancel reply" : "Reply"}
      </Button>
      <div id={panelId} hidden={!open}>
        {open && (
          <CommentComposer
            refType={refType}
            refId={refId}
            parentComment={parentComment}
            onCreated={() => router.refresh()}
          />
        )}
      </div>
    </div>
  );
}
