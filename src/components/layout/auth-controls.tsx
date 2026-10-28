"use client";

import * as React from "react";
import Link from "next/link";

import { AuthError, getAuthErrorMessage } from "@/components/auth/auth-error";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";

export function AuthControls({ mobile = false }: { mobile?: boolean }) {
    const { status, user, logout } = useAuth();
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    // 44px touch targets in the mobile drawer; desktop keeps the compact size.
    const touch = mobile ? "h-11" : undefined;

    if (status === "initializing") {
        return <span className="bg-muted h-8 w-20 animate-pulse rounded-md" aria-hidden="true" />;
    }

    if (status === "anonymous") {
        return <div className={mobile ? "flex flex-col gap-2" : "flex items-center gap-1"}><Button asChild variant="ghost" size="sm" className={touch}><Link href="/auth/login">Sign in</Link></Button><Button asChild size="sm" className={touch}><Link href="/auth/register">Register</Link></Button></div>;
    }

    if (status !== "authenticated") {
        return <span className="text-muted-foreground text-xs" role="status">Session unavailable</span>;
    }

    async function handleLogout() {
        setError(null);
        setPending(true);
        try {
            await logout();
        } catch (logoutError) {
            setError(getAuthErrorMessage(logoutError));
        } finally {
            setPending(false);
        }
    }

    return <div className={mobile ? "flex flex-col gap-2" : "flex items-center gap-2"}><span className="text-muted-foreground font-mono text-xs" aria-label="Signed-in role">{user?.role}</span><Button variant="outline" size="sm" className={touch} onClick={() => void handleLogout()} disabled={pending} aria-busy={pending}>{pending ? "Signing out..." : "Sign out"}</Button>{error && <AuthError message={error} />}</div>;
}