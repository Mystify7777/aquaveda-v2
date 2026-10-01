"use client";

import Link from "next/link";

import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";

/**
 * Entry points to the authenticated workflow, shown on /learn.
 * Session state decides only whether a link is *worth showing*: "My
 * articles" to signed-in users, "Review queue" to EXPERTs. The queue
 * route stays reachable by URL and the backend remains the authority
 * (a non-EXPERT gets its 403 rendered there).
 */
export function LearnWorkflowLinks() {
  const { status, user } = useAuth();
  if (status !== "authenticated") return null;
  return (
    <>
      <Button asChild variant="outline">
        <Link href="/protected/learn/mine">My articles</Link>
      </Button>
      {user?.role === "EXPERT" && (
        <Button asChild variant="outline">
          <Link href="/protected/learn/review">Review queue</Link>
        </Button>
      )}
    </>
  );
}
