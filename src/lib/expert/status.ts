import type { ExpertApplicationStatus } from "@/lib/api/types/expert-application";

export const EXPERT_STATUS_LABELS: Record<ExpertApplicationStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};
