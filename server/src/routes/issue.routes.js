import { Router } from "express";

import { createIssue, changeStatus, getPublicIssueDetail, listPublicIssues, getIssueWorkflowDTO, buildMutationResult } from "../services/issue.service.js";
import {
  grantRemediation,
  acceptRemediation,
  declineRemediation,
  releaseRemediation,
  withdrawRemediation,
  revokeRemediation,
} from "../services/remediation.service.js";
import { toCreatedIssueDTO } from "../services/issue.dto.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createIssueSchema, listIssuesQuerySchema } from "../validation/issue.validation.js";
import { grantRemediationSchema, noteBodySchema } from "../validation/remediation.validation.js";

/**
 * Issue routes.
 *
 * Contract: docs/architecture/decision-register.md "Locked — Routes" plus the
 * RT-142-* entries (Issue #142, ADR-0007). Routes stay thin: validate request
 * SHAPE -> domain service -> mapped DTO -> sendSuccess/sendError. Authorization,
 * transition legality, notes and concurrency all live in the services; no
 * route checks a role or a grant. Every Issue payload leaves through an
 * explicit-allowlist mapper (issue.dto.js) — never a raw document.
 *
 * Public reads (GET /, GET /:issueId) require no actor. GET /:issueId/workflow
 * and every POST need an actor; the services enforce it (requireActor).
 *
 * Registration order: GET /:issueId/workflow is a distinct two-segment path, so
 * it cannot shadow or be shadowed by GET /:issueId (route-order test).
 *
 * `PATCH /:issueId/status` was REMOVED in #142: the explicit transition routes
 * below name their exact source edge (`expectedFrom`) and can carry a note.
 */

export const issueRouter = Router();

issueRouter.get("/", async (req, res) => {
  const parsed = listIssuesQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    sendSuccess(res, await listPublicIssues(parsed.data), "Issues retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

issueRouter.get("/:issueId/workflow", async (req, res) => {
  try {
    sendSuccess(res, await getIssueWorkflowDTO(req.actorContext, req.params.issueId), "Issue workflow retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

issueRouter.get("/:issueId", async (req, res) => {
  try {
    sendSuccess(res, await getPublicIssueDetail(req.params.issueId), "Issue retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

issueRouter.post("/", async (req, res) => {
  const parsed = createIssueSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const issue = await createIssue(req.actorContext, parsed.data);
    sendSuccess(res, toCreatedIssueDTO(issue.toObject()), "Issue created", 201);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Registers one explicit action route. `perform(actor, issueId, body)` is a
 * domain-service call; its post-write document becomes the viewer-specific
 * mutation DTO. No raw-document fallback: a mapping failure is a 500.
 */
function action(path, schema, message, perform, status = 200) {
  issueRouter.post(path, async (req, res) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const doc = await perform(req.actorContext, req.params.issueId, parsed.data);
      sendSuccess(res, await buildMutationResult(req.actorContext, doc), message, status);
    } catch (err) {
      sendError(res, err);
    }
  });
}

const transition = (target, expectedFrom) => (actor, id, { note }) =>
  changeStatus(actor, id, target, { note: note ?? undefined, expectedFrom });
const withNote = (fn) => (actor, id, { note }) => fn(actor, id, { note: note ?? undefined });

// Lifecycle transitions (ADR-0003 / ADR-0007 §3): each names its exact source edge.
action("/:issueId/acknowledge", noteBodySchema, "Issue acknowledged", transition("acknowledged", "open"));
action("/:issueId/start", noteBodySchema, "Remediation started", transition("in_progress", "acknowledged"));
action("/:issueId/resolve", noteBodySchema, "Issue resolved", transition("resolved", "in_progress"));
action("/:issueId/verify", noteBodySchema, "Resolution verified", transition("verified", "resolved"));
action("/:issueId/fail-verification", noteBodySchema, "Verification failed; remediation continues", transition("in_progress", "resolved"));

// Remediation grant operations (ADR-0007 §2).
action(
  "/:issueId/remediation/grant",
  grantRemediationSchema,
  "Remediation offered",
  (actor, id, { granteeId, note }) => grantRemediation(actor, id, granteeId, { note: note ?? undefined }),
  201,
);
action("/:issueId/remediation/accept", noteBodySchema, "Remediation accepted", (actor, id) => acceptRemediation(actor, id));
action("/:issueId/remediation/decline", noteBodySchema, "Remediation declined", withNote(declineRemediation));
action("/:issueId/remediation/release", noteBodySchema, "Remediation released", withNote(releaseRemediation));
action("/:issueId/remediation/withdraw", noteBodySchema, "Remediation withdrawn", withNote(withdrawRemediation));
action("/:issueId/remediation/revoke", noteBodySchema, "Remediation revoked", withNote(revokeRemediation));

export default issueRouter;
