"use client";

import Link from "next/link";

import { useAuth } from "@/components/providers/auth-provider";
import { getRoleLinks } from "@/lib/expert/role-links";
import { cn } from "@/lib/utils";

/**
 * Role-aware entries appended to the primary navigation. Shown only to an
 * authenticated session; the role decides which link is worth showing and
 * nothing more — the target routes surface the backend's own refusal if an
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
  if (status !== "authenticated") return null;

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
        </Link>
      ))}
    </>
  );
}
