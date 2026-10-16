"use client";

import Link from "next/link";

import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";

/**
 * Entry points to the authenticated workflow, shown on /learn.
 * Session state decides only whether a link is *worth showing*: "My
 * articles" to signed-in users, "Review queue" to EXPERTs, and "Become an
 * Expert" (application + status) to ordinary USER accounts. ADMIN gets
 * neither Knowledge review nor an application entry here (governance lives
 * under /admin/expert-applications). Routes stay reachable by URL and the
 * backend remains the authority (a non-permitted caller gets its 403
 * rendered there).
 */
export function LearnWorkflowLinks() {
  const { status, user } = useAuth();
  if (status !== "authenticated") return null;
  return (
    <>
      <Button asChild variant="outline">
        <Link href="/learn/mine">My articles</Link>
      </Button>
      {user?.role === "USER" && (
        <Button asChild variant="outline">
          <Link href="/learn/expert-application">Become an Expert</Link>
        </Button>
      )}
      {user?.role === "EXPERT" && (
        <Button asChild variant="outline">
          <Link href="/learn/review">Review queue</Link>
        </Button>
      )}
    </>
  );
}
