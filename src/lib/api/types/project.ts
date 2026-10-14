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

/** Body of POST /api/v1/projects. `originIssue` is an existing Issue ID. */
export interface CreateProjectPayload {
  title: string;
  description: string;
  originIssue: string;
}

/**
 * Fields the create endpoint returns that the frontend consumes. The
 * response is the raw created document (creator is an unpopulated id), so
 * it is deliberately not typed as Project.
 */
export type CreatedProject = Pick<Project, "_id" | "title" | "originIssue">;
