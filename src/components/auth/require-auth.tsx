"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";

export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();

    if (status === "initializing") return <div aria-busy="true" aria-label="Checking authentication" />;
    if (status === "authenticated") return <>{children}</>;
    if (status === "anonymous") {
        return <div className="space-y-2"><p className="text-muted-foreground text-sm">Sign in to continue with this contribution.</p><div className="flex gap-2"><Button asChild size="sm"><Link href="/login">Sign in</Link></Button><Button asChild variant="outline" size="sm"><Link href="/register">Register</Link></Button></div></div>;
    }

    return <p role="alert" className="text-destructive text-sm">Authentication is unavailable right now. Try again shortly.</p>;
}