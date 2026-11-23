"use client";

import { RestrictedAccountNotice } from "@/components/auth/restricted-account-notice";
import { useAuth } from "@/components/providers/auth-provider";

/**
 * App-wide account-restriction surface (#251), driven by the session bootstrap
 * (`useAuth().restriction`). Reuses the #248 notice: one presentation, no second
 * wording. Renders nothing for active, anonymous, loading and failure states.
 */
export function AccountRestrictionBanner() {
  const { restriction } = useAuth();
  if (!restriction) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
      <RestrictedAccountNotice restriction={restriction} variant="banner" />
    </div>
  );
}
