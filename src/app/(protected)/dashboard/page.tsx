import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The authenticated Dashboard (#54). Gated by the (protected) layout, so it
 * is served at /dashboard. The data comes from one backend read (#53); this
 * page only frames it.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Where water issues, knowledge and projects stand across AquaVeda, and what you have
          contributed to them.
        </p>
      </div>
      <DashboardView />
    </div>
  );
}
