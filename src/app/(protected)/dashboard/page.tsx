import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RequireAuth } from "@/components/auth/require-auth";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The authenticated Dashboard (#54). Gated by the protected layout.
 * The Dashboard's anonymous gate is page-framed so it can use the available
 * content region without changing the shared gate on contribution forms.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-6xl flex-col px-4 py-10 sm:min-h-[calc(100dvh-14rem)] sm:px-6 sm:py-12">
      <RequireAuth>
        <div className="flex flex-1 flex-col gap-8">
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              Where water issues, knowledge and projects stand across AquaVeda, and what you have
              contributed to them.
            </p>
          </div>
          <DashboardView />
        </div>
      </RequireAuth>
    </div>
  );
}
