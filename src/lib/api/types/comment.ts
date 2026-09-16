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
