import type { CreateProjectPayload } from "@/lib/api/types/project";

export interface ProjectCreationValues {
  title: string;
  description: string;
  originIssue: string;
}

export type ProjectCreationField = keyof ProjectCreationValues;
export type ProjectCreationErrors = Partial<Record<ProjectCreationField, string>>;

export const EMPTY_PROJECT_CREATION: ProjectCreationValues = {
  title: "",
  description: "",
  originIssue: "",
};

// Same shape check as server objectIdString. Format only — existence and
// eligible status are backend-authoritative.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Advisory frontend-boundary validation mirroring server
 * createProjectSchema (all fields required, trimmed; originIssue
 * ObjectId-shaped). The backend remains authoritative.
 */
export function validateProjectCreation(
  values: ProjectCreationValues,
):
  | { ok: true; payload: CreateProjectPayload }
  | { ok: false; errors: ProjectCreationErrors } {
  const title = values.title.trim();
  const description = values.description.trim();
  const originIssue = values.originIssue.trim();
  const errors: ProjectCreationErrors = {};

  if (!title) errors.title = "Title is required.";
  if (!description) errors.description = "Description is required.";
  if (!originIssue) errors.originIssue = "Origin issue ID is required.";
  else if (!OBJECT_ID_PATTERN.test(originIssue))
    errors.originIssue = "Origin issue ID must be a 24-character hexadecimal ID.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload: { title, description, originIssue } };
}
