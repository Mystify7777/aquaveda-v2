import type { CreateKnowledgePayload } from "@/lib/api/types/knowledge";

export interface KnowledgeDraftValues {
  title: string;
  body: string;
}

export type KnowledgeDraftField = keyof KnowledgeDraftValues;
export type KnowledgeDraftErrors = Partial<Record<KnowledgeDraftField, string>>;

export const EMPTY_KNOWLEDGE_DRAFT: KnowledgeDraftValues = { title: "", body: "" };

/**
 * Advisory frontend-boundary validation mirroring server
 * createKnowledgeSchema (title/body required, trimmed). The backend
 * remains authoritative.
 */
export function validateKnowledgeDraft(
  values: KnowledgeDraftValues,
): { ok: true; payload: CreateKnowledgePayload } | { ok: false; errors: KnowledgeDraftErrors } {
  const title = values.title.trim();
  const body = values.body.trim();
  const errors: KnowledgeDraftErrors = {};
  if (!title) errors.title = "Title is required.";
  if (!body) errors.body = "Body is required.";
  if (errors.title || errors.body) return { ok: false, errors };
  return { ok: true, payload: { title, body } };
}
