"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";

/**
 * The reusable authenticated-route protection boundary (Issue #43).
 *
 * Consumes the existing AuthProvider/useAuth session state — no second
 * auth mechanism, no route-level JWT inspection, no invented frontend
 * role logic. Backend authorization remains authoritative; this
 * component only decides what to *render* client-side, never grants
 * or withholds any actual capability (the backend's requireActor/
 * requireRole boundary — AUTH-L1/L2 — is unaffected by anything here).
 *
 * All 5 states from src/lib/auth-state.js are handled with distinct,
 * accurate copy — "session-failure" (a real auth/session problem) and
 * "unavailable" (the backend/network is unreachable) are deliberately
 * NOT collapsed into one generic message: the former asks the user to
 * sign in again, the latter tells them nothing about their account
 * changed. A network/backend failure is never rendered as if it were
 * confirmed anonymous — that distinction is initializeAuthSession's
 * own responsibility (statusForInitializationFailure), preserved here
 * by simply rendering exactly the status AuthProvider reports, not
 * re-deriving or collapsing it.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();

    if (status === "initializing") {
        return <div aria-busy="true" aria-label="Checking authentication" />;
    }

    if (status === "authenticated") return <>{children}</>;

    if (status === "anonymous") {
        return (
            <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                    Sign in to continue with this contribution.
                </p>
                <div className="flex gap-2">
                    <Button asChild size="sm">
                        <Link href="/login">Sign in</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/register">Register</Link>
                    </Button>
                </div>
            </div>
        );
    }

    if (status === "session-failure") {
        return (
            <div className="space-y-2">
                <p role="alert" className="text-destructive text-sm">
                    There&apos;s a problem with your session. Please sign in
                    again.
                </p>
                <div className="flex gap-2">
                    <Button asChild size="sm">
                        <Link href="/login">Sign in</Link>
                    </Button>
                </div>
            </div>
        );
    }

    // status === "unavailable": the backend/network couldn't be
    // reached at all — deliberately distinct from session-failure.
    // Nothing is known about whether the user's session is actually
    // valid; offering a "sign in again" action here would be
    // misleading, since the problem isn't the session.
    return (
        <p role="alert" className="text-destructive text-sm">
            Authentication is unavailable right now. Try again shortly.
        </p>
    );
}