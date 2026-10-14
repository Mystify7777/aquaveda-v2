import type { PublicActor } from "./actor";

export type CommentRefType = "ISSUE" | "WIKI";

export interface Comment {
  _id: string;
  refType: CommentRefType;
  refId: string;
  author: PublicActor;
  body: string;
  parentComment: string | null;
  createdAt: string;
  updatedAt: string;
  replies: Comment[];
}

/** Body of POST /api/v1/comments. `parentComment` is set only for a reply. */
export interface CreateCommentPayload {
  refType: CommentRefType;
  refId: string;
  body: string;
  parentComment?: string;
}

/**
 * Fields the create endpoint actually returns that the frontend consumes.
 * The response is the raw created document (author is an unpopulated id,
 * no `replies`), so it is deliberately not typed as `Comment`.
 */
export type CreatedComment = Pick<
  Comment,
  "_id" | "refType" | "refId" | "body" | "parentComment"
>;
