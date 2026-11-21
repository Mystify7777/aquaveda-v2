import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { CommunityActivityResponse } from "./types/community";

export function getCommunityActivity(query?: { page?: number; limit?: number }) {
  return apiRequest<CommunityActivityResponse>(
    buildApiUrl("/api/v1/community/activity", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}
