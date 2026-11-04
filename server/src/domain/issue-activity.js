/**
 * Public activity log and workflow visibility projections (ADR-0007 §7–§8).
 *
 * PURE: no I/O. Inputs are plain Issue objects (e.g. `doc.toObject()`) plus an
 * `actorsById` lookup (Map or plain object of id -> { name, role }) supplied
 * by the caller, because this module cannot read the database. Every
 * function returns NEW plain objects; raw `remediationHistory` / `remediation`
 * are never returned as-is.
 *
 * Two independent access rules govern workflow data (ADR-0007 §7):
 *   - role-based: the viewer's CURRENT role is EXPERT or ADMIN;
 *   - participation-based: the viewer is the performer (`actor`) or the
 *     `grantee` of that specific event.
 * The viewer's role is passed on every call, so promotion/demotion takes
 * effect immediately and participation is unaffected by role changes.
 */

const WORKFLOW_ROLES = new Set(["EXPERT", "ADMIN"]);

/**
 * Explicit field allowlists for raw remediation events. A view is BUILT from
 * an allowlist; it is never a copy of the stored event with a few fields
 * deleted, so a field added to the schema later is private by default.
 *
 * - Role-based viewers (current EXPERT/ADMIN) may see the full audit record,
 *   including the grant identity and the private self-grant policy basis
 *   (ADR-0007 §7).
 * - Participants see what happened, who was involved, when, and the note —
 *   but never the grant identity or the policy basis.
 */
const ROLE_EVENT_FIELDS = Object.freeze([
  "type", "grantId", "actor", "grantee", "timestamp", "note", "selfGrant", "expertCount", "threshold",
]);
const PARTICIPANT_EVENT_FIELDS = Object.freeze(["type", "actor", "grantee", "timestamp", "note"]);
const ID_FIELDS = new Set(["grantId", "actor", "grantee"]);

function pickEvent(event, fields) {
  const out = {};
  for (const f of fields) {
    if (event[f] === undefined) continue;
    out[f] = ID_FIELDS.has(f) ? idOf(event[f]) : event[f];
  }
  return out;
}
/** Events whose notes are never visible through participation (governance reasons). */
const ROLE_ONLY_NOTE_TYPES = new Set(["withdrawn", "revoked"]);
const PERFORMER_ROLE = Object.freeze({ withdrawn: "EXPERT", revoked: "ADMIN" });

const idOf = (value) => (value == null ? null : String(value._id ?? value));

function lookupActor(actorsById, id) {
  const key = idOf(id);
  if (key === null) return null;
  const found = actorsById instanceof Map ? actorsById.get(key) : actorsById?.[key];
  if (!found) return null;
  return { _id: key, name: found.name ?? null, role: found.role ?? null };
}

const isWorkflowRole = (viewer) => !!viewer && WORKFLOW_ROLES.has(viewer.role);
const isSame = (a, b) => idOf(a) !== null && idOf(a) === idOf(b);

/** Public log `type` for each remediation event type. */
const LOG_TYPE = Object.freeze({
  granted: "responsibility_offered",
  accepted: "responsibility_accepted",
  declined: "responsibility_declined",
  released: "responsibility_released",
  withdrawn: "responsibility_withdrawn",
  revoked: "responsibility_revoked",
});

/**
 * Public activity log: one entry per successful Issue-document mutation
 * (status transitions and responsibility changes), derived from the two
 * histories, so it can never disagree with them.
 *
 * Redaction (ADR-0007 §8): no grantee identity before acceptance, no notes on
 * responsibility events, no `grantId`, no self-grant/policy metadata.
 * Ordering: timestamp, then source (statusHistory before remediationHistory),
 * then index. Equal-timestamp order is a presentation tie-break, NOT a
 * guarantee of causal order.
 *
 * @returns {Array<{ id: string, type: string, timestamp: Date, actor: object|null, note: string|null,
 *   fromStatus?: string|null, toStatus?: string }>}
 */
export function projectPublicActivityLog(issue, actorsById) {
  const entries = [];

  (issue.statusHistory ?? []).forEach((h, index) => {
    const submitted = index === 0 && (h.fromStatus ?? null) === null;
    entries.push({
      sort: [h.timestamp, 0, index],
      entry: {
        id: `h:${index}`,
        type: submitted ? "report_submitted" : "status_changed",
        timestamp: h.timestamp,
        actor: lookupActor(actorsById, h.actor),
        note: h.note ?? null,
        ...(submitted ? {} : { fromStatus: h.fromStatus ?? null, toStatus: h.toStatus }),
      },
    });
  });

  (issue.remediationHistory ?? []).forEach((e, index) => {
    const type = LOG_TYPE[e.type];
    if (!type) return; // unknown future event types are never published by accident
    entries.push({
      sort: [e.timestamp, 1, index],
      entry: {
        id: `r:${index}`,
        type,
        timestamp: e.timestamp,
        // Only acceptance names a person (the assignee becomes public then).
        actor: e.type === "accepted" ? lookupActor(actorsById, e.grantee) : null,
        note: null,
      },
    });
  });

  return entries
    .sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2])
    .map((x) => x.entry);
}

/**
 * The publicly visible assignee: only an ACCEPTED grant is public; a pending
 * grant (and its grantee) is not.
 *
 * @returns {{ actor: object|null, acceptedAt: Date } | null}
 */
export function projectPublicAssignee(issue, actorsById) {
  const r = issue.remediation;
  if (!r || !r.acceptedAt) return null;
  return { actor: lookupActor(actorsById, r.actor), acceptedAt: r.acceptedAt };
}

/**
 * Remediation events visible to `viewer`, built from explicit allowlists
 * (ADR-0007 §7).
 *
 * - Role-based (current EXPERT/ADMIN): every event, with the audit fields in
 *   ROLE_EVENT_FIELDS (including `grantId` and the self-grant basis).
 * - Participation-based: only events where the viewer is `actor` or `grantee`,
 *   with PARTICIPANT_EVENT_FIELDS only — never `grantId`, `selfGrant`,
 *   `expertCount` or `threshold`. Notes on withdrawn/revoked events are NEVER
 *   included; for those the viewer sees only { type, performerRole, timestamp }
 *   (the performer's ROLE, not identity).
 * - Anyone else (including anonymous): nothing.
 */
export function visibleRemediationEvents(issue, viewer) {
  const events = issue.remediationHistory ?? [];
  if (isWorkflowRole(viewer)) {
    return events.map((e) => pickEvent(e, ROLE_EVENT_FIELDS));
  }
  if (!viewer || !viewer.id) return [];

  const out = [];
  for (const e of events) {
    if (!isSame(e.actor, viewer.id) && !isSame(e.grantee, viewer.id)) continue;
    if (ROLE_ONLY_NOTE_TYPES.has(e.type)) {
      out.push({ type: e.type, performerRole: PERFORMER_ROLE[e.type], timestamp: e.timestamp });
    } else {
      out.push(pickEvent(e, PARTICIPANT_EVENT_FIELDS));
    }
  }
  return out;
}

/**
 * Workflow view for `viewer`: responsibility state, the public assignee, the
 * pending grant, and the events the viewer may see. Never returns the
 * current grant's `grantId` or any raw array.
 *
 * The EXISTENCE of a pending grant is as private as its details (ADR-0007
 * §7): the same rule governs `state` and `pending`. A viewer who may not see a
 * pending grant (anyone other than a role-based viewer, the grantee, or the
 * grantor) gets `state: "unassigned"`, indistinguishable from an issue with no
 * grant. An ACCEPTED grant is public, so `state: "accepted"` is shown to all.
 */
export function projectWorkflowView(issue, viewer, actorsById) {
  const r = issue.remediation;
  const accepted = !!r && !!r.acceptedAt;
  const maySeePending =
    !!r &&
    !accepted &&
    (isWorkflowRole(viewer) || (!!viewer && (isSame(r.actor, viewer.id) || isSame(r.grantedBy, viewer.id))));

  return {
    state: accepted ? "accepted" : maySeePending ? "pending" : "unassigned",
    assignee: projectPublicAssignee(issue, actorsById),
    pending: maySeePending
      ? {
          actor: lookupActor(actorsById, r.actor),
          grantedBy: lookupActor(actorsById, r.grantedBy),
          grantedAt: r.grantedAt,
        }
      : null,
    events: visibleRemediationEvents(issue, viewer),
  };
}
