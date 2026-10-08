"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

const RESET_MS = 2500;

/**
 * Copies the canonical Issue `_id` — the exact value POST /api/v1/projects
 * expects as `originIssue`. Clipboard failure (insecure context, denied
 * permission) is reported inline and never blocks the surrounding surface;
 * the ID stays visible/selectable as a manual fallback when `showId`.
 */
export function CopyIssueId({ issueId, showId = false }: { issueId: string; showId?: boolean }) {
  const [state, setState] = React.useState<CopyState>("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(issueId);
    } catch {
      // Also covers navigator.clipboard being undefined (TypeError).
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {showId && <code className="font-mono text-sm select-all">{issueId}</code>}
      <Button
        type="button"
        variant="outline"
        size={showId ? "sm" : "icon"}
        className={showId ? undefined : "size-7"}
        onClick={copy}
        aria-label={showId ? undefined : "Copy issue ID"}
        title="Copy issue ID"
      >
        {state === "copied" ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {showId && (state === "copied" ? "Copied" : "Copy ID")}
      </Button>
      <span role="status" className={state === "failed" ? "text-destructive text-xs" : "sr-only"}>
        {state === "copied" && "Issue ID copied"}
        {state === "failed" && "Could not copy — select the ID and copy it manually."}
      </span>
    </span>
  );
}
