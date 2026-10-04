import { Badge } from "@/components/ui/badge";
import type { IssueStatus } from "@/lib/api/types/issue";
import { ISSUE_STATUS_LABELS } from "@/lib/issues/status";

/** Text label always present; this is read-only presentation, not a transition control. */
export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return <Badge variant="outline">{ISSUE_STATUS_LABELS[status]}</Badge>;
}
