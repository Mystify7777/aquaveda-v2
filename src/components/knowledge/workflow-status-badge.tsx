import { Badge } from "@/components/ui/badge";
import type { KnowledgeStatus } from "@/lib/api/types/knowledge";
import { KNOWLEDGE_STATUS_LABELS } from "@/lib/knowledge/status";

const VARIANT = {
  draft: "outline",
  pending_review: "warning",
  approved: "verified",
  rejected: "critical",
} as const;

/** Text label always present; color is supplementary. */
export function WorkflowStatusBadge({ status }: { status: KnowledgeStatus }) {
  return <Badge variant={VARIANT[status]}>{KNOWLEDGE_STATUS_LABELS[status]}</Badge>;
}
