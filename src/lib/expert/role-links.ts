/**
 * Role-aware navigation entries. UX ONLY: deciding which link is worth
 * showing is not authorization — every target route renders the backend's
 * refusal if the actor is not permitted, and the backend (requireRole) is
 * authoritative. The three roles stay distinct:
 *   USER   -> may apply for Expert status
 *   EXPERT -> reviews Knowledge and triages Issue attention queues
 *   ADMIN  -> governs Expert applications (never EXPERT queues)
 */
export type RoleLink = { href: string; label: string };

export const EXPERT_APPLICATION_HREF = "/learn/expert-application";
export const KNOWLEDGE_REVIEW_HREF = "/learn/review";
export const EXPERT_ATTENTION_HREF = "/dashboard/attention";
export const ADMIN_EXPERT_APPLICATIONS_HREF = "/admin/expert-applications";

export function getRoleLinks(role: string | null | undefined): RoleLink[] {
  switch (role) {
    case "USER":
      return [{ href: EXPERT_APPLICATION_HREF, label: "Become an Expert" }];
    case "EXPERT":
      return [
        { href: KNOWLEDGE_REVIEW_HREF, label: "Review queue" },
        { href: EXPERT_ATTENTION_HREF, label: "Needs attention" },
      ];
    case "ADMIN":
      return [{ href: ADMIN_EXPERT_APPLICATIONS_HREF, label: "Expert applications" }];
    default:
      return [];
  }
}
