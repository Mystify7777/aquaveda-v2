import type { Metadata } from "next";
import Link from "next/link";

import { LearnWorkflowLinks } from "@/components/knowledge/learn-workflow-links";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ApiError } from "@/lib/api/client";
import { getKnowledgeList } from "@/lib/api/knowledge";

export const metadata: Metadata = { title: "Learn" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Public Knowledge list (#51). The backend list endpoint is approved-only
 * and takes no status parameter, so none is sent. Loading UI: ./loading.tsx.
 * Authoring entry point is a public link; the target route gates on auth.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePage((await searchParams).page);

  let result;
  try {
    result = await getKnowledgeList({ page });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell>
        <LoadError
          message={loadErrorMessage(error, "articles")}
          retryHref={page === 1 ? "/learn" : `/learn?page=${page}`}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {result.items.length === 0 ? (
        result.total > 0 ? (
          <EmptyState
            title="No articles on this page"
            description="This page is past the last page of articles."
            action={
              <Button asChild variant="outline">
                <Link href="/learn">Back to first page</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No published articles yet"
            description="Articles appear here once they have been reviewed and approved."
          />
        )
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2">
            {result.items.map((article) => (
              <li key={article._id}>
                <KnowledgeCard article={article} />
              </li>
            ))}
          </ul>
          <PaginationNav
            page={result.page}
            totalPages={result.totalPages}
            basePath="/learn"
            label="Article pages"
          />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Learn</h1>
        <div className="flex flex-wrap gap-2">
          <LearnWorkflowLinks />
          <Button asChild>
            <Link href="/protected/learn/new">Write an article</Link>
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
