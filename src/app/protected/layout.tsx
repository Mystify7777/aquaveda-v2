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
 * No page exists under this group yet, deliberately — #43's own scope
 * explicitly excludes implementing #44/#45/#46/#47/#50. This
 * structural layout is what "establish and apply" means without a
 * product page to attach it to: the boundary is wired and unit-tested
 * (both directly, in require-auth.test.tsx, and structurally, in
 * layout.test.tsx), but has not yet been exercised through an actual
 * Next.js route — that can only happen once a real page is placed
 * under this group. The parenthesized segment name doesn't affect the
 * URL, so adding `src/app/(protected)/dashboard/page.tsx` later needs
 * no further protection work, but its own route-level behavior (e.g.
 * an actual browser navigation being gated) is unverified until then.
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
