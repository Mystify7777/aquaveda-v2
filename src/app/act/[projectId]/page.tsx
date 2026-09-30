import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectLoadError, projectLoadErrorMessage } from "@/components/projects/project-load-error";
import { ApiError } from "@/lib/api/client";
import { getProject } from "@/lib/api/projects";

export const metadata: Metadata = { title: "Project" };

/**
 * Public Project detail (#52). 404 (unknown) and 400 (malformed ID,
 * VALIDATION_FAILED) both mean "no such project" to the visitor.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let project;
  try {
    project = await getProject(projectId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404 || (error.status === 400 && error.code === "VALIDATION_FAILED")) {
      notFound();
    }
    return (
      <Shell>
        <ProjectLoadError
          message={projectLoadErrorMessage(error)}
          retryHref={`/act/${encodeURIComponent(projectId)}`}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <ProjectDetail project={project} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Link href="/act" className="text-muted-foreground hover:text-foreground w-fit text-sm">
        ← All projects
      </Link>
      {children}
    </div>
  );
}
