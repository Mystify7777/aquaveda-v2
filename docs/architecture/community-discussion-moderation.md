# Community Discussion Moderation Contract

Status: Implemented in #167 against ADR-0009.

This document defines the minimum moderation/reporting contract for first-class
Community Discussions. It deliberately does not introduce account suspension,
reputation, voting, or a full moderation dashboard.

## 1. Visibility

Discussion status remains exactly:

- `ACTIVE`: publicly discoverable/readable.
- `HIDDEN`: unavailable through every anonymous public Discussion read path.

A hidden Discussion is indistinguishable from a nonexistent Discussion through
the public boundary.

The status is server-owned. Ordinary Discussion creation never accepts it.

When a Discussion becomes hidden:

- public Discussion list excludes it;
- public Discussion detail returns the existing `NOT_FOUND` boundary;
- public Discussion Comment reads return the existing `TARGET_NOT_FOUND` boundary;
- new public Discussion comments/replies are rejected;
- existing comments remain stored unchanged;
- Community Activity must exclude it.

No content is deleted as a consequence of hiding.

## 2. Reporting

Only authenticated actors may report a Discussion.

Anonymous reporting is not supported.

A report contains only:

- `discussion`
- `reporter`
- `reason`
- `createdAt`

Report reasons are an allowlist:

- `SPAM`
- `HARASSMENT`
- `MISLEADING`
- `INAPPROPRIATE`
- `OTHER`

Reports are private. They are never included in public Discussion,
Comment, or Community Activity projections.

A Discussion author may not report their own Discussion. Self-reporting adds no
independent moderation signal and is rejected server-side.

A reporter does not receive a report workflow/status in MVP. Submission is
acknowledged; moderation disposition is an internal governance operation.

## 3. Duplicate and abuse controls

A reporter may submit at most one report for a given Discussion.

The database enforces this with a unique compound index on
`{ discussion: 1, reporter: 1 }`. The service also performs the normal
precondition check so the common duplicate path returns a deterministic
conflict.

The report endpoint is additionally rate-limited to 10 requests per hour per
client IP, using the existing V2 sliding-window limiter.

These controls are deliberately narrow. This issue does not introduce
device fingerprinting, behavioral surveillance, account suspension, reputation,
or cross-account abuse scoring.

## 4. Moderation authority

Moderation is governance authority, not Expert domain-quality authority.

- `USER`: may hide their own Discussion.
- `EXPERT`: may not hide or unhide Discussions solely by virtue of the role.
- `ADMIN`: may hide or unhide any Discussion.
- Anonymous actors: may do neither.

Author self-hide is a non-punitive visibility control. The author cannot
unhide the Discussion after hiding it; only an ADMIN may unhide it.

An ADMIN may hide an ACTIVE Discussion or unhide a HIDDEN Discussion. Repeating
an already-applied transition is rejected with `INVALID_STATE`.

ADMIN hide/unhide operations require a short moderation reason (1–500
characters). Author self-hide does not require a reason.

## 5. Moderation audit

Visibility transitions are recorded in an append-only
`Discussion.moderationHistory` array in the same atomic document update as
the status change.

Each entry records:

- actor;
- action;
- fromStatus;
- toStatus;
- optional reason;
- timestamp.

Actions are:

- `AUTHOR_HIDDEN`
- `ADMIN_HIDDEN`
- `ADMIN_UNHIDDEN`

The history is not part of public DTOs.

Report records remain separate from Discussion content. Reports are immutable
submissions; moderation disposition is represented by the Discussion
visibility transition and its audit entry rather than by mutating a reporter's
record.

## 6. HTTP contract

Authenticated reporting:

`POST /api/v1/discussions/:discussionId/reports`

Body:

`{ "reason": "SPAM" | "HARASSMENT" | "MISLEADING" | "INAPPROPRIATE" | "OTHER" }`

Success: 201.

Duplicate report: 409 / `INVALID_STATE`.

Self-report: 403 / `FORBIDDEN`.

Hidden/nonexistent Discussion: 404 / `NOT_FOUND`.

Admin-only report review:

`GET /api/v1/discussion-reports?page=1&limit=20`

The response is an authenticated ADMIN-only read model. It exposes report
identity, reason, timestamp, and the target Discussion's current moderation
status/title. It does not expose private account fields.

Hide:

`POST /api/v1/discussions/:discussionId/hide`

Optional body:

`{ "reason": "..." }`

ADMIN must provide a reason; an author self-hide may omit it.

Unhide:

`POST /api/v1/discussions/:discussionId/unhide`

Body:

`{ "reason": "..." }`

ADMIN only; reason required.

All endpoints use the existing `ApiResponse<T>` envelope.

## 7. Non-goals

This contract does not add:

- anonymous reporting;
- report voting or report thresholds;
- automatic hiding based on report count;
- report notifications;
- reporter-visible disposition/status;
- account suspension or deletion;
- Expert moderation authority;
- a moderation dashboard;
- likes, reputation, karma, or voting;
- content deletion;
- a new moderation state machine.

## 8. Security invariants

The backend remains the authorization boundary.

A report does not itself change Discussion visibility. A malicious or
coordinated group therefore cannot make content disappear merely by submitting
reports.

Every public visibility check continues to derive from the Discussion's
server-owned status. The frontend cannot override or infer this authority.

## 9. Rate-limit deployment boundary

The report endpoint reuses the existing V2 in-memory sliding-window limiter.
Its counters are local to one Node.js process and are not shared between
backend instances. The 10 requests/hour/IP rule is therefore enforced per
process, not globally, when multiple backend instances are running.

This is acceptable for the current single-instance deployment arrangement.
Before scaling the API horizontally, replace the default store with a shared
store (for example Redis/Upstash) while retaining the same limiter interface.
Do not treat the current threshold as a distributed abuse-control guarantee.
