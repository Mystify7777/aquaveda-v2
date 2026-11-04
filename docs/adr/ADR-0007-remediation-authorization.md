# ADR-0007: Remediation authorization — explicit, issue-scoped grants (resolves D-3a)

## Status

Accepted (2026-11-01), revised the same day after architecture review. Resolves D-3a.
Completes the two rows ADR-0003 left open (`acknowledged → in_progress`,
`in_progress → resolved`). Does not alter any other ADR-0003 rule.

## Context

ADR-0003 defines the Issue lifecycle and requires an "authorized remediation actor" for
`acknowledged → in_progress` and `in_progress → resolved`, but deferred the mechanism
(D-3a). Until now `changeStatus()` throws `AUTHORIZATION_POLICY_UNRESOLVED` for both
transitions for every role, so **no issue can move past `acknowledged` through the service
layer** and the verification path is unreachable.

Constraints that bind this decision:

- Authority is never inferred from role, ownership, reporting, Project creation or
  membership, or ADMIN (ADR-0003; Product Invariant 9).
- Five domain collections (+ Session). No new collection without an ADR.
- Lifecycle state and history live in the same document (ADR-0005); every lifecycle write
  is a state-conditioned single-document atomic update (ADR-0006). No transactions.
- `resolverId !== verifierId` (derived from history) is a hard invariant, unchanged.
- No flat `resolvedBy` / `verifiedBy` fields for *historical* actors (ADR-0005).

## Decision

### 1. Authority is an explicit, issue-scoped grant

Remediation authority exists only as a **grant** attached to one Issue. It is not a role,
not a Project property, and not derivable from anything else. It is embedded on the Issue
as a single optional subdocument:

```
Issue.remediation?: {
  grantId:    ObjectId            // stable identity of THIS grant, generated at grant time
  actor:      ObjectId (ref User) // the grantee
  grantedBy:  ObjectId (ref User) // an EXPERT at the time of the grant
  grantedAt:  Date
  acceptedAt: Date | null         // null = pending acceptance
}
```

Derived responsibility states (never stored as statuses): **unassigned** (no subdocument),
**pending** (`acceptedAt` null), **accepted** (`acceptedAt` set).

- At most **one** grant per Issue (single assignee in V2).
- `default: undefined`: absent on unassigned and on all existing Issues. No migration.
- A grant never changes `Issue.status`.
- **`acceptedAt` contract:** `null` = pending; a timestamp = accepted. Acceptance happens
  **once** per grant and never rewrites `grantId`, `actor`, `grantedBy`, or `grantedAt`.
  `decline`, `release`, `withdraw` and `revoke` remove the current grant (`$unset`) but the
  corresponding event is preserved in `remediationHistory`. A new grant gets a new `grantId`.

### 2. Grant operations and who may perform them

| Operation  | Who                     | Allowed when (`Issue.status`) | Precondition on the grant | Effect                      | Note         |
| ---------- | ----------------------- | ----------------------------- | ------------------------- | --------------------------- | ------------ |
| `grant`    | EXPERT                  | `acknowledged`, `in_progress` | none exists               | creates a **pending** grant | optional     |
| `accept`   | the grantee only        | `acknowledged`, `in_progress` | pending                   | sets `acceptedAt`           | —            |
| `decline`  | the grantee only        | `acknowledged`, `in_progress` | pending                   | removes the grant           | optional     |
| `release`  | the grantee only        | `acknowledged`, `in_progress` | accepted                  | removes the grant           | optional     |
| `withdraw` | any EXPERT              | `acknowledged`, `in_progress` | pending or accepted       | removes the grant           | **required** |
| `revoke`   | ADMIN (governance only) | `acknowledged`, `in_progress` | pending or accepted       | removes the grant           | **required** |

- ADMIN may **only** `revoke`. ADMIN cannot grant, accept for anyone, start, resolve, or
  verify (Product Invariant 9).
- The grantee may be any existing User (reporter, EXPERT, ADMIN, USER). Holding a grant is
  the *only* source of remediation authority; the grantee's role confers none.
- Grant operations are **not** permitted in `open` (acknowledgement stays mandatory),
  `resolved`, or `verified`. In `resolved`/`verified` the subdocument is retained unchanged
  as the record of who was responsible.
- Volunteering / "offer to help" is **not stored** in V2. It happens socially (Project,
  comments) and **confers nothing**; an EXPERT must `grant`.
- Pending grants do not expire (no SLA machinery in V2); any EXPERT can `withdraw`.
- Removing a grant never reverts status (no `in_progress → acknowledged` edge). An
  `in_progress` issue with no grant is legal ("no responsible party"); it cannot be resolved
  until a new grant is accepted.

#### Self-grant policy (adaptive)

An EXPERT granting remediation to **themselves** is permitted **only while the EXPERT pool is
small**, so that issues are not stranded for lack of manpower; otherwise grants must come
from a *different* EXPERT.

- Let `expertCount` = number of User accounts with `role = EXPERT`, read at grant time.
- Let `threshold` = `SELF_GRANT_EXPERT_THRESHOLD` (environment, integer ≥ 0, **default 5**,
  validated at startup in `config/env.js`; `0` disables self-grant entirely).
- **Self-grant (grantor = grantee) is allowed iff `expertCount < threshold`.** Granting to
  any *other* user is always allowed (subject to §2 table). Rejected self-grants return
  `FORBIDDEN` with `details.reason = "SELF_GRANT_NOT_PERMITTED"`.
- The count is a **policy input, not part of the authority check**: it is read in the
  pre-read and is *not* in the atomic filter (a count race can at worst admit or reject one
  borderline self-grant; it can never grant authority to a non-grantee). This is a documented
  policy limitation, **not** an atomic guarantee.
- Changing the threshold (or the expert count) **never affects an existing grant**; it only
  governs future self-grants. Acceptance remains a
  separate, explicit operation even for a self-grant.
- A self-grant records its basis on the `granted` event: `selfGrant: true`,
  `expertCount`, `threshold`.
- **Known limits (accepted, revisit in the upgrade pass):** the count is of EXPERT *accounts*,
  not *active* experts, so a pool of 5 mostly-idle accounts disables self-grant while little
  capacity exists (the threshold is adjustable for this reason). With exactly **one** EXPERT,
  a self-resolved issue **cannot be verified** (resolver ≠ verifier) and waits in `resolved`,
  visible as awaiting independent verification, until a second EXPERT exists. There is **no
  verification bypass**; expert capacity is a tracked product risk, not something self-verification
  may paper over.

### 3. Transition authority (completes ADR-0003)

| Transition                                     | Authority                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `open → acknowledged`                          | EXPERT (unchanged)                                                                           |
| `acknowledged → in_progress`                   | **the grantee, with an accepted grant** — no other actor of any role                         |
| `in_progress → resolved`                       | **the grantee, with an accepted grant**; resolution statement (`note`) required              |
| `resolved → verified`                          | EXPERT, never the resolver (unchanged); `note` required                                      |
| `resolved → in_progress` (failed verification) | EXPERT (unchanged); `note` required. The existing accepted grant **stays active**            |

An EXPERT without a grant cannot start or resolve; ADMIN cannot; the reporter cannot; a
Project creator/member cannot.

### 4. The authorization check is atomic with the write, against the exact grant

Checking the grant in a pre-read and then writing leaves a window (TOCTOU) in which the
grant is withdrawn, reassigned, or **removed and re-issued to the same user** (an ABA
replacement). Therefore every write that depends on a grant puts the **exact grant observed
in the pre-read** (`grantId`) in the conditional-update filter (extends ADR-0006):

| Operation               | Atomic filter (in addition to `_id`)                                                                      | Update                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `grant`                 | `status ∈ {acknowledged, in_progress}`, `remediation` absent                                              | `$set remediation`, `$push remediationHistory` |
| `accept`                | `status ∈ {…}`, `remediation.grantId = g`, `remediation.actor = actor`, `remediation.acceptedAt = null`   | `$set remediation.acceptedAt`, `$push` event   |
| `decline`               | same as `accept`                                                                                          | `$unset remediation`, `$push` event            |
| `release`               | `status ∈ {…}`, `remediation.grantId = g`, `remediation.actor = actor`, `remediation.acceptedAt ≠ null`   | `$unset remediation`, `$push` event            |
| `withdraw` / `revoke`   | `status ∈ {…}`, `remediation.grantId = g`                                                                 | `$unset remediation`, `$push` event            |
| start                   | `status = acknowledged`, `remediation.grantId = g`, `remediation.actor = actor`, `acceptedAt ≠ null`      | `$set status`, `$push statusHistory`           |
| resolve                 | `status = in_progress`, `remediation.grantId = g`, `remediation.actor = actor`, `acceptedAt ≠ null`      | `$set status`, `$push statusHistory` (`note`)  |

(`g` = the `grantId` read in the pre-read.) A replacement grant has a different `grantId`, so
a stale `withdraw`/`revoke`/`accept`/`start`/`resolve` can never act on it.

Per-operation flow: pre-read → validate → conditional write.

- **`FORBIDDEN` boundary:** the pre-read returns `FORBIDDEN` when the actor is demonstrably
  unauthorized **in the observed state** (wrong role, not the grantee, self-grant above the
  threshold). A **zero-match write never infers `FORBIDDEN`**: it re-reads and returns
  `NOT_FOUND` (document gone) or `STATE_RACE` (state or grant changed), because a stale
  snapshot cannot prove the actor lacked authority at write time. This is a rule about the
  zero-match branch only, not a ban on `FORBIDDEN`.
- Operations are **not idempotent**: a repeated `accept`/`start` returns `INVALID_STATE`
  (or `STATE_RACE` if concurrent).

### 5. History

- **`Issue.statusHistory[]`** (ADR-0005) gains an optional `note` (§6). Its other fields and
  the initial `null → open` entry are unchanged.
- **`Issue.remediationHistory[]`** is a new embedded, append-only array of typed events,
  deliberately **not** merged with `statusHistory` (different shape and events; ADR-0005's
  "no generic shared history abstraction" stands):

  ```
  { type: "granted" | "accepted" | "declined" | "released" | "withdrawn" | "revoked",
    grantId: ObjectId, actor: ObjectId (performer), grantee: ObjectId, timestamp: Date,
    note?: string,
    selfGrant?: true, expertCount?: number, threshold?: number }   // selfGrant fields only on `granted`
  ```

  It is the complete audit trail of responsibility; `Issue.remediation` is only the *current*
  state (so it does not violate the "no flat `resolvedBy`" rule: it is present state, not a
  historical-actor field). Growth is a capacity assumption, not domain-bounded, same as
  `Knowledge.reviewHistory`; revisit if observed.
- Both histories are **append-only**: no operation edits, reorders, or removes an existing
  entry.

### 6. The `note` contract

- Plain text; normalized (NFC, control/bidi/zero-width removed, runs of 3+ newlines
  collapsed) and trimmed; **non-empty after normalization when required**; **≤ 2000
  characters**. Untrusted; rendered only through the user-content policy (#88), never as HTML.
- **Required** for `in_progress → resolved`, `resolved → verified`, `resolved → in_progress`,
  `withdraw`, `revoke`. **Optional** for `open → acknowledged`, `acknowledged → in_progress`,
  `grant`, `accept`, `decline`, `release`. Enforced **server-side** regardless of client
  validation; legacy entries have none, so the schema keeps it optional.
- A note is bound to the exact transition or event it explains and has **the audience of the
  history it belongs to** (§7); the two histories do not share a visibility policy.
- **Resolution statement:** it must describe the action taken and the outcome. It is a
  *claim*, not proof; the verifier may reject an inadequately supported resolution, with a
  public explanation in the rejection note. No minimum length is imposed. Evidence
  requirements (links/attachments, by issue type) are **out of scope** and will be decided
  before the escalation and verification-evidence work; this ADR does not pretend the note
  solves evidence integrity.

### 7. Visibility

Per ROUTE-L2d public and workflow DTOs stay separate; the raw embedded arrays are **never**
returned. All filtering happens server-side in the DTO mappers (MOD-L2 precedent). Access to
workflow records follows **two independent rules**, evaluated per request:

- **Role-based access** — a user whose *current* role is EXPERT or ADMIN may read workflow
  records according to that role's privileges (table below). This is evaluated at request
  time from the user's current role, so a promotion grants it and a demotion removes it.
  It therefore **does** include historical events the user never took part in.
- **Participation-based access** — any other user may read only the events in which they were
  the **performer (`actor`) or the grantee**. It is tied to the individual event, independent
  of role, and is unaffected by later role changes. Former participants gain nothing beyond
  their own events; participation never grants access to notes the table marks as restricted.

| Data                                                                          | Public | Participation-based (per event) | Role-based (current EXPERT / ADMIN) |
| ----------------------------------------------------------------------------- | ------ | -------------------------------- | ------------------------------------ |
| `statusHistory[]` including its notes                                          | yes    | yes                              | yes                                  |
| Public activity log (§8)                                                      | yes    | yes                              | yes                                  |
| `remediation` when **accepted**: assignee (`PublicActor`) and `acceptedAt`    | yes    | yes                              | yes                                  |
| `remediation` when **pending**                                                | no     | the grantee and the grantor      | yes                                  |
| Raw `remediationHistory` events (identities, `grantId`, self-grant basis)     | no     | only events where they are `actor` or `grantee` | all                    |
| Notes on `granted` / `accepted` / `declined` / `released` events              | no     | participants of that event       | yes                                  |
| Notes on `withdrawn` / `revoked` events                                       | no     | **no**                           | yes                                  |

A removed grantee therefore sees the event type, the performer's **role** (not identity), and
the time of a `withdraw`/`revoke` — but not its note. Anyone may ask an EXPERT for the reason.

### 8. Public issue activity log

Every Issue has a **public, chronological, append-only activity log** recording the actions
performed on it, visible to everyone (anonymous included), spanning the issue's life from
report submission through `verified` (the terminal state, after which no operation is
accepted and nothing further is appended). `resolved` is **not** terminal, so the log continues
through verification or failed verification and any resumed remediation.

- **It is a derived read model, not new storage.** It is projected at read time from
  `statusHistory` and `remediationHistory` and always agrees with them. No third log is stored.
- **Entry shape:** `{ id, type, timestamp, actor: PublicActor | null, note: string | null }`. `id` is deterministic (`h:<index>` / `r:<index>`; sources are
  append-only so ids are stable). Order: `timestamp`, then source (`statusHistory` before
  `remediationHistory`), then index. **Equal-timestamp ordering is a presentation tie-break
  that makes output reproducible; it is not a guarantee of causal order** between the two
  histories (timestamps have millisecond precision). A global sequence number would be
  rigorous but adds stored state and is out of V2 scope.
- **Per-event public projection** (the log shows that an action happened without exposing
  what §7 keeps workflow-only):

  | Source event                                  | Log `type`               | Public `actor` | Public `note`              |
  | --------------------------------------------- | ------------------------ | -------------- | -------------------------- |
  | `statusHistory` `null → open`                  | `report_submitted`       | reporter       | —                          |
  | `statusHistory` any transition                 | `status_changed` (+ from/to) | performer  | the transition note        |
  | `remediationHistory` `granted`                 | `responsibility_offered` | none (grantee not named) | none                       |
  | `remediationHistory` `accepted`                | `responsibility_accepted`| the assignee   | none                       |
  | `remediationHistory` `declined`                | `responsibility_declined`| none           | none                       |
  | `remediationHistory` `released`                | `responsibility_released`| none           | none                       |
  | `remediationHistory` `withdrawn`               | `responsibility_withdrawn` ("by an expert") | none | none                |
  | `remediationHistory` `revoked`                 | `responsibility_revoked` ("by platform administration") | none | none  |

  The public log never exposes `grantId`, raw `remediationHistory`, private remediation notes, or
  internal policy metadata (`selfGrant`, `expertCount`, `threshold`): a self-grant reads as an
  ordinary "responsibility offered" and the assignee becomes public on acceptance. The policy
  basis stays in the private event for audit.

- The log is delivered with the Issue **detail** read, never inside list/Explore payloads.
  Route/DTO shape is decided in the routes slice.
- **V2 scope of "all actions":** every **successful** action that mutates the Issue document
  and is covered by the projection (status transitions and responsibility changes). Rejected
  operations and failed attempts are not recorded in either history and therefore are not in
  the log. Actions recorded in other collections —
  **comments** (their own thread), **Projects** created from the issue, and future
  escalations/progress updates — are **not merged** in V2; each future source must define its
  own public projection before joining the log. The Issue page continues to show them in
  their own surfaces.

### 9. Validity across role changes

A grant's validity derives **only** from the grant record. Neither the grantor ceasing to be
an EXPERT nor any change to the grantee's role affects an existing grant, its acceptance, or
the grantee's authority to start/resolve. Role changes never silently void work in progress;
ADMIN `revoke` and EXPERT `withdraw` are the explicit remedies, each with a recorded event.

### 10. Errors

No new error codes. `AUTHORIZATION_POLICY_UNRESOLVED` is **no longer emitted** (its two call
sites are replaced); the enum value and its HTTP mapping remain until a cleanup issue.
Mapping: unauthenticated → `UNAUTHORIZED`; wrong role / not the grantee / disallowed
self-grant → `FORBIDDEN`; wrong status or grant state → `INVALID_STATE`; missing issue →
`NOT_FOUND`; unknown grantee id → `NOT_FOUND` (details name the resource); malformed ids or
notes → `VALIDATION_FAILED`; lost race → `STATE_RACE`.

### 11. Project relationship (re-asserted)

Creating, joining, or completing a Project never creates, accepts, or alters a grant, and no
Project service reads or writes `remediation`. Verifying an Issue does not complete or close a
Project. "Project contributor" has zero Issue authority.

## Invariants the tests must prove

Authority and grants

1. No actor can `acknowledged → in_progress` or `in_progress → resolved` without being the
   grantee of an **accepted** grant — including EXPERT, ADMIN, reporter, Project creator.
2. A pending grant confers no transition authority.
3. Only EXPERT can `grant`/`withdraw`; only the grantee can `accept`/`decline`/`release`;
   ADMIN can only `revoke`; ADMIN cannot grant, start, resolve, verify.
4. Single grant per issue; concurrent `grant` calls produce exactly one success.
5. Grant operations are rejected in `open`, `resolved`, `verified`; they never change `status`
   or `statusHistory`; transitions never remove or alter `remediation`.
6. **Self-grant:** rejected (`FORBIDDEN`, reason `SELF_GRANT_NOT_PERMITTED`) when
   `expertCount ≥ threshold`; allowed when `expertCount < threshold` (boundary tested at
   `threshold − 1`, `threshold`, `threshold + 1`; threshold `0` disables it); a grant to a
   different user is unaffected; the self-grant event records `selfGrant`, `expertCount`,
   `threshold`; acceptance is still a separate operation; changing the threshold or the expert
   count does not affect an existing grant. `SELF_GRANT_EXPERT_THRESHOLD` is validated at
   startup (non-integer, negative, or absurd values fail fast; unset ⇒ 5).
7. Resolver ≠ verifier still holds, including self-grant → self-resolve → self-verify
   (verification by the resolver is rejected; with one EXPERT the issue stays `resolved`).
8. Failed verification (`resolved → in_progress`) keeps the accepted grant active.

Concurrency (real MongoDB)

9. **Replacement-grant race:** a stale `withdraw`/`revoke`/`accept`/`start`/`resolve` holding
   grant A's `grantId` cannot act on a replacement grant (even to the same user) → `STATE_RACE`.
10. Withdraw/revoke/release between pre-read and write makes a concurrent transition fail
    (`STATE_RACE`), never succeed; a zero-match write never returns `FORBIDDEN`.
11. A role change of the grantor or grantee after the grant leaves the grant and the grantee's
    authority intact (both directions: demoted grantor, promoted/demoted grantee).

History, notes, visibility

12. Every grant operation appends exactly one `remediationHistory` event in the same atomic
    write; every transition exactly one `statusHistory` entry; existing entries are never
    modified (prefix of the array is unchanged after each operation).
13. Required notes are enforced server-side (empty/whitespace-only rejected); notes are
    normalized and bounded.
14. Public DTOs contain no raw `remediationHistory`, no pending grantee, no withdraw/revoke
    notes. Access matrix tested for each class: anonymous; participant (performer/grantee) of
    event X sees X but not other events; a user **promoted** to EXPERT gains role-based access
    to all workflow records; a user **demoted** from EXPERT loses it but keeps participation
    access to their own events; withdrawn/revoked notes are visible only through role-based
    access (never through participation).
15. **Public activity log:** every **successful** operation that mutates the Issue document
    and is covered by the projection produces exactly one corresponding log entry; rejected
    operations and failed attempts produce none. Order is deterministic with stable ids
    (equal-timestamp ordering is a presentation tie-break, not asserted as causal). The log
    follows the §8 redaction table exactly: no grantee identity before acceptance, no notes on
    responsibility events, no `grantId`, no self-grant/policy metadata; it is absent from list
    payloads and agrees with the underlying histories.
16. Creating or joining a Project leaves `remediation` unchanged.

## Alternatives considered

- **Global `REMEDIATOR` role** — rejected: global authority for a local act; role-escalation
  path; violates "authority never inferred from role".
- **Project membership/creation as authority** — rejected: ADR-0003 forbids it; membership is
  self-service.
- **Reporter (owner) remediates** — rejected: ownership inference.
- **EXPERT may start/resolve without a grant** — rejected: role inference; one role could run
  the lifecycle with only verifier independence as a check.
- **ADMIN grants** — rejected: governance ≠ domain authority; ADMIN keeps revoke-only.
- **Self-grant always allowed / always forbidden** — rejected: always-allowed makes the
  explicit grant a formality at scale; always-forbidden strands issues while the EXPERT pool
  is small. The adaptive threshold is the chosen compromise.
- **Self-service "claim this issue"** — rejected: no accountability; a future stored "offer"
  must still require EXPERT approval.
- **Separate `RemediationGrant` collection** — rejected for V2: sixth collection and
  authorization could no longer be checked atomically with the status write (no transactions).
  Revisit only if multiple assignees become a requirement.
- **Matching withdrawals on `actor` instead of `grantId`** — rejected: allows the ABA
  replacement race (§4).
- **Voiding a grant when the grantor loses EXPERT** — rejected: silently invalidates work in
  progress without a lifecycle event (§9).
- **Merging responsibility events into `statusHistory`** — rejected: different shape/growth/
  audience; ADR-0005 forbids a generic shared history abstraction.
- **A stored third "activity log" collection/array** — rejected: duplicates the histories and
  can drift; a derived projection cannot disagree with its sources.
- **Auto-expiring grants / stall timers** — deferred: would invent SLAs the platform cannot
  enforce.

## Consequences

- **Unblocks the lifecycle**: start/resolve/verify become reachable; the D-3a
  `AUTHORIZATION_POLICY_UNRESOLVED` tests are replaced by the invariants above.
- **EXPERT is a gatekeeper and potential bottleneck** (acknowledge, grant, verify). The
  adaptive self-grant relaxes this only for small pools. Passive visibility (derived "awaiting
  review" age, queues of unacknowledged/unassigned issues) is the mitigation; no timers.
- **Operational config:** `SELF_GRANT_EXPERT_THRESHOLD` (default 5). It is a policy knob, not a
  secret; changing it affects only future grants.
- **Single assignee** limits multi-party remediation; more would require the collection
  alternative and a new ADR.
- **Additive schema only** (`remediation`, `remediationHistory`, optional `note`); no migration;
  no new index now. A partial index on `remediation.actor` is added when the "my assignments"
  query ships.
- **API impact (follow-up, not decided here):** explicit operations replace the generic
  `PATCH /issues/:id/status {targetStatus}`; new routes amend the route-count lock; DTO split per
  §7 and the log per §8 get their own decisions.
- **UI note for the UI slice:** after a failed verification the retained grant must not look like
  a stale assignment; the page must say verification failed and remediation continues.
- ADR-0003 deferred this to a "Project/Act authorization design"; this ADR decides it at the
  **Issue** level deliberately, because the authority granted is over an Issue and Projects are
  explicitly not a source of it.

## Explicitly out of scope (not decided here)

Escalation/dispute workflows; evidence attachments/links and per-issue-type evidence rules;
invalid/duplicate/withdrawn report dispositions; multi-assignee; stored volunteer offers;
grant expiry/reminders; counting *active* (not merely existing) experts; merging comments,
Projects, or future event sources into the activity log; notifications; recurrence of `verified`
issues; route/DTO shapes; UI.

## Suggested implementation slices (non-binding)

1. Backend domain: schema fields (`remediation`, `remediationHistory`, `note`), grant operations,
   atomic filters with `grantId`, self-grant policy + env validation, replace the D-3a gates,
   `note` contract, activity-log projection (pure function) and DTO redaction, invariant tests
   (real MongoDB). No routes, UI, or escalation.
2. Routes + public/workflow DTOs (replace generic PATCH) with their own register entries.
3. Read-only lifecycle timeline on the Issue detail page (consumes the activity log).
4. Grant/accept and start/resolve/verify UI.

## Implementation amendments (Issue #140, backend domain slice)

Findings made while implementing against the real code. Each is an implementation
requirement of this ADR, recorded so the rationale survives refactoring.

1. **Private workflow state must not cross the HTTP boundary (M1).** Routes serialize raw
   Mongoose documents and Mongoose returns every stored field on read, so adding
   `remediation` / `remediationHistory` would have exposed pending grantees and private notes
   in every public and PATCH response. `Issue` now has a `toJSON` transform that strips both
   fields; internal code reads them as document properties and `toObject()` is unaffected.
   Consequence: the accepted assignee is **not** visible over HTTP until the routes/DTO slice
   wires the pure projections (`domain/issue-activity.js`). `statusHistory[].note` is public by
   §7 and serializes normally.
2. **`statusHistory` length is part of every transition's atomic filter (M2) — a concurrency
   correctness requirement, not a test workaround.** The previous filter pinned only `status`.
   A status can return to a value the pre-read already saw (`resolved → in_progress →
   resolved`), so a decision derived from the pre-read ("the resolver is A, so B is
   independent") could be silently stale; this let a resolver verify their own resolution
   (reproduced against real MongoDB). History is append-only, so an unchanged length means no
   transition was recorded since the pre-read. This is the status-level analogue of pinning the
   exact `grantId`, and it extends ADR-0006. Do not remove it when simplifying `changeStatus`.
3. **Check order does not reveal private grant state.** Grantee-only operations
   (`accept`/`decline`/`release`) answer `FORBIDDEN` uniformly to anyone who is not the current
   grantee, whether or not a grant exists; start/resolve check status legality first (public),
   then answer `FORBIDDEN` to non-grantees uniformly, and `INVALID_STATE` (`GRANT_NOT_ACCEPTED`)
   only to the grantee of a still-pending grant. Note validation follows authorization.
4. **`changeStatus(actor, id, target, { note })`**: the optional fourth argument is additive.
   The existing `PATCH /issues/:id/status` route passes no note and is unchanged, so
   resolve/verify/reject cannot be completed over HTTP in this slice; this is moot because
   no grant routes exist yet. For the two formerly D-3a-gated transitions the route now
   returns `403 FORBIDDEN` (no accepted grant) instead of `409 AUTHORIZATION_POLICY_UNRESOLVED`.
5. **Project isolation:** `createProject` reads only `Issue.status` (`.select("status")`).
6. The expert count for self-grant is read only on the self-grant path (no supporting index is
   added; none is allowed in this slice).
