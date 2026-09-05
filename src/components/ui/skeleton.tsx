import { cn } from "@/lib/utils";

/**
 * Skeleton — content-shaped loading placeholder.
 *
 * Usage: mirror the real component's layout dimensions so the swap
 * from skeleton to real content causes no layout shift. The home
 * page's loading.tsx demonstrates the correct pattern — each skeleton
 * block matches the element it stands in for, not a generic spinner.
 *
 * Server Component by default (no interactivity) — safe to use inside
 * loading.tsx and Suspense fallbacks without a "use client" boundary.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
      aria-hidden="true"
    />
  );
}
