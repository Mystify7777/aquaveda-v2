import type { PublicActor } from "./actor";
import type { PaginatedResponse } from "./pagination";

export type CommunityActivityType = "DISCUSSION" | "ISSUE" | "KNOWLEDGE";

export interface CommunityActivityItem {
  id: string;
  type: CommunityActivityType;
  activityAt: string;
  title: string;
  category: string | null;
  commentCount: number;
  resource: {
    type: CommunityActivityType;
    id: string;
  };
  author: PublicActor | null;
}

export type CommunityActivityResponse = PaginatedResponse<CommunityActivityItem>;
