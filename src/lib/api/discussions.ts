import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type {
  CreateDiscussionPayload,
  Discussion,
  DiscussionListResponse,
} from "./types/discussion";

export function getDiscussions(query?: { page?: number; limit?: number }) {
  return apiRequest<DiscussionListResponse>(
    buildApiUrl("/api/v1/discussions", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getDiscussion(discussionId: string) {
  return apiRequest<Discussion>(
    buildApiUrl("/api/v1/discussions/" + encodeURIComponent(discussionId)),
    { cache: "no-store" },
  );
}

export function createDiscussion(payload: CreateDiscussionPayload) {
  return apiRequest<Discussion>(buildApiUrl("/api/v1/discussions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
