import Link from "next/link";

import { NavLink } from "@/components/layout/nav-link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AuthControls } from "@/components/layout/auth-controls";
import { RoleNavLinks } from "@/components/layout/role-nav-links";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const LINK_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-muted relative rounded-md px-3 py-2 text-sm font-medium transition-colors";
// Non-colour cue (underline bar) in addition to the colour change.
const ACTIVE_LINK_CLASS =
  "text-foreground after:bg-primary after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full";

const NAV_ITEMS = [
  { href: "/explore", label: "Explore" },
  { href: "/learn", label: "Learn" },
  { href: "/act", label: "Act" },
  { href: "/community", label: "Community" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

/**
 * Server Component. Only the interactive parts (ThemeToggle, MobileNav,
 * and the per-link NavLink that reads the pathname for active state) are
 * Client Components — they're isolated as deeply as possible in the tree
 * so the Navbar itself ships zero client JS.
 *
 * The same NAV_ITEMS array is defined in both Navbar and MobileNav
 * rather than sharing a module-level const. Sharing it would couple
 * two components that may eventually diverge (mobile nav may get icons
 * or section headings; desktop nav won't). Duplication is acceptable
 * when the things being duplicated might need to evolve independently.
 */
export function Navbar() {
  return (
    <header className="border-border/80 bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="font-display text-foreground flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="bg-primary inline-block size-2.5 rounded-full"
          />
          AquaVeda
        </Link>

        {/* Desktop nav — hidden on mobile */}
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              className={LINK_CLASS}
              activeClassName={ACTIVE_LINK_CLASS}
            >
              {item.label}
            </NavLink>
          ))}
          <RoleNavLinks className={LINK_CLASS} activeClassName={ACTIVE_LINK_CLASS} />
        </nav>

        {/* Right slot — session actions are UX only; public navigation stays available. */}
        <div className="flex items-center gap-1">
          <div className="hidden md:block">
            <AuthControls />
          </div>
          <ThemeToggle className="max-md:size-11" />
          <MobileNav />
        </div>
      </div>
      <div className="contour-rule" aria-hidden="true" />
    </header>
  );
}
