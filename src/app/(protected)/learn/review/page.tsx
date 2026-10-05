import type { Metadata } from "next";

import { ReviewQueueList } from "@/components/knowledge/workflow-list";

export const metadata: Metadata = { title: "Review queue" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Pending-review queue (#51/#74). Who may read it is the backend's decision. */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { page } = await searchParams;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Review queue</h1>
      <ReviewQueueList page={parsePage(page)} />
    </div>
  );
}
