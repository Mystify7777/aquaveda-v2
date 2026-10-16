import type { Metadata } from "next";

import { ExpertApplicationPanel } from "@/components/expert/expert-application-panel";

export const metadata: Metadata = { title: "Become an Expert" };

/**
 * Expert application and status for the signed-in user. Gated to
 * authenticated sessions by the (protected) route group; whether the
 * caller may apply is the backend's decision.
 */
export default function ExpertApplicationPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Become an Expert</h1>
      <ExpertApplicationPanel />
    </div>
  );
}
