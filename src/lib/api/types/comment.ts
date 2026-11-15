import type { PublicActor } from "./actor";

export type CommentRefType = "ISSUE" | "WIKI" | "DISCUSSION";

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

export interface CreateCommentPayload {
  refType: CommentRefType;
  refId: string;
  body: string;
  parentComment?: string;
}

export type CreatedComment = Pick<
  Comment,
  "_id" | "refType" | "refId" | "body" | "parentComment"
>;
