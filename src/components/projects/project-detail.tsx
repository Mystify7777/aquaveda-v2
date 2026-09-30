import { formatDate } from "@/lib/format-date";
import type { Project } from "@/lib/api/types/project";

/**
 * Read-only Project detail. Renders only fields the backend returns; no
 * membership, ownership or lifecycle semantics are implied. `originIssue`
 * is shown as a plain ID — there is no Issue detail route to link to yet.
 */
export function ProjectDetail({ project }: { project: Project }) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-muted-foreground text-sm">
          Started by {project.creator.name} ·{" "}
          <time dateTime={project.createdAt}>{formatDate(project.createdAt)}</time>
        </p>
      </header>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{project.description}</p>

      <dl className="space-y-4 border-t pt-4 text-sm">
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Origin issue
          </dt>
          <dd className="font-mono break-all">{project.originIssue}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Contributors
          </dt>
          <dd>
            {project.contributors.length === 0 ? (
              <span className="text-muted-foreground">No contributors yet.</span>
            ) : (
              <ul className="list-disc pl-5">
                {project.contributors.map((c) => (
                  <li key={c._id}>{c.name}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}
