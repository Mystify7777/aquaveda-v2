import type { Metadata } from "next";
import Link from "next/link";

import { LearnWorkflowLinks } from "@/components/knowledge/learn-workflow-links";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ApiError } from "@/lib/api/client";
import { getKnowledgeList, getKnowledgeTaxonomyMetadata } from "@/lib/api/knowledge";
import {
  learnHref,
  learnPaginationParams,
  parseLearnQuery,
  toKnowledgeListQuery,
  validateLearnTaxonomy,
} from "@/lib/knowledge/discovery";
import { publicPageMetadata } from "@/lib/seo";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { state } = parseLearnQuery(await searchParams);

  return publicPageMetadata({
    title: "Learn",
    description: "Read reviewed environmental knowledge published through AquaVeda.",
    canonical: learnHref(state),
  });
}

/**
 * Public Knowledge discovery (#234). URL query parameters are the durable
 * filter state; the page never keeps a second transient interpretation.
 * #235 owns the visual filter controls and must consume this same state layer.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = parseLearnQuery(raw);

  let metadata;
  try {
    metadata = await getKnowledgeTaxonomyMetadata();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell>
        <LoadError
          message={loadErrorMessage(error, "Learn filters")}
          retryHref={learnHref(parsed.state)}
        />
      </Shell>
    );
  }

  const invalid = [...parsed.invalid, ...validateLearnTaxonomy(parsed.state.filters, metadata)];
  if (invalid.length > 0) {
    return (
      <Shell>
        <EmptyState
          title="Invalid Learn filters"
          description={invalid.map(({ key, message }) => `${key}: ${message}`).join(" · ")}
          action={
            <Button asChild variant="outline">
              <Link href="/learn">Clear filters</Link>
            </Button>
          }
        />
      </Shell>
    );
  }

  let result;
  try {
    result = await getKnowledgeList(toKnowledgeListQuery(parsed.state));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell>
        <LoadError
          message={loadErrorMessage(error, "articles")}
          retryHref={learnHref(parsed.state)}
        />
      </Shell>
    );
  }

  const params = learnPaginationParams(parsed.state);

  return (
    <Shell>
      {result.items.length === 0 ? (
        result.total > 0 ? (
          <EmptyState
            title="No articles on this page"
            description="This page is past the last page of articles."
            action={
              <Button asChild variant="outline">
                <Link href={learnHref({ ...parsed.state, page: 1 })}>Back to first page</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No articles match these filters"
            description="Try fewer or different filters, or clear the current Learn filters."
            action={
              <Button asChild variant="outline">
                <Link href="/learn">Clear filters</Link>
              </Button>
            }
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
            params={Object.keys(params).length ? params : undefined}
          />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Learn</h1>
        <div className="flex flex-wrap gap-2">
          <LearnWorkflowLinks />
          <Button asChild>
            <Link href="/learn/new">Write an article</Link>
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
