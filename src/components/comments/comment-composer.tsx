"use client";

import * as React from "react";
import Link from "next/link";

import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { createComment } from "@/lib/api/comments";
import type { CommentRefType, CreatedComment } from "@/lib/api/types/comment";

export interface CommentComposerProps {
  /** Comment target, exactly as the backend contract defines it. */
  refType: CommentRefType;
  refId: string;
  /** Set only when composing a reply; passed through unchanged. */
  parentComment?: string;
  /** Called once after a successful post (e.g. to refresh a server-rendered thread). */
  onCreated?: (comment: CreatedComment) => void;
}

type SubmitFailure = {
  kind: "validation" | "failure" | "unavailable" | "session";
  message: string;
};

function toFailure(error: unknown): SubmitFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return {
        kind: "unavailable",
        message:
          "The service is unreachable right now. Your comment is still here — check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return {
        kind: "session",
        message: "Your session is no longer valid. Sign in again to post this comment.",
      };
    }
    if (error.code === "VALIDATION_FAILED") {
      return { kind: "validation", message: error.message };
    }
    if (error.code === "TARGET_NOT_FOUND") {
      return { kind: "failure", message: "The item you are commenting on could not be found." };
    }
    if (error.code === "INVALID_PARENT") {
      return { kind: "failure", message: "The comment you are replying to is no longer available." };
    }
    if (error.kind === "response") {
      return { kind: "failure", message: "The service returned an unexpected response. Try again." };
    }
  }
  return { kind: "failure", message: "We could not post your comment. Try again." };
}

function ComposerForm({ refType, refId, parentComment, onCreated }: CommentComposerProps) {
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;

  const [body, setBody] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<SubmitFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedComment | null>(null);

  // Ref guard: `pending` state lags a render, so rapid double submits could both pass a state check.
  const inFlight = React.useRef(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const successRef = React.useRef<HTMLParagraphElement>(null);

  React.useEffect(() => {
    if (created) successRef.current?.focus();
  }, [created]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setFailure(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setFieldError("Comment is required.");
      textareaRef.current?.focus();
      return;
    }
    setFieldError(null);

    inFlight.current = true;
    setPending(true);
    try {
      const comment = await createComment({
        refType,
        refId,
        body: trimmed,
        ...(parentComment ? { parentComment } : {}),
      });
      setCreated(comment);
      onCreated?.(comment);
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function composeAnother() {
    setBody("");
    setFieldError(null);
    setFailure(null);
    setCreated(null);
  }

  if (created) {
    return (
      <div className="space-y-3" role="status">
        <p ref={successRef} tabIndex={-1} className="text-sm font-medium outline-none">
          Comment posted.
        </p>
        <Button variant="outline" size="sm" onClick={composeAnother}>
          Write another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={pending} className="space-y-3">
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

      <fieldset disabled={pending} className="space-y-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Comment
        </label>
        <Textarea
          id={fieldId}
          ref={textareaRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={!!fieldError}
          aria-describedby={fieldError ? errorId : undefined}
          aria-required="true"
        />
        {fieldError && (
          <p id={errorId} className="text-destructive text-xs">
            {fieldError}
          </p>
        )}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Posting..." : "Post comment"}
      </Button>
    </form>
  );
}

/**
 * Reusable comment composer over POST /api/v1/comments. Target-agnostic:
 * the (refType, refId) reference comes in via props. Self-gating via
 * RequireAuth so it is safe to mount on public surfaces; backend
 * authorization remains authoritative. Write-side only — no thread/list.
 */
export function CommentComposer(props: CommentComposerProps) {
  return (
    <RequireAuth>
      <ComposerForm {...props} />
    </RequireAuth>
  );
}
