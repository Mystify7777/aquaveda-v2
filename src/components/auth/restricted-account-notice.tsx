"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { RESTRICTION_NOTICE, type AccountRestriction } from "@/lib/api/account-restriction";

/**
 * State-specific presentation of a backend-reported account restriction.
 * Muted: explanation only (reading still works). Suspended: explanation plus
 * the existing sign-out path (`useAuth().logout`, the auth contract's
 * logout endpoint, which stays reachable while suspended). No appeal or
 * recovery policy is implied (#176), and no governance detail is shown.
 */
export function RestrictedAccountNotice({
  restriction,
  className,
  variant = "inline",
}: {
  restriction: AccountRestriction;
  className?: string;
  /**
   * `banner` is the persistent, app-wide presentation (#251): a muted notice is a
   * polite `status`, not an interrupting `alert`. Content and sign-out are shared.
   */
  variant?: "inline" | "banner";
}) {
  const { title, message } = RESTRICTION_NOTICE[restriction];
  return (
    <div
      role={variant === "banner" && restriction === "muted" ? "status" : "alert"}
      data-restriction={restriction}
      className={
        className ?? "border-warning/40 bg-warning/5 space-y-4 rounded-lg border p-5 text-sm sm:p-6"
      }
    >
      <div className="space-y-1.5">
        <h2 className="text-foreground font-display text-base font-semibold">{title}</h2>
        <p className="text-foreground/80 leading-relaxed">{message}</p>
      </div>
      {restriction === "suspended" && <SignOutAction />}
    </div>
  );
}

function SignOutAction() {
  const { logout } = useAuth();
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => void signOut()} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          We could not sign you out. Check your connection and try again.
        </p>
      )}
    </div>
  );
}
