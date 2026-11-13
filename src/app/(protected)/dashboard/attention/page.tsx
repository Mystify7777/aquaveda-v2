import type { Metadata } from "next";

import { AttentionQueue } from "@/components/expert/attention-queue";

export const metadata: Metadata = { title: "Needs attention" };

/** EXPERT triage entry point. The protected layout gates session UX; API authorization remains authoritative. */
export default function AttentionPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Expert workspace</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Needs attention</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Review issues waiting for acknowledgement, an accepted responsible party, or independent verification.
          Queue order and progress are provided by AquaVeda.
        </p>
      </header>
      <AttentionQueue />
    </div>
  );
}
