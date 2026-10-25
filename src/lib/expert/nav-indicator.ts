import type { MyExpertApplication } from "@/lib/api/types/expert-application";

export type NavIndicator = { text: string; screenReaderText: string };

/** The slice of the shared Expert status the nav needs (structural, so this stays a pure helper). */
export type NavIndicatorInput = {
  status: "idle" | "loading" | "ready" | "error";
  stale: boolean;
  application: MyExpertApplication | null;
  pendingCount: number | null;
};

/**
 * The small status shown beside a role link. Only ever derived from a READY,
 * NON-STALE shared status: while loading, after a failed refresh, or outside the
 * provider the link is neutral, so stale data is never presented as current.
 *   USER  -> Pending / Approved / Not approved (nothing before applying)
 *   ADMIN -> number of pending applications (nothing at zero)
 * UX only; server authorization is unaffected.
 */
export function navIndicator(role: string | null | undefined, input: NavIndicatorInput): NavIndicator | null {
  if (input.status !== "ready" || input.stale) return null;

  if (role === "USER" && input.application) {
    switch (input.application.status) {
      case "pending":
        return { text: "Pending", screenReaderText: "application pending review" };
      case "approved":
        return { text: "Approved", screenReaderText: "application approved" };
      case "rejected":
        return { text: "Not approved", screenReaderText: "application not approved" };
      default:
        return null;
    }
  }

  if (role === "ADMIN" && input.pendingCount && input.pendingCount > 0) {
    const n = input.pendingCount;
    return { text: n > 99 ? "99+" : String(n), screenReaderText: `${n} pending ${n === 1 ? "application" : "applications"}` };
  }
  return null;
}
