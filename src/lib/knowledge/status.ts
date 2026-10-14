import type { KnowledgeStatus } from "@/lib/api/types/knowledge";

/** The four existing lifecycle states (ADR-0004); labels only, no rules. */
export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

export function parseKnowledgeStatus(raw: string | string[] | undefined): KnowledgeStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return KNOWLEDGE_STATUSES.find((s) => s === value);
}
