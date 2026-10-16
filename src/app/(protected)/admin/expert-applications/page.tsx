import type { Metadata } from "next";

import { ExpertApplicationQueue } from "@/components/expert/expert-application-queue";

export const metadata: Metadata = { title: "Expert applications" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * ADMIN governance: decide who becomes an Expert. Who may read the queue
 * is the backend's decision (ADMIN only); a non-ADMIN sees its 403 here.
 * Distinct from the Knowledge review queue (/learn/review, EXPERT-only).
 */
export default async function ExpertApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { page } = await searchParams;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Expert applications</h1>
      <p className="text-muted-foreground max-w-prose text-sm">
        Approve or reject requests to become an Expert. Experts review Knowledge articles; administrators
        govern who becomes an Expert but do not review articles.
      </p>
      <ExpertApplicationQueue page={parsePage(page)} />
    </div>
  );
}
