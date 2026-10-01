import type { Metadata } from "next";
import Link from "next/link";

import { MyKnowledgeList } from "@/components/knowledge/workflow-list";
import { Button } from "@/components/ui/button";
import { parseKnowledgeStatus } from "@/lib/knowledge/status";

export const metadata: Metadata = { title: "My articles" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The caller's own Knowledge (#51/#74). Auth is enforced by the protected
 * layout; the list fetches client-side with the session cookie.
 */
export default async function MyKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; status?: string | string[] }>;
}) {
  const sp = await searchParams;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">My articles</h1>
        <Button asChild>
          <Link href="/protected/learn/new">Write an article</Link>
        </Button>
      </div>
      <MyKnowledgeList page={parsePage(sp.page)} status={parseKnowledgeStatus(sp.status)} />
    </div>
  );
}
