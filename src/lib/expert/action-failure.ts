import { ApiError } from "@/lib/api/client";

/** `stale`: the application's state changed under the caller; the view should refresh. */
export type ExpertActionFailure = { kind: "session" | "stale" | "other"; message: string };

/**
 * User-facing copy for a failed Expert-application write. Maps HTTP outcomes
 * only; whether the caller is *allowed* is decided by the backend.
 */
export function toExpertActionFailure(error: unknown, action: "apply" | "decide"): ExpertActionFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return { kind: "other", message: "The service is unreachable right now. Check your connection and try again." };
    }
    if (error.status === 401) {
      return { kind: "session", message: "Your session is no longer valid. Sign in again to continue." };
    }
    if (error.code === "VALIDATION_FAILED") return { kind: "other", message: error.message };
    if (error.status === 403) {
      return {
        kind: "other",
        message:
          action === "apply"
            ? "Only member accounts can apply for Expert status."
            : "Your account is not permitted to decide Expert applications.",
      };
    }
    if (error.status === 404) {
      return {
        kind: action === "decide" ? "stale" : "other",
        message:
          action === "decide"
            ? "This application could not be found. It may have been withdrawn."
            : "We could not find your account. Sign in again.",
      };
    }
    if (error.status === 429) {
      return { kind: "other", message: "Too many attempts. Wait a while, then try again." };
    }
    if (error.code === "STATE_RACE" && action === "decide") {
      // Revision pinning (EXP-L11): the application is still pending but is no longer the version the reviewer saw.
      return {
        kind: "stale",
        message: "This application changed while you were reviewing it. The latest version is now shown; review it again.",
      };
    }
    if (error.code === "INVALID_STATE" || error.code === "STATE_RACE") {
      return {
        kind: "stale",
        message:
          action === "apply"
            ? "You already have an application in progress, or you are already an Expert."
            : "This application is no longer pending. It may already have been decided.",
      };
    }
  }
  return {
    kind: "other",
    message:
      action === "apply"
        ? "We could not submit your application. Try again."
        : "We could not record your decision. Try again.",
  };
}
