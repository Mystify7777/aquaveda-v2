import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";

export function projectLoadErrorMessage(error: ApiError): string {
  return error.kind === "network"
    ? "The service is unreachable right now. Check your connection and try again."
    : "We could not load projects. Try again.";
}

/** Inline, accessible load failure. Retry is a plain link to the same URL (server re-render). */
export function ProjectLoadError({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <div
      role="alert"
      className="text-destructive border-destructive/30 bg-destructive/5 space-y-3 rounded-md border p-4 text-sm"
    >
      <p>{message}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={retryHref}>Try again</Link>
      </Button>
    </div>
  );
}
