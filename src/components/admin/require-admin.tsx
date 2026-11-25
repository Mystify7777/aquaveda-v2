"use client";

import * as React from "react";

import { useAuth } from "@/components/providers/auth-provider";

/**
 * Presentation gate for the Admin governance surface (#250). The authentication
 * boundary stays `(protected)/layout.tsx` (RequireAuth); this adds only the
 * role-appropriate UX: a signed-in non-ADMIN sees an access message and NO
 * request is made for them. It is NOT authorization: the backend (ADMIN only) is
 * the authority and its refusal is still rendered by the views below.
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  if (status !== "authenticated") return null; // RequireAuth renders every other session state
  if (user?.role !== "ADMIN") {
    return (
      <div role="alert" className="border-border space-y-1 rounded-lg border p-5 text-sm">
        <h2 className="font-display text-base font-semibold">Administrator access required</h2>
        <p className="text-muted-foreground">Account governance is available to administrators only.</p>
      </div>
    );
  }
  return <>{children}</>;
}
