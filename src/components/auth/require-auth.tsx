"use client";

import * as React from "react";
import Link from "next/link";

import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";

export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();

    if (status === "loading") {
        return <div aria-busy="true" aria-label="Checking authentication" />;
    }

    if (status === "anonymous") {
        return (
            <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                    Sign in to continue with this contribution.
                </p>
                <Button asChild size="sm">
                    <Link href="/login">Sign in</Link>
                </Button>
            </div>
        );
    }

    return <>{children}</>;
}
