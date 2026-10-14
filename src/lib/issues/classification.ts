/**
 * Frontend view of the Issue classification contract (#67).
 *
 * The backend domain module is the single source of truth; this file only
 * re-exports it (typed) so the cross-package import path lives in one
 * place. Do not define category/severity values anywhere in `src/`.
 */
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
} from "../../../server/src/domain/issue-classification.js";

export { ISSUE_CATEGORIES, ISSUE_SEVERITIES };

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]["value"];
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]["value"];

export interface ClassificationOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
  readonly description: string;
}

export function isIssueCategory(value: string): value is IssueCategory {
  return ISSUE_CATEGORIES.some((c) => c.value === value);
}

export function isIssueSeverity(value: string): value is IssueSeverity {
  return ISSUE_SEVERITIES.some((s) => s.value === value);
}
