import type { CreateKnowledgePayload } from "@/lib/api/types/knowledge";

export interface KnowledgeDraftValues {
  category: string;
  title: string;
  body: string;
}

export type KnowledgeDraftField = keyof KnowledgeDraftValues;
export type KnowledgeDraftErrors = Partial<Record<KnowledgeDraftField, string>>;

export const KNOWLEDGE_CATEGORIES = [
  { value: "water_conservation", label: "Water conservation" },
  { value: "water_supply", label: "Water supply and distribution" },
  { value: "water_quality", label: "Water quality and treatment" },
  { value: "groundwater", label: "Groundwater" },
  { value: "wastewater_sanitation", label: "Wastewater and sanitation" },
  { value: "agriculture_irrigation", label: "Agriculture and irrigation" },
  { value: "flood_drainage", label: "Flooding and drainage" },
  { value: "water_governance", label: "Water governance" },
  { value: "community_practice", label: "Community and field practice" },
  { value: "other", label: "Other water knowledge" },
] as const;

export const EMPTY_KNOWLEDGE_DRAFT: KnowledgeDraftValues = { category: "", title: "", body: "" };

/**
 * Advisory frontend-boundary validation mirroring server
 * createKnowledgeSchema (title/body required, trimmed). The backend
 * remains authoritative.
 */
export function validateKnowledgeDraft(
  values: KnowledgeDraftValues,
): { ok: true; payload: CreateKnowledgePayload } | { ok: false; errors: KnowledgeDraftErrors } {
  const category = values.category.trim();
  const title = values.title.trim();
  const body = values.body.trim();
  const errors: KnowledgeDraftErrors = {};
  if (!category) errors.category = "Category is required.";
  if (!title) errors.title = "Title is required.";
  if (!body) errors.body = "Body is required.";
  if (errors.category || errors.title || errors.body) return { ok: false, errors };
  return { ok: true, payload: { title, body, category } };
}
