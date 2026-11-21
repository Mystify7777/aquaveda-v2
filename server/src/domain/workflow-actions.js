import { hasRole } from "./actor.js";
import { resolverOf } from "./issue-lifecycle.js";
import {
  GRANT_OPERATION_STATUSES,
  deriveResponsibilityState,
  isGrantee,
} from "./remediation.js";

/**
 * Workflow capabilities: which lifecycle/remediation operations the VIEWER may
 * perform on this Issue right now (ADR-0008 section 3/11, ADR-0007).
 *
 * PURE. This is the server-side answer to "may this viewer do X?" so that no
 * client has to infer authority from roles, status and grants. It is built
 * from the SAME facts the mutation services enforce (`hasRole`,
 * `isGrantee`/`deriveResponsibilityState`, `GRANT_OPERATION_STATUSES`,
 * `resolverOf` from `issue-lifecycle.js`); the services remain authoritative (a list of actions is not a
 * security token) and an agreement test runs every operation against this
 * list over a full state x actor matrix to catch drift.
 *
 * Availability depends on state and authority only, never on parameters or
 * notes: for example `remediation.grant` is available to an EXPERT while no
 * grant exists, and which grantee is chosen (including the self-grant policy)
 * is decided when the operation runs. Only the operations that exist today are
 * listed; progress notes and disputes add theirs in their own slices.
 */

export const WORKFLOW_ACTIONS = Object.freeze([
  "acknowledge",
  "remediation.grant",
  "remediation.withdraw",
  "remediation.revoke",
  "remediation.accept",
  "remediation.decline",
  "remediation.release",
  "remediation.start",
  "remediation.resolve",
  "resolution.verify",
  "resolution.fail",
]);

const RULES = {
  acknowledge: (i, a) => i.status === "open" && hasRole(a, "EXPERT"),

  "remediation.grant": (i, a) =>
    hasRole(a, "EXPERT") &&
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    deriveResponsibilityState(i.remediation) === "unassigned",

  "remediation.withdraw": (i, a) =>
    hasRole(a, "EXPERT") &&
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    deriveResponsibilityState(i.remediation) !== "unassigned",

  "remediation.revoke": (i, a) =>
    hasRole(a, "ADMIN") &&
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    deriveResponsibilityState(i.remediation) !== "unassigned",

  "remediation.accept": (i, a) =>
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    isGrantee(i.remediation, a?.id) &&
    deriveResponsibilityState(i.remediation) === "pending",

  "remediation.decline": (i, a) =>
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    isGrantee(i.remediation, a?.id) &&
    deriveResponsibilityState(i.remediation) === "pending",

  "remediation.release": (i, a) =>
    GRANT_OPERATION_STATUSES.includes(i.status) &&
    isGrantee(i.remediation, a?.id) &&
    deriveResponsibilityState(i.remediation) === "accepted",

  "remediation.start": (i, a) =>
    i.status === "acknowledged" &&
    isGrantee(i.remediation, a?.id) &&
    deriveResponsibilityState(i.remediation) === "accepted",

  "remediation.resolve": (i, a) =>
    i.status === "in_progress" &&
    isGrantee(i.remediation, a?.id) &&
    deriveResponsibilityState(i.remediation) === "accepted",

  // The verifier must be an EXPERT other than the resolver (ADR-0003/0007).
  "resolution.verify": (i, a) => {
    if (i.status !== "resolved" || !hasRole(a, "EXPERT")) return false;
    const resolver = resolverOf(i);
    return resolver !== null && resolver !== String(a.id);
  },

  // Failed verification is EXPERT-authorized (ADR-0003); it carries no
  // independence rule, exactly as `authorizeTransition` implements it.
  "resolution.fail": (i, a) => i.status === "resolved" && hasRole(a, "EXPERT"),
};

/**
 * @param {object} issue plain Issue (`toObject()`/lean) or any object with its fields
 * @param {{ id: string, role: string } | null | undefined} actor
 * @returns {string[]} the permitted actions, in the stable `WORKFLOW_ACTIONS` order
 */
export function evaluateWorkflowActions(issue, actor) {
  if (!actor || !actor.id || !issue) return [];
  return WORKFLOW_ACTIONS.filter((action) => RULES[action](issue, actor));
}
