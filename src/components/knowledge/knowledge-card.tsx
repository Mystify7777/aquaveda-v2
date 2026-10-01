import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import type { KnowledgeArticle } from "@/lib/api/types/knowledge";

export function KnowledgeCard({ article }: { article: KnowledgeArticle }) {
  return (
    <Card className="hover:border-foreground/30 focus-within:border-foreground/30 transition-colors">
      <CardHeader>
        <CardTitle className="text-base">
          <Link
            href={`/learn/${article._id}`}
            className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          >
            {article.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground line-clamp-3 text-sm">{article.body}</p>
        <p className="text-muted-foreground text-xs">
          By {article.author.name} · <time dateTime={article.createdAt}>{formatDate(article.createdAt)}</time>
        </p>
      </CardContent>
    </Card>
  );
}
