"use client";

import { usePathname } from "next/navigation";

import { RequireAuth } from "@/components/auth/require-auth";

const DASHBOARD_GATE_CLASS_NAME =
    "flex min-h-[calc(100dvh-12rem)] w-full flex-1 items-center justify-center px-4 py-10 text-center sm:min-h-[calc(100dvh-14rem)] sm:px-6 sm:py-12";

/**
 * Shared protected-route boundary with route-specific presentation hooks.
 *
 * Authentication semantics remain centralized in RequireAuth. This boundary
 * only supplies presentation for routes whose protected-state UI needs a
 * different page frame.
 */
export function ProtectedRouteBoundary({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    const gateClassName =
        pathname === "/dashboard" ? DASHBOARD_GATE_CLASS_NAME : undefined;

    return <RequireAuth gateClassName={gateClassName}>{children}</RequireAuth>;
}
