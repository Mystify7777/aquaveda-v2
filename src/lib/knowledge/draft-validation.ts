import type { CreateKnowledgePayload } from "@/lib/api/types/knowledge";

export interface KnowledgeDraftValues {
  title: string;
  body: string;
  category: string;
  topics: string[];
}

export type KnowledgeDraftField = "title" | "body" | "category";
export type KnowledgeDraftErrors = Partial<Record<KnowledgeDraftField, string>>;

export const EMPTY_KNOWLEDGE_DRAFT: KnowledgeDraftValues = {
  title: "",
  body: "",
  category: "",
  topics: [],
};

/**
 * Advisory frontend-boundary validation mirroring the authoring API.
 * Taxonomy term existence is supplied by the server and revalidated there.
 */
export function validateKnowledgeDraft(
  values: KnowledgeDraftValues,
): { ok: true; payload: CreateKnowledgePayload } | { ok: false; errors: KnowledgeDraftErrors } {
  const title = values.title.trim();
  const body = values.body.trim();
  const errors: KnowledgeDraftErrors = {};

  if (!title) errors.title = "Title is required.";
  if (!body) errors.body = "Body is required.";
  if (!values.category) errors.category = "Choose a Category.";

  if (errors.title || errors.body || errors.category) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      title,
      body,
      category: values.category,
      ...(values.topics.length > 0 ? { topics: [...new Set(values.topics)] } : {}),
    },
  };
}
