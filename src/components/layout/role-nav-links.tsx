"use client";

import Link from "next/link";

import { useExpertStatus } from "@/components/expert/expert-status-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { navIndicator } from "@/lib/expert/nav-indicator";
import { getRoleLinks } from "@/lib/expert/role-links";
import { cn } from "@/lib/utils";

/**
 * Role-aware entries appended to the primary navigation. Shown only to an
 * authenticated session; the role decides which link is worth showing (plus a
 * small status chip from the shared Expert status, neutral whenever that is not
 * ready and current) and nothing more — the target routes surface the backend's own refusal if an
 * unauthorized user navigates there directly.
 */
export function RoleNavLinks({
  className,
  currentPath,
}: {
  className: string;
  currentPath?: string;
}) {
  const { status, user } = useAuth();
  const expert = useExpertStatus();
  if (status !== "authenticated") return null;
  const indicator = navIndicator(user?.role, expert);

  return (
    <>
      {getRoleLinks(user?.role).map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(className, currentPath === link.href && "text-foreground bg-muted")}
          aria-current={currentPath === link.href ? "page" : undefined}
        >
          {link.label}
          {indicator && (
            <>
              <span
                aria-hidden="true"
                className="bg-primary/10 text-foreground ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
              >
                {indicator.text}
              </span>
              <span className="sr-only">, {indicator.screenReaderText}</span>
            </>
          )}
        </Link>
      ))}
    </>
  );
}
