import { ApiError } from "@/lib/api/client";

export type ActionFailure = { kind: "session" | "other"; message: string };

/**
 * User-facing copy for a failed lifecycle write. Maps HTTP outcomes only;
 * whether the caller is *allowed* is decided by the backend and merely
 * reported here.
 */
export function toActionFailure(error: unknown, action: "review" | "revise"): ActionFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return {
        kind: "other",
        message: "The service is unreachable right now. Check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return { kind: "session", message: "Your session is no longer valid. Sign in again to continue." };
    }
    if (error.code === "VALIDATION_FAILED") return { kind: "other", message: error.message };
    if (error.status === 403) {
      return {
        kind: "other",
        message:
          action === "review"
            ? "Your account is not permitted to review this article."
            : "Only the author can revise this article.",
      };
    }
    if (error.status === 404) return { kind: "other", message: "This article could not be found." };
    if (error.code === "INVALID_STATE" || error.code === "STATE_RACE") {
      return {
        kind: "other",
        message:
          action === "review"
            ? "This article is no longer pending review. It may already have been reviewed."
            : "This article is no longer in a state that can be revised.",
      };
    }
  }
  return {
    kind: "other",
    message: action === "review" ? "We could not record your decision. Try again." : "We could not save your revision. Try again.",
  };
}
