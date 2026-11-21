"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The reusable authenticated-route protection boundary (Issue #43).
 * Backend authorization remains authoritative; this component only controls
 * what the client renders while the shared session state is unresolved.
 */
export function RequireAuth({
    children,
    gateClassName,
}: {
    children: React.ReactNode;
    gateClassName?: string;
}) {
    const { status, retryInitialization } = useAuth();

    if (status === "initializing") {
        return (
            <div
                role="status"
                aria-live="polite"
                aria-label="Checking authentication"
                className={gateClassName}
            >
                <span className="sr-only">Checking your session...</span>
            </div>
        );
    }

    if (status === "authenticated") return <>{children}</>;

    if (status === "anonymous") {
        return (
            <div className={cn("space-y-2", gateClassName)}>
                <p className="text-muted-foreground text-sm">
                    Sign in to continue with this contribution.
                </p>
                <div className="flex gap-2">
                    <Button asChild size="sm">
                        <Link href="/auth/login">Sign in</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/auth/register">Register</Link>
                    </Button>
                </div>
            </div>
        );
    }

    if (status === "session-failure") {
        return (
            <div className={cn("space-y-2", gateClassName)}>
                <p role="alert" className="text-destructive text-sm">
                    There&apos;s a problem with your session. Please sign in again.
                </p>
                <div className="flex gap-2">
                    <Button asChild size="sm">
                        <Link href="/auth/login">Sign in</Link>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("space-y-3", gateClassName)}>
            <p role="alert" className="text-destructive text-sm">
                Authentication is unavailable right now. Your session has not been cleared.
            </p>
            <Button size="sm" variant="outline" onClick={() => void retryInitialization()}>
                Retry connection
            </Button>
        </div>
    );
}
