"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ariaCurrentFor, matchNavPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Navigation link that knows whether it is the current route. A tiny Client
 * Component so the Navbar itself can stay a Server Component: only the link
 * reads `usePathname`. Any match (exact or nested) gets `activeClassName`;
 * only an exact match exposes `aria-current="page"` (see `lib/navigation.ts`).
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
      aria-current={ariaCurrentFor(match)}
    >
      {children}
    </Link>
  );
}
