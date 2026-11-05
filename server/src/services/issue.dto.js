/**
 * Issue HTTP DTOs (Issue #142, ADR-0007 §7–§8).
 *
 * PURE: no I/O. Every mapper takes PLAIN objects (`doc.toObject()`) plus an
 * `actors` Map (id -> { name, role }) supplied by the caller, and builds its
 * result field by field from an explicit allowlist. A stored field that is not
 * named here is private by default (`remediation`, `remediationHistory`,
 * `grantId`, `grantedBy`, self-grant metadata, `__v`, ...). There is NO
 * raw-document fallback: a mapper that cannot build its result throws.
 *
 * Compatibility (#142): `statusHistory[].actor` stays an id string and its
 * subdocument `_id` is retained; `actorProfile` is added beside it.
 */

const idOf = (v) => (v == null ? null : String(v._id ?? v));

function profile(actors, ref) {
  const id = idOf(ref);
  if (id === null) return null;
  // A populated reference already carries the public fields.
  if (typeof ref === "object" && ref.name !== undefined) {
    return { _id: id, name: ref.name, role: ref.role };
  }
  const found = actors instanceof Map ? actors.get(id) : actors?.[id];
  return found ? { _id: id, name: found.name, role: found.role } : null;
}

/** History entry without actor profile: the pre-#142 shape (string `actor`, subdocument `_id`). */
function toHistoryCore(h) {
  return {
    ...(h._id != null ? { _id: String(h._id) } : {}),
    fromStatus: h.fromStatus ?? null,
    toStatus: h.toStatus,
    actor: idOf(h.actor),
    timestamp: h.timestamp,
    ...(h.note !== undefined && h.note !== null ? { note: h.note } : {}),
  };
}

/** Fields shared by every public Issue shape (no actor references). */
function toIssueCore(plain) {
  return {
    _id: String(plain._id),
    title: plain.title,
    description: plain.description,
    location: { type: plain.location.type, coordinates: [...plain.location.coordinates] },
    ...(plain.locationLabel !== undefined && plain.locationLabel !== null
      ? { locationLabel: plain.locationLabel }
      : {}),
    severity: plain.severity ?? "",
    category: plain.category ?? "",
    domain: plain.domain,
    status: plain.status,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

/** List item: the pre-#142 public fields, explicitly allowlisted, plus `actorProfile` on history. */
export function toPublicIssueSummaryDTO(plain, actors) {
  return {
    ...toIssueCore(plain),
    reportedBy: profile(actors, plain.reportedBy),
    statusHistory: (plain.statusHistory ?? []).map((h) => ({
      ...toHistoryCore(h),
      actorProfile: profile(actors, h.actor),
    })),
  };
}

/**
 * Created issue (201). Deliberately preserves the PRE-#142 contract of this
 * endpoint (`reportedBy` is the reporter's id string; history entries carry
 * no `actorProfile`), minus the persistence-only `__v`. Aligning it with the
 * GET shape is a coordinated follow-up, not part of #142.
 */
export function toCreatedIssueDTO(plain) {
  return {
    ...toIssueCore(plain),
    reportedBy: idOf(plain.reportedBy),
    statusHistory: (plain.statusHistory ?? []).map(toHistoryCore),
  };
}

/** Public assignee: only an ACCEPTED grant is public (from domain projectPublicAssignee). */
function toAssigneeDTO(assignee) {
  if (!assignee) return null;
  return { actor: assignee.actor ?? null, acceptedAt: assignee.acceptedAt };
}

function toActivityEntryDTO(e) {
  return {
    id: e.id,
    type: e.type,
    timestamp: e.timestamp,
    actor: e.actor ? { _id: e.actor._id, name: e.actor.name, role: e.actor.role } : null,
    note: e.note ?? null,
    ...(e.fromStatus !== undefined ? { fromStatus: e.fromStatus } : {}),
    ...(e.toStatus !== undefined ? { toStatus: e.toStatus } : {}),
  };
}

/**
 * Detail read / mutation issue: summary + public assignee (+ activity when
 * supplied — the detail read carries it, mutation responses do not).
 */
export function toPublicIssueDetailDTO(plain, actors, { assignee, activity } = {}) {
  return {
    ...toPublicIssueSummaryDTO(plain, actors),
    assignee: toAssigneeDTO(assignee),
    ...(activity ? { activity: activity.map(toActivityEntryDTO) } : {}),
  };
}

const ACTOR_FIELDS = (a) => (a ? { _id: a._id, name: a.name, role: a.role } : null);

function toWorkflowEventDTO(e) {
  if (e.performerRole !== undefined) {
    // participant view of withdrawn/revoked: type, performer ROLE, time only
    return { type: e.type, performerRole: e.performerRole, timestamp: e.timestamp };
  }
  return {
    type: e.type,
    actor: e.actor ?? null,
    grantee: e.grantee ?? null,
    timestamp: e.timestamp,
    ...(e.note !== undefined ? { note: e.note } : {}),
  };
}

/**
 * Viewer-specific workflow DTO from `projectWorkflowView` output. `grantId`
 * and the self-grant policy basis are stripped here even for role-based
 * viewers (stricter than ADR-0007 §7; no client operation needs them).
 */
export function toWorkflowDTO(view) {
  return {
    state: view.state,
    assignee: toAssigneeDTO(view.assignee),
    pending: view.pending
      ? {
          actor: ACTOR_FIELDS(view.pending.actor),
          grantor: ACTOR_FIELDS(view.pending.grantedBy),
          grantedAt: view.pending.grantedAt,
        }
      : null,
    events: (view.events ?? []).map(toWorkflowEventDTO),
  };
}

/** Mutation response: updated public issue (no activity) + the viewer's own workflow view. */
export function toMutationDTO(issueDTO, workflowDTO) {
  return { issue: issueDTO, workflow: workflowDTO };
}
