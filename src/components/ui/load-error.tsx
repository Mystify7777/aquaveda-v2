import Link from "next/link";

import { Button } from "@/components/ui/button";
import { RestrictedAccountNotice } from "@/components/auth/restricted-account-notice";
import { getAccountRestriction, RESTRICTION_NOTICE } from "@/lib/api/account-restriction";
import { ApiError, isApiTimeout } from "@/lib/api/client";

/** Accessible copy for a failed read. `noun` is plural, e.g. "projects". */
export function loadErrorMessage(error: ApiError, noun: string): string {
  if (isApiTimeout(error)) {
    return "The service is taking longer than usual to respond. Please try again.";
  }
  if (error.kind === "network") {
    return "The service is unreachable right now. Check your connection and try again.";
  }
  if (error.status === 401) return "Your session is no longer valid. Sign in again to continue.";
  const restriction = getAccountRestriction(error);
  if (restriction) {
    const { title, message } = RESTRICTION_NOTICE[restriction];
    return `${title}. ${message}`;
  }
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
  title,
  retryHref,
  onRetry,
  signIn,
  error,
}: {
  message: string;
  /** Optional context-specific heading for surfaces that need stronger hierarchy. */
  title?: string;
  retryHref?: string;
  onRetry?: () => void;
  signIn?: boolean;
  /** The failure behind `message`: an account restriction (muted/suspended) replaces the generic alert. */
  error?: unknown;
}) {
  const restriction = getAccountRestriction(error);
  if (restriction) return <RestrictedAccountNotice restriction={restriction} />;
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 space-y-4 rounded-lg border p-5 text-sm sm:p-6"
    >
      <div className="space-y-1.5">
        {title && (
          <h2 className="text-foreground font-display text-base font-semibold">
            {title}
          </h2>
        )}
        <p className="text-destructive leading-relaxed">{message}</p>
      </div>
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
