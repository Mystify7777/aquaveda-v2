import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { Comment, CommentRefType } from "./types/comment";

export function getCommentThread(refType: CommentRefType, refId: string) {
  return apiRequest<Comment[]>(
    buildApiUrl("/api/v1/comments", { refType, refId }),
    { cache: "no-store" },
  );
}
