import type { Metadata } from "next";
import Link from "next/link";

import { NewProjectButton } from "@/components/projects/new-project-button";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectLoadError, projectLoadErrorMessage } from "@/components/projects/project-load-error";
import { ProjectPagination } from "@/components/projects/project-pagination";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api/client";
import { getProjects } from "@/lib/api/projects";

export const metadata: Metadata = { title: "Act" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Public Project list (#52). Server-rendered from the public read
 * endpoint; page state lives in the URL. Loading UI: ./loading.tsx.
 */
export default async function ActPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePage((await searchParams).page);

  let result;
  try {
    result = await getProjects({ page });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell>
        <ProjectLoadError
          message={projectLoadErrorMessage(error)}
          retryHref={page === 1 ? "/act" : `/act?page=${page}`}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {result.items.length === 0 ? (
        result.total > 0 ? (
          <EmptyState
            title="No projects on this page"
            description="This page is past the last page of projects."
            action={
              <Button asChild variant="outline">
                <Link href="/act">Back to first page</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No projects yet"
            description="Projects start from an acknowledged issue. Be the first to start one."
          />
        )
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2">
            {result.items.map((project) => (
              <li key={project._id}>
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
          <ProjectPagination page={result.page} totalPages={result.totalPages} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Act</h1>
        <NewProjectButton />
      </div>
      {children}
    </div>
  );
}
