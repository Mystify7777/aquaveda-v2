import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type {
  Comment,
  CommentRefType,
  CreatedComment,
  CreateCommentPayload,
} from "./types/comment";

export function getCommentThread(refType: CommentRefType, refId: string) {
  return apiRequest<Comment[]>(
    buildApiUrl("/api/v1/comments", { refType, refId }),
    { cache: "no-store" },
  );
}

export function createComment(payload: CreateCommentPayload) {
  return apiRequest<CreatedComment>(buildApiUrl("/api/v1/comments"), {
    method: "POST",
    // apiRequest sets no Content-Type; express.json() ignores bodies without it.
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
