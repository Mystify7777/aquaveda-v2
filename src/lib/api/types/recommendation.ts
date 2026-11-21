export type RecommendationContextStatus = "insufficient_context" | "classified";

export interface IssueRecommendation {
  id: string;
  suggestion: string;
  reason: string;
}

export interface IssueRecommendations {
  issueId: string;
  contextStatus: RecommendationContextStatus;
  recommendations: IssueRecommendation[];
}
