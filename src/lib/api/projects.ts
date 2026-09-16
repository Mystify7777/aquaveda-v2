import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import type { PaginatedResponse } from "./types/pagination";
import type { Project, ProjectListQuery } from "./types/project";

export function getProjects(query?: ProjectListQuery) {
  return apiRequest<PaginatedResponse<Project>>(
    buildApiUrl("/api/v1/projects", query as Record<string, string | number | undefined>),
    { cache: "no-store" },
  );
}

export function getProject(projectId: string) {
  return apiRequest<Project>(buildApiUrl(`/api/v1/projects/${projectId}`), {
    cache: "no-store",
  });
}
