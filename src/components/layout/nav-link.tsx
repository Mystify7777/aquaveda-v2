"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { matchNavPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Navigation link that knows whether it is the current route. A tiny Client
 * Component so the Navbar itself can stay a Server Component: only the link
 * reads `usePathname`. Exact match → `aria-current="page"`; a nested route of
 * the link's section → `aria-current="true"`. Both get `activeClassName`.
 */
export function NavLink({
  href,
  className,
  activeClassName,
  children,
}: {
  href: string;
  className: string;
  activeClassName: string;
  children: React.ReactNode;
}) {
  const match = matchNavPath(usePathname(), href);
  return (
    <Link
      href={href}
      className={cn(className, match && activeClassName)}
      aria-current={
        match === "page" ? "page" : match === "section" ? "true" : undefined
      }
    >
      {children}
    </Link>
  );
}
