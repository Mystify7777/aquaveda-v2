"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NavLink } from "@/components/layout/nav-link";
import { AuthControls } from "@/components/layout/auth-controls";
import { RoleNavLinks } from "@/components/layout/role-nav-links";
import { cn } from "@/lib/utils";

// 44px minimum touch target (min-h-11); active state adds a non-colour marker.
const LINK_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-muted relative flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors";
const ACTIVE_LINK_CLASS =
  "text-foreground bg-muted after:bg-primary after:absolute after:inset-y-2 after:left-0 after:w-0.5 after:rounded-full";

/** Viewport at which the drawer trigger disappears (Tailwind `md`). */
const DESKTOP_QUERY = "(min-width: 768px)";

const NAV_ITEMS = [
  { href: "/explore", label: "Explore" },
  { href: "/learn", label: "Learn" },
  { href: "/act", label: "Act" },
  { href: "/community", label: "Community" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

/**
 * Mobile navigation drawer — visible on screens smaller than md breakpoint.
 * Uses Radix Dialog directly (not a Sheet abstraction) because we don't
 * have Sheet in the primitive library yet — and we don't need Sheet as a
 * separate primitive just to make this work. If Sheet gets added later for
 * feature use (e.g. the Explore issue panel on mobile), it can share the
 * same Radix Dialog base. Building a generic abstraction now when one
 * concrete use case exists would be premature.
 *
 * Closes when: the route changes; any link inside the drawer is activated
 * (including a link to the current route, which does not change the
 * pathname); Escape / overlay / close button (Radix); or the viewport
 * grows to desktop width while open (the trigger is hidden there, so the
 * dialog would otherwise be stuck open with scroll lock and inert page).
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close on navigation. Deliberately not a useEffect — this is "adjusting
  // state when a prop/derived value changes," which React's own guidance
  // says to do during render (bailing out via the prevPathname comparison
  // below) rather than in an effect body, where the extra setState causes
  // a second, cascading render after the one for the pathname change
  // itself.
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-4" />
        </Button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        {/* Backdrop */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        {/* Drawer — slides in from the left */}
        <DialogPrimitive.Content
          // No visible description: opt out explicitly instead of Radix's warning.
          aria-describedby={undefined}
          // Activating any link inside the drawer closes it, even when the
          // target is the current route (pathname unchanged → no route-change close).
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-full w-3/4 max-w-xs flex-col overflow-y-auto overflow-x-hidden",
            "bg-background border-r shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-left",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left",
            "duration-300",
          )}
        >
          {/* Screen-reader title — required by Radix Dialog for a11y */}
          <DialogPrimitive.Title className="sr-only">
            Navigation menu
          </DialogPrimitive.Title>

          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Link
              href="/"
              className="font-display flex min-h-11 items-center gap-2 text-base font-semibold tracking-tight"
            >
              <span
                aria-hidden="true"
                className="bg-primary inline-block size-2.5 rounded-full"
              />
              AquaVeda
            </Link>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Close navigation menu"
              >
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Nav links */}
          <nav aria-label="Mobile primary" className="flex flex-col gap-1 p-4">
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

          <div className="mt-auto border-t p-4">
            <AuthControls mobile />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
