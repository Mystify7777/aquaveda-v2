import type { Metadata } from "next";

import { ProtectedRouteBoundary } from "@/components/auth/protected-route-boundary";
import { noIndexMetadata } from "@/lib/seo";

/**
 * Route group for authenticated-only surfaces (Issue #43).
 *
 * This is the "apply" half of #43 — the reusable authentication boundary is
 * wired into the App Router structure here. Any future authenticated-only
 * page under src/app/(protected)/ is automatically gated.
 *
 * The parenthesized segment name doesn't affect the URL: a page at
 * src/app/(protected)/learn/new/page.tsx is served at /learn/new and is
 * gated by this layout. Contribution entry points that need their own route
 * live here; surfaces that must stay anonymous-accessible (e.g. /explore)
 * do not.
 */
export const metadata: Metadata = noIndexMetadata();

export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <ProtectedRouteBoundary>{children}</ProtectedRouteBoundary>;
}
