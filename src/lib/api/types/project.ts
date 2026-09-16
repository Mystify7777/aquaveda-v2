import type { PublicActor } from "./actor";
import type { PaginationQuery } from "./pagination";

export interface Project {
  _id: string;
  title: string;
  description: string;
  originIssue: string;
  creator: PublicActor;
  contributors: PublicActor[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListQuery extends PaginationQuery {
  originIssue?: string;
}
