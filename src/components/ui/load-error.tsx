import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";

/** Accessible copy for a failed read. `noun` is plural, e.g. "projects". */
export function loadErrorMessage(error: ApiError, noun: string): string {
  if (error.kind === "network") {
    return "The service is unreachable right now. Check your connection and try again.";
  }
  if (error.status === 401) return "Your session is no longer valid. Sign in again to continue.";
  if (error.status === 403) return `Your account is not permitted to view ${noun}.`;
  return `We could not load ${noun}. Try again.`;
}

/**
 * Inline, accessible load failure. Server-rendered callers pass
 * `retryHref` (a plain link, server re-render); client-fetched callers
 * pass `onRetry`. A 401 additionally offers sign-in.
 */
export function LoadError({
  message,
  retryHref,
  onRetry,
  signIn,
}: {
  message: string;
  retryHref?: string;
  onRetry?: () => void;
  signIn?: boolean;
}) {
  return (
    <div
      role="alert"
      className="text-destructive border-destructive/30 bg-destructive/5 space-y-3 rounded-md border p-4 text-sm"
    >
      <p>{message}</p>
      <div className="flex flex-wrap gap-2">
        {signIn && (
          <Button asChild size="sm">
            <Link href="/auth/login">Sign in</Link>
          </Button>
        )}
        {retryHref && (
          <Button asChild size="sm" variant="outline">
            <Link href={retryHref}>Try again</Link>
          </Button>
        )}
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
