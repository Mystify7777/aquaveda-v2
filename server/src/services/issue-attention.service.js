import { ATTENTION_QUEUES, deriveNextAction, responsibilityOf } from "../domain/issue-progress.js";
import { Issue } from "../models/Issue.js";
import { toAttentionItemDTO } from "./issue.dto.js";
import { requireActor, requireRole } from "./authorization.js";
import { DomainError, DomainErrorCode } from "./errors.js";

/**
 * EXPERT needs-attention queues (ADR-0008 §6, Issue #148).
 *
 * A READ-ONLY derived view: nothing is stored, no status or grant changes, no
 * new collection or index. Three queues, oldest-waiting first:
 *   - unacknowledged        status `open`
 *   - unassigned            status `acknowledged` | `in_progress` with no ACCEPTED
 *                           grant (no grant, or one offered but not yet accepted)
 *   - awaiting_verification status `resolved`
 * There are no thresholds or SLA labels: age is the ordering, not a verdict.
 *
 * Authorization is the existing single-role primitive (`requireRole`, AUTH-L2):
 * EXPERT only. Rows describe state and age and name no person, so even this
 * role-gated view exposes nothing about who a pending grant is offered to.
 */

const validationFailed = (message, details) =>
  new DomainError(DomainErrorCode.VALIDATION_FAILED, message, details);

/** The largest BSON date: used only as a sort key so an unknown age orders after every known one. */
const UNKNOWN_AGE_LAST = new Date(8.64e15);

const QUEUE_MATCH = {
  unacknowledged: { status: "open" },
  // "unassigned" means NO ACCEPTED grant (none, or offered but not accepted).
  // It is the exact complement of `responsibilityOf(issue) === "accepted"`
  // (a grant id AND an acceptance time), so the query and the derivation
  // cannot disagree, including for malformed grants.
  unassigned: {
    status: { $in: ["acknowledged", "in_progress"] },
    $nor: [{ "remediation.grantId": { $nin: [null] }, "remediation.acceptedAt": { $nin: [null] } }],
  },
  awaiting_verification: { status: "resolved" },
};

/**
 * @param {{ id: string, role: string } | null | undefined} actorContext
 * @param {{ queue: string, page?: number, limit?: number }} query
 */
export async function listAttentionQueue(actorContext, { queue, page = 1, limit = 20 } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "EXPERT");

  // Services are also called directly, bypassing the route's schema.
  if (!ATTENTION_QUEUES.includes(queue)) {
    throw validationFailed(`"${String(queue)}" is not a recognized attention queue`, { queue });
  }

  const skip = (page - 1) * limit;
  const [result] = await Issue.aggregate([
    { $match: QUEUE_MATCH[queue] },
    {
      // Slim the documents BEFORE sorting: histories never enter the sort, so a
      // large queue does not approach the in-memory sort limit.
      $project: {
        title: 1,
        category: 1,
        severity: 1,
        status: 1,
        // only what the derivation needs; the grant itself never leaves the query
        "remediation.grantId": 1,
        "remediation.acceptedAt": 1,
        // Same rule as `deriveWaitingSince`: the timestamp of the LAST history
        // entry (never "the last entry that has one"), else `createdAt`, else
        // null. Never the current time. A non-array history counts as absent.
        waitingSince: {
          $cond: [
            { $isArray: "$statusHistory" },
            {
              $let: {
                vars: { last: { $arrayElemAt: ["$statusHistory", -1] } },
                in: { $ifNull: ["$$last.timestamp", "$createdAt"] },
              },
            },
            "$createdAt",
          ],
        },
      },
    },
    // Unknown age (null) sorts LAST, never first: it must not pose as the oldest.
    { $addFields: { waitingSortKey: { $ifNull: ["$waitingSince", UNKNOWN_AGE_LAST] } } },
    // `_id` makes the order total: equal waitingSince values page deterministically.
    { $sort: { waitingSortKey: 1, _id: 1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }, { $project: { waitingSortKey: 0 } }],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.n ?? 0;
  const items = (result?.rows ?? []).map((row) =>
    toAttentionItemDTO({
      ...row,
      nextAction: deriveNextAction(row),
      responsibility: responsibilityOf(row),
    }),
  );

  return { queue, items, page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}
