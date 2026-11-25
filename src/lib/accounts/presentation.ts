import type { AdminAccountEntry, AdminAccountRestriction } from "@/lib/api/types/accounts";
import { formatDate, formatDateTime } from "@/lib/format-date";

/** Plain-language labels for the account governance surface. Text, never color alone. */
const STATE_LABELS: Readonly<Record<string, string>> = {
  ACTIVE: "Active",
  MUTED: "Muted",
  HARD_SUSPENDED: "Suspended",
  DELETION_PENDING: "Deletion pending",
  PERMANENTLY_DELETED: "Permanently deleted",
};

const ROLE_LABELS: Readonly<Record<string, string>> = { USER: "User", EXPERT: "Expert", ADMIN: "Admin" };

const ACTION_LABELS: Readonly<Record<string, string>> = {
  MUTE: "Muted",
  MUTE_LIFTED: "Mute lifted",
  HARD_SUSPEND: "Suspended",
  SUSPENSION_LIFTED: "Suspension lifted",
  APPEAL_SUBMITTED: "Appeal submitted",
  APPEAL_RESOLVED: "Appeal resolved",
  ACCOUNT_DELETION_REQUESTED: "Deletion requested",
  ACCOUNT_RECOVERED: "Account recovered",
  ACCOUNT_PERMANENTLY_DELETED: "Permanently deleted",
  EXPERT_REVOKED: "Expert status revoked",
  EXPERT_RESTORED: "Expert status restored",
};

const own = (table: Readonly<Record<string, string>>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const humanize = (raw: string) => {
  const text = raw.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const roleLabel = (role: string) => own(ROLE_LABELS, role) ?? humanize(role);
export const stateLabel = (state: string) => own(STATE_LABELS, state) ?? humanize(state);
export const actionLabel = (action: string) => own(ACTION_LABELS, action) ?? humanize(action);

/** History states are account states, or roles for Expert actions. */
export const transitionStateLabel = (value: string) =>
  own(STATE_LABELS, value) ?? own(ROLE_LABELS, value) ?? humanize(value);

export type BadgeTone = "outline" | "verified" | "warning" | "critical";

export function stateTone(state: string): BadgeTone {
  switch (state) {
    case "ACTIVE":
      return "verified";
    case "MUTED":
    case "DELETION_PENDING":
      return "warning";
    case "HARD_SUSPENDED":
      return "critical";
    default:
      return "outline";
  }
}

/** One-line restriction status, or null when the account has none. */
export function restrictionSummary(restriction: AdminAccountRestriction | null): string | null {
  if (!restriction) return null;
  if (restriction.kind === "INDEFINITE") return "No end date";
  const when = restriction.expiresAt ? formatDateTime(restriction.expiresAt) : "";
  if (restriction.lapsed) {
    return when ? `Expired ${when}; not yet lifted` : "Expired; not yet lifted";
  }
  return when ? `Until ${when}` : "Temporary";
}

export function deletionSummary(entry: Pick<AdminAccountEntry, "deletionPending" | "deletionRequestedAt">) {
  if (!entry.deletionPending) return null;
  return entry.deletionRequestedAt ? `Deletion requested ${formatDate(entry.deletionRequestedAt)}` : "Deletion pending";
}
