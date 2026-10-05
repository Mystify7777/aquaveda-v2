import { RequireAuth } from "@/components/auth/require-auth";

/**
 * Route group for authenticated-only surfaces (Issue #43).
 *
 * This is the "apply" half of #43 — RequireAuth is the reusable
 * boundary; this layout is where it's actually wired into the App
 * Router structure. Any future authenticated-only page (Dashboard —
 * #54, contribution entry points — #44/#45/#46/#47, once they exist)
 * is placed under src/app/(protected)/ and is automatically gated,
 * without re-implementing protection per page or remembering to wrap
 * each one individually.
 *
 * The parenthesized segment name doesn't affect the URL: a page at
 * `src/app/(protected)/learn/new/page.tsx` is served at `/learn/new`
 * and is gated by this layout. Contribution entry points that need their
 * own route (e.g. Knowledge draft authoring) live here; surfaces that
 * must stay anonymous-accessible (e.g. /explore) do not.
 *
 * A route group, not per-page wrapping, was chosen specifically so a
 * future page can't accidentally be added to an authenticated area
 * and forget to protect itself — the App Router structure enforces it.
 */
export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <RequireAuth>{children}</RequireAuth>;
}
