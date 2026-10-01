import { WorkflowStatusBadge } from "@/components/knowledge/workflow-status-badge";
import { formatDate } from "@/lib/format-date";
import type { WorkflowKnowledge } from "@/lib/api/types/knowledge";

/** Read-only rendering of the full workflow DTO (Issue #74). */
export function WorkflowArticleView({ article }: { article: WorkflowKnowledge }) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{article.title}</h1>
          <WorkflowStatusBadge status={article.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {article.author ? `By ${article.author.name} · ` : ""}
          Created <time dateTime={article.createdAt}>{formatDate(article.createdAt)}</time> · Updated{" "}
          <time dateTime={article.updatedAt}>{formatDate(article.updatedAt)}</time>
        </p>
      </header>

      <div className="text-sm leading-relaxed whitespace-pre-wrap">{article.body}</div>

      <section aria-labelledby="review-history-heading" className="space-y-3 border-t pt-4">
        <h2 id="review-history-heading" className="font-display text-lg font-semibold">
          Review history
        </h2>
        {article.reviewHistory.length === 0 ? (
          <p className="text-muted-foreground text-sm">No review decisions yet.</p>
        ) : (
          <ol className="space-y-4">
            {article.reviewHistory.map((entry, i) => (
              <li key={i} className="space-y-1 text-sm">
                <p>
                  <strong>{entry.decision === "approved" ? "Approved" : "Rejected"}</strong>
                  {" by "}
                  {entry.reviewer ? `${entry.reviewer.name} (${entry.reviewer.role})` : "an unavailable reviewer"}
                  {" · "}
                  <time dateTime={entry.timestamp}>{formatDate(entry.timestamp)}</time>
                </p>
                {entry.feedback && (
                  <p className="text-muted-foreground border-l-2 pl-3 whitespace-pre-wrap">{entry.feedback}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
