"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthControls } from "@/components/layout/auth-controls";
import { cn } from "@/lib/utils";

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
 * Closes automatically on route change (usePathname effect) so tapping a
 * nav link dismisses the drawer without needing a separate close handler
 * on each Link.
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
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
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-full w-3/4 max-w-xs flex-col",
            "bg-background border-r shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-left",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left",
            "duration-300",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Link
              href="/"
              className="font-display flex items-center gap-2 text-base font-semibold tracking-tight"
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
                aria-label="Close navigation menu"
              >
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Nav links */}
          <nav aria-label="Mobile primary" className="flex flex-col gap-1 p-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-muted-foreground hover:text-foreground hover:bg-muted",
                  "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  // Active state — pathname match
                  pathname === item.href && "text-foreground bg-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t p-4">
            <AuthControls mobile />
          </div>

          {/* Screen-reader title — required by Radix Dialog for a11y */}
          <DialogPrimitive.Title className="sr-only">
            Navigation menu
          </DialogPrimitive.Title>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
