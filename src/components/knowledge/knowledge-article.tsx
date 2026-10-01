import { formatDate } from "@/lib/format-date";
import type { KnowledgeArticle as Article } from "@/lib/api/types/knowledge";

/**
 * Read-only public article. Only approved articles reach this (the page
 * guards it). Reviewer identity is not shown: public reads return
 * `reviewHistory[].reviewer` as an unpopulated id, and rejection feedback
 * is not public content.
 */
export function KnowledgeArticleView({ article }: { article: Article }) {
  const approval = [...article.reviewHistory].reverse().find((e) => e.decision === "approved");

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{article.title}</h1>
        <p className="text-muted-foreground text-sm">
          By {article.author.name} · <time dateTime={article.createdAt}>{formatDate(article.createdAt)}</time>
          {approval && (
            <>
              {" "}
              · Approved <time dateTime={approval.timestamp}>{formatDate(approval.timestamp)}</time>
            </>
          )}
        </p>
      </header>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{article.body}</div>
    </article>
  );
}
