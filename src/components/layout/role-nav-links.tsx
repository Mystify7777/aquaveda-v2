"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useExpertStatus } from "@/components/expert/expert-status-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { navIndicator } from "@/lib/expert/nav-indicator";
import { getRoleLinks } from "@/lib/expert/role-links";
import { matchNavPath } from "@/lib/navigation";
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
  activeClassName,
}: {
  className: string;
  activeClassName?: string;
}) {
  const pathname = usePathname();
  const { status, user } = useAuth();
  const expert = useExpertStatus();
  if (status !== "authenticated") return null;
  const indicator = navIndicator(user?.role, expert);

  return (
    <>
      {getRoleLinks(user?.role).map((link) => {
        const match = matchNavPath(pathname, link.href);
        return (
        <Link
          key={link.href}
          href={link.href}
          className={cn(className, match && activeClassName)}
          aria-current={match === "page" ? "page" : match === "section" ? "true" : undefined}
          // The status is part of the link's NAME via aria-label, not via an
          // `sr-only` child: browsers treat an absolutely-positioned child as
          // block-level and insert spaces around its text ("Become an Expert ,
          // application pending..."), so a child-derived name depends on CSS.
          // The label starts with the visible text, so it also satisfies
          // label-in-name.
          aria-label={indicator ? `${link.label}, ${indicator.screenReaderText}` : undefined}
        >
          {link.label}
          {indicator && (
            <span
              aria-hidden="true"
              className="bg-primary/10 text-foreground ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              {indicator.text}
            </span>
          )}
        </Link>
        );
      })}
    </>
  );
}
