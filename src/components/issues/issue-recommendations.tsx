"use client";

import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getIssueRecommendations } from "@/lib/api/recommendations";
import type { IssueRecommendations as IssueRecommendationsData } from "@/lib/api/types/recommendation";
import { useApiResource } from "@/lib/api/use-api-resource";

function RecommendationContent({ data }: { data: IssueRecommendationsData }) {
  if (data.contextStatus === "insufficient_context") {
    return (
      <p className="text-muted-foreground text-sm">
        There is not enough classification context to provide guidance. Recommendations do not infer facts from the title or description.
      </p>
    );
  }

  if (data.recommendations.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No matching guidance is currently available for this Issue&apos;s classification.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {data.recommendations.map((recommendation) => (
        <li key={recommendation.id} className="space-y-1 text-sm">
          <p className="font-medium">{recommendation.suggestion}</p>
          <p className="text-muted-foreground">{recommendation.reason}</p>
        </li>
      ))}
    </ol>
  );
}

export function IssueRecommendations({ issueId }: { issueId: string }) {
  const { resource, reload } = useApiResource(
    (signal) => getIssueRecommendations(issueId, { signal }),
    `recommendations:${issueId}`,
  );

  return (
    <section aria-labelledby="issue-recommendations-heading" className="space-y-4 border-t pt-4">
      <div className="space-y-1">
        <h2 id="issue-recommendations-heading" className="font-display text-xl font-semibold">
          AI-assisted guidance
        </h2>
        <p className="text-muted-foreground text-sm">
          These recommendations are derived guidance, not verified Knowledge. Approved Knowledge remains authoritative.
        </p>
      </div>

      {resource.status === "loading" && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading AI-assisted guidance...</span>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      )}
      {resource.status === "error" && (
        <LoadError
          message={loadErrorMessage(resource.error, "AI-assisted guidance")}
          onRetry={reload}
        />
      )}
      {resource.status === "success" && <RecommendationContent data={resource.data} />}
    </section>
  );
}
