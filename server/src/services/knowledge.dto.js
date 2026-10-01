/**
 * Workflow Knowledge DTOs (Issue #74).
 *
 * Deliberately separate from the public approved-Knowledge shape returned
 * by the #48 reads, which is left untouched. Workflow reads are
 * authenticated and expose rejection feedback and populated reviewers;
 * the public reads must never gain those fields.
 *
 * Both mappers take lean documents whose `author` (and, for the detail
 * shape, `reviewHistory[].reviewer`) were populated with PUBLIC_ACTOR_FIELDS
 * only. A populated reference that resolved to nothing (e.g. a deleted
 * user) maps to `null` rather than throwing or leaking the raw id.
 *
 * Fields are copied by explicit allow-list — the Mongoose document is
 * never returned, so `__v` and any future schema field stay private by
 * default.
 */

function toActor(user) {
  if (!user || typeof user !== "object" || !user._id) return null;
  return { _id: String(user._id), name: user.name, role: user.role };
}

function toSummary(doc) {
  return {
    _id: String(doc._id),
    title: doc.title,
    region: doc.region,
    status: doc.status,
    author: toActor(doc.author),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** List item: no `body`, no `reviewHistory` — the detail read carries those. */
export function toWorkflowKnowledgeSummaryDTO(doc) {
  return toSummary(doc);
}

/** Full workflow article, for the detail read. */
export function toWorkflowKnowledgeDTO(doc) {
  return {
    ...toSummary(doc),
    body: doc.body,
    reviewHistory: (doc.reviewHistory ?? []).map((entry) => ({
      decision: entry.decision,
      reviewer: toActor(entry.reviewer),
      ...(entry.feedback !== undefined ? { feedback: entry.feedback } : {}),
      timestamp: entry.timestamp,
    })),
  };
}
