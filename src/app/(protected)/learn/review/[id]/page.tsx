import type { Metadata } from "next";
import Link from "next/link";

import { WorkflowArticle } from "@/components/knowledge/workflow-article";

export const metadata: Metadata = { title: "Article" };

/** Workflow detail for an author or reviewer (#51/#74); fetched client-side. */
export default async function WorkflowArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Link href="/learn/mine" className="text-muted-foreground hover:text-foreground w-fit text-sm">
        ← My articles
      </Link>
      <WorkflowArticle knowledgeId={id} />
    </div>
  );
}
