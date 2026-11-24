"use client";

import { usePathname } from "next/navigation";

import { RequireAuth } from "@/components/auth/require-auth";

const DASHBOARD_GATE_CLASS_NAME =
    "flex min-h-[calc(100dvh-12rem)] w-full flex-1 items-center justify-center px-4 py-10 sm:min-h-[calc(100dvh-14rem)] sm:px-6 sm:py-12";

export function ProtectedRouteBoundary({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isDashboard = pathname === "/dashboard";

    return (
        <RequireAuth
            gateClassName={isDashboard ? DASHBOARD_GATE_CLASS_NAME : undefined}
            gateTitle={isDashboard ? "Your dashboard" : undefined}
            gateDescription={
                isDashboard
                    ? "Sign in to view your activity and AquaVeda's platform totals."
                    : undefined
            }
        >
            {children}
        </RequireAuth>
    );
}
