"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Client-only mount flag via useSyncExternalStore rather than the classic
 * `useState(false) + useEffect(() => setState(true))` pattern — the
 * latter calls setState synchronously inside an effect body, which
 * react-hooks/set-state-in-effect now flags because it causes a
 * cascading extra render. useSyncExternalStore's getServerSnapshot vs.
 * getSnapshot split expresses "different value on server vs. client"
 * directly, without ever calling setState from an effect.
 *
 * subscribe is a no-op: mount status changes exactly once and reading it
 * again after mount can't produce a different value, so there's nothing
 * to resubscribe to.
 */
function useMounted() {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Must be a Client Component — it reads resolvedTheme from localStorage
 * via next-themes, which only exists in the browser.
 *
 * The mounted guard is not optional. Without it:
 * - Server renders with resolvedTheme === undefined
 * - Client renders with "dark" or "light"
 * - React flags a hydration mismatch and either logs an error or
 *   silently produces the wrong UI on first paint
 *
 * The guard renders a visually identical placeholder (same size,
 * same variant) until the client has mounted and next-themes has
 * resolved the stored preference. This avoids both the hydration
 * error and a visible layout shift when the icon appears.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    // Placeholder matches the real button's dimensions exactly.
    // aria-hidden keeps screen readers from announcing a meaningless button.
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-hidden="true"
        tabIndex={-1}
        className={cn("opacity-0", className)}
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
