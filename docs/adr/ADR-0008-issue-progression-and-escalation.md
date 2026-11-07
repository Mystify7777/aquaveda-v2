# ADR-0008: Issue progression, accountability and escalation (resolves #136)

## Status

Accepted (2026-11-07) after architecture review of the #136 proposal
(`docs/architecture/issue-progression-design.md`). Completes what ADR-0003 and
ADR-0007 listed as out of scope ("escalation/dispute workflows"). **Does not alter**
ADR-0003, ADR-0005, ADR-0006 or ADR-0007: no status, role, permission or grant rule
changes. Documentation only: nothing in this ADR is implemented.

## Context

The lifecycle (ADR-0003) and its authorization (ADR-0007) are implemented and exposed over
HTTP (#140, #142). Four gaps remain:

1. A non-EXPERT cannot challenge a `resolved` claim; only an EXPERT can act on it.
2. Between `start` and `resolve` the accepted assignee can record nothing, so the reporter
   sees silence.
3. "Escalation" exists only as a derived recommendation rule (`high-severity-escalation`),
   which is guidance, not a workflow.
4. Stalled issues have no defined representation; ADR-0007 chose passive visibility over
   timers but did not specify it.

Constraints that bind this decision: authority is never inferred from role, ownership,
reporting, participation or Project membership (ADR-0003, ADR-0007, Product Invariant 9);
five domain collections plus Session; lifecycle state and history share a document
(ADR-0005); every write is a state-conditioned single-document atomic update, no
transactions (ADR-0006); the public activity log is a derived read model and a new source
must define its own public projection before joining it (ADR-0007 §8); notifications are
parked.

## Decision

### 1. Terminology

*Escalation* means a **stored, attributable workflow record**. The recommendation rule id
`high-severity-escalation` is derived guidance, is **kept** (stable id), and user-facing copy
calls it "guidance". Escalation is **inert by construction**: it never changes
`Issue.status`, never creates, accepts, alters or reads a grant, and confers no authority.
The only effect an escalation can have on an Issue is an EXPERT performing an *existing*
ADR-0003/0007 operation.

### 2. Lifecycle (unchanged) and what "reopen" means

`open → acknowledged → in_progress → resolved → verified` (terminal), with exactly the edges,
authority, preconditions and required notes of ADR-0003 and ADR-0007 §3/§6. **No new status.**
There is no `disputed`, `stalled` or `reopened` status. `resolved → in_progress` remains
failed verification only. A resolution the community disagrees with is handled by a
**dispute** (§5), which an EXPERT answers with the existing `verify` / `fail-verification`.
A dispute on `verified` is **not** supported; recurrence remains parked.

### 3. Capabilities

A capability derives from a **record fact** (a grant) or the **current role**, never from
reporter status, ownership, participation or Project membership.

| Capability | Basis | Holder |
| --- | --- | --- |
| `issue.acknowledge`, `remediation.grant`, `remediation.withdraw` | current role | EXPERT |
| `remediation.revoke` | current role (governance only) | ADMIN |
| `remediation.accept` / `decline` / `release` | the grant record | the grantee |
| `remediation.start` / `resolve` / `progress` | the accepted grant record | the accepted grantee only |
| `resolution.verify` / `resolution.fail` | current role + history | an EXPERT who is not the resolver |
| `resolution.dispute.raise` | authenticated identity only | any signed-in user except the current resolver; **no authority** |
| `resolution.dispute.dismiss` | current role + history | an EXPERT who is **not the resolver** (basis `merit`); an ADMIN who is **not the resolver** (basis `abuse` only) |

The resolver of a cycle is the actor of the `in_progress → resolved` `statusHistory` entry
that the dispute's `resolutionRef` points to. The resolver can neither **raise** nor **dismiss**
a dispute against their own resolution, whatever their current role: review of a resolution is
independent of its author (the same principle as `resolverId !== verifierId`).

### 4. Progress notes (`progress`)

A new `remediationHistory` event type `progress`, performed only by the accepted grantee:

- allowed only when `status = in_progress` and the grant is accepted; the write is pinned on
  the exact `grantId` and `actor` (extends ADR-0007 §4); `note` required (the §6 contract of
  ADR-0007, ≤ 2000 characters); appends exactly one event and changes neither `status`,
  `statusHistory` nor `remediation`;
- at most **50** `progress` events per grant (`INVALID_STATE` beyond that);
- events remain after the grant is removed; a new grant gets a new `grantId` and its own count;
- **Public projection:** log entry `progress_noted`, `actor` = the assignee (already public
  once accepted), `note` **public**. This is the one deliberate exception to "notes on
  responsibility events are private" (ADR-0007 §7/§8), because reporter-facing progress is
  its purpose. Raw `remediationHistory` stays private; the exception is the projected log
  entry only.
- Workflow view: the performer and current EXPERT/ADMIN see the raw event under the existing
  participation/role rules.

### 5. Disputes (the only stored escalation)

#### 5.1 Storage

An embedded, append-only `Issue.disputeHistory[]` of typed events, mirroring
`remediationHistory` (no sixth collection; ADR-0005 forbids a generic history abstraction):

```
{ type: "raised" | "dismissed" | "upheld" | "closed_verified",
  disputeId:     ObjectId,        // identity of the dispute, generated on `raised`
  resolutionRef: Number,          // index of the in_progress->resolved statusHistory entry challenged
  actor:         ObjectId,        // performer
  timestamp:     Date,
  note?:         string,          // `raised`: reason (required); `dismissed`: required; `upheld`/`closed_verified`: none
  basis?:        "merit" | "abuse" }   // `dismissed` only: set from the performer's role, never chosen by them
```

*Open* disputes are **derived** (a `raised` with no later event for the same `disputeId`), like
pending/accepted grants: no mutable status field exists to drift. Additive schema only
(`default: undefined`); no migration; no new index.

#### 5.2 Rules

- An **open** dispute can exist only while `status = resolved`, and **raising** a dispute is
  rejected in every other status. Closed dispute history is append-only and remains after the
  Issue leaves `resolved` (for example the `raised` and `upheld` events after a failed
  verification); nothing is deleted, hidden from audit or ignored because the status moved on.
- Attached to a **resolution cycle** (`resolutionRef`). After a failed verification and a
  later re-resolution a new cycle begins and new disputes are allowed.
- **Raise:** reason required (ADR-0007 note contract). Limits: one open dispute per user per
  cycle; at most **5** open per cycle; at most **20** `raised` events per Issue lifetime; a
  rate limiter on the raise route (reusing `createRateLimiter`; Issue write routes have none
  today). Limits are constants; exceeding them is `INVALID_STATE` (`reason` below).
- **Closure** (each closing event is appended; none edits history):
  - `fail-verification` closes **every** open dispute of the cycle as `upheld`, in the same
    atomic write as its `statusHistory` entry.
  - `verify` closes every open dispute of the cycle as `closed_verified`, in the same write.
    A verifier may verify despite open disputes; they are always informed by the pinned
    write (§7), never by luck.
  - **Dismiss** (`note` required): an EXPERT (basis `merit`) or an ADMIN (basis `abuse`
    only), **in either case not the resolver of the challenged cycle**. It never changes
    status; the Issue stays `resolved` awaiting verification. ADMIN can never uphold. The
    resolver is checked against the cycle's `resolutionRef` history entry in the pre-read, and
    the write is pinned on `disputeHistory` length and `statusHistory` length as in §7, so a
    resolver cannot dismiss through a stale snapshot.
- A dispute never blocks, forces or substitutes for `verify`/`fail-verification`, and
  disputing a resolution cannot unblock one the sole EXPERT resolved (ADR-0007's
  single-EXPERT limit is unchanged).
- No dispute operation reads or writes `Issue.remediation`.

#### 5.3 Not stored (derived)

**Request review/attention** and **flag a stalled issue** are not stored: they add no
information the state and age do not carry, are spammable, and reach nobody without
notifications. They are a derived read model (§6).

### 6. Derived progress read model (no storage)

Computed server-side per request and delivered with the Issue detail read:

- `nextAction`, a stable **code** (copy lives in the UI): `awaiting_acknowledgement` (`open`);
  `awaiting_responsible_party` (`acknowledged` or `in_progress` with no **accepted** grant);
  `awaiting_start` (`acknowledged` with an accepted grant); `work_in_progress` (`in_progress`
  with an accepted grant); `awaiting_verification` (`resolved`); `verified`.
- `waitingSince`, the timestamp of the latest status change (the report time for `open`).
- `resolutionDisputed`, a **boolean** (no count) true while any dispute of the current
  cycle is open.

A **pending** grant is indistinguishable from **no** grant for non-participants
(ADR-0007 §7): the public `nextAction` never differs between them. Only participants and
EXPERT/ADMIN may be told "waiting for <named person> to accept".

**No stall thresholds, SLA labels or deadlines.** Age is shown and given no meaning.
EXPERT **needs-attention queues** (unacknowledged; unassigned or unaccepted; `resolved`
awaiting verification), ordered by `waitingSince`, are derived reads; their route shape is
decided in the implementation slice.

### 7. Concurrency and failure (extends ADR-0006/0007; no transactions)

- **Raise:** conditional write with `status = resolved`, the observed `statusHistory` length
  (so it cannot attach to a cycle that has moved) and the observed `disputeHistory` length
  (absent = 0). Cap and per-user checks happen in the pre-read and are re-validated by the
  `disputeHistory` length pin.
- **Transition + closure:** a single write that sets `status`, pushes the `statusHistory`
  entry and `$push`es one closing event per open dispute (`$each`), with the filter pinned on
  **both** history lengths (and, for start/resolve, the grant). A dispute raised or dismissed
  between the pre-read and the write makes it zero-match (`STATE_RACE`), never a partial
  close, and the verifier re-reads the new dispute.
- **Dismiss:** pinned on `disputeHistory` length and `status = resolved`.
- A zero-match write never infers `FORBIDDEN` (unchanged). Operations are not idempotent.
- **Rejected or failed operations append nothing** and are not in the log. Operational
  visibility of failures stays in request logging, not domain history.
- Both pre-existing histories and `disputeHistory` are append-only: no operation edits,
  reorders or removes an entry.

### 8. Visibility

The raw `disputeHistory` is never returned. Filtering is server-side in the DTO mappers; the
two ADR-0007 access rules (role-based by *current* role; participation-based per event)
apply, plus the **subject** of a dispute (the resolver of that cycle).

| Data | Anonymous / any signed-in | Disputant | Resolver | EXPERT / ADMIN |
| --- | --- | --- | --- | --- |
| Status, `statusHistory` + notes, accepted assignee, `nextAction`, `waitingSince` | yes | yes | yes | yes |
| `progress` notes (via the log) | yes | yes | yes | yes |
| "Resolution is disputed" (boolean) | yes | yes | yes | yes |
| Dispute exists and outcome type (`upheld` / `dismissed` / `closed_verified`) | yes | yes | yes | yes |
| Dispute **reason** | no | own | **yes** | yes |
| Disputant **identity** | no | own | **no** | yes |
| Dismissal note | no | own | yes | yes |
| Raw `disputeHistory` | no | own events | **never** (projected fields only) | all |

**D-4 caveat (binding):** hiding the disputant's identity from the resolver is *privacy by
interface*, not guaranteed anonymity. The reason text is shown to the resolver and may itself
identify its author, and the identity is retained in the raw history and visible to
EXPERT/ADMIN. The product must not promise anonymity, and the dispute form must state what
the resolver will see.

#### Public activity-log projection (the contract ADR-0007 §8 requires)

The log stays a **derived** read model over `statusHistory`, `remediationHistory` and
`disputeHistory`; no log is stored.

| Source event | Log `type` | Public `actor` | Public `note` |
| --- | --- | --- | --- |
| `remediationHistory` `progress` | `progress_noted` | the assignee | the note |
| `disputeHistory` `raised` | `resolution_disputed` | none | none |
| `disputeHistory` `dismissed` | `dispute_closed` (+ outcome `dismissed`) | none | none |
| `disputeHistory` `upheld` | `dispute_closed` (+ outcome `upheld`) | none | none (the public transition note explains it) |
| `disputeHistory` `closed_verified` | `dispute_closed` (+ outcome `closed_verified`) | none | none |

Ids stay deterministic (`d:<index>`); ordering follows ADR-0007 §8 with `disputeHistory`
after `remediationHistory` as the final tie-break. Comments and Projects remain out of the
log. The log never exposes `disputeId`, dispute reasons, dismissal notes or the disputant.

### 9. Notifications

**Deferred and recorded** (already parked). V2 relies on in-app visibility: `nextAction`,
the dispute state on the Issue page, and EXPERT queues. A future decision must settle
recipient identity and consent, never notifying a non-participant about a private event,
deduplication and rate limits, a provider/secrets owner, and acknowledgement expectations.

### 10. Errors

No new error codes. Proposed client-safe `reason` strings, to be added deliberately to the
allowlist in the HTTP slice: `DISPUTE_RESOLVER_CANNOT_RAISE` (`FORBIDDEN`),
`DISPUTE_ALREADY_OPEN`, `DISPUTE_CAP_REACHED`, `PROGRESS_CAP_REACHED` (`INVALID_STATE`).
Other mapping follows ADR-0007 §10.

### 11. Future UI (binding as principle, not as design)

The Issue detail keeps three kinds of element distinct: **derived attention** (read-only
facts; never a button, never a deadline), **lifecycle actions** (authority; rendered only
when the server's workflow view says the viewer holds the capability), and the **resolution
dispute** ("Challenge this resolution": a voice without authority, visually subordinate to the
lifecycle actions). There is no generic "Escalate" button.

## Invariants the tests must prove

Escalation is inert

1. No dispute operation changes `Issue.status`, appends to `statusHistory` (outside the
   verify/fail-verification write itself), or reads/writes `remediation`.
2. Disputing never grants, accepts or alters a grant, and a disputant gains no authority.
3. Raising a dispute is rejected in every status except `resolved`, including `verified`;
   closed dispute history remains, unmodified and append-only, after the Issue leaves
   `resolved` (a failed verification keeps its `raised` and `upheld` events).

Disputes

4. The resolver of the cycle cannot raise a dispute against their own resolution (whatever
   their role); any other signed-in user can.
5. Limits hold at boundaries: 1 open per user per cycle, 5 open per cycle, 20 per lifetime;
   a new cycle (after failed verification and re-resolution) allows new disputes.
6. `fail-verification` closes all open disputes as `upheld` and `verify` as
   `closed_verified`, exactly one closing event each, in the same write as the status entry;
   a dispute raised or dismissed in between makes the transition fail with `STATE_RACE`
   with nothing partially written (real MongoDB).
7. EXPERT dismissal has basis `merit`, ADMIN dismissal basis `abuse`; ADMIN cannot uphold,
   verify or fail verification; `dismissed` requires a note and never changes status.
8. **The resolver of the challenged resolution cycle cannot dismiss a dispute against that
   resolution, regardless of current role** (tested for an EXPERT resolver, and for an ADMIN
   who was the grantee and resolved), including a dismissal attempted from a stale
   pre-read; a different EXPERT can dismiss the same dispute, and the refused attempt
   appends nothing.
9. A stale dispute raise against a cycle that moved on fails (`STATE_RACE`), never attaching
   to the new cycle.

Progress

10. Only the accepted grantee can record progress, only in `in_progress`, with a required
   note; a pending grantee, any EXPERT without the grant, ADMIN, the reporter and a Project
   member cannot. A stale `grantId` cannot record against a replacement grant.
11. Progress changes neither status nor `remediation`; the 50-per-grant cap holds; events
    survive grant removal.

Visibility and projection

12. Public/list payloads never contain `disputeHistory`, `disputeId`, dispute reasons,
    dismissal notes or the disputant; the resolver sees the reason but not the identity;
    the disputant sees their own dispute; EXPERT/ADMIN see all; role changes follow the
    ADR-0007 promotion/demotion semantics.
13. The log follows the projection table exactly, agrees with the three histories, is absent
    from lists, and a rejected operation produces no entry.
14. `nextAction` for a pending grant equals that for no grant for non-participants;
    `resolutionDisputed` is a boolean with no count.

## Alternatives considered

- **A `disputed` / `stalled` / `reopened` status** — rejected: multiplies the state machine
  and invalidates ADR-0006's single-status filters; these are overlays or derived facts.
- **A stored "request attention" / "stalled" flag** — rejected: spammable, adds no
  information, reaches nobody without notifications.
- **Stall thresholds ("stalled after N days")** — rejected: manufactures an SLA the platform
  cannot enforce.
- **A generic "Escalate" action / button** — rejected: no defined meaning.
- **A `IssueDispute` collection** — rejected: a sixth collection (needs its own ADR) and
  closure could no longer ride the transition's atomic write.
- **A mutable dispute `status` field** — rejected: a second source of truth that can drift
  from an append-only history.
- **Letting a dispute force `fail-verification` or block `verify`** — rejected: makes
  disputes an alternate authorization path; the EXPERT decides.
- **Comments as disputes / progress** — rejected: comments are open discussion with no
  accountability, authority or closure semantics.
- **ADMIN upholds disputes** — rejected: upholding is a domain-quality judgement
  (Product Invariant 9); ADMIN only governs abuse.
- **Disputes on `verified`** — rejected for V2 (recurrence parked).
- **Showing the disputant's identity to the resolver / the dispute count publicly** —
  rejected: retaliation and pile-on risk; a boolean is enough.
- **External-authority referral** — deferred: needs organization accounts, not a V2
  requirement.

## Consequences

- **No new behavior changes the lifecycle or any ADR-0007 authorization.** The additive
  schema is `Issue.disputeHistory` and one new `remediationHistory` event type; no
  migration, no index.
- **EXPERT remains the single decision point** for resolutions; disputes add attention and
  context, not capacity. A one-EXPERT pool still cannot verify its own resolution.
- **Growth** of `disputeHistory` is bounded by the caps (20 raised events plus closures per
  Issue); `remediationHistory` growth gains the 50-per-grant progress bound.
- **The log projection is extended**, so the existing log mapper and its tests change in
  the slices that add each source.
- **Operational cost:** a rate limiter on dispute raise; no other configuration.

## Explicitly out of scope (not decided here)

Notifications; evidence attachments/links for disputes or resolutions; dispute on
`verified` and recurrence; external-authority referral; invalid/duplicate/withdrawn report
dispositions; multi-assignee; stored volunteer offers; grant expiry; counting *active*
experts; merging comments or Projects into the log; route and DTO shapes (decided in the
implementation slices); the Issue-detail UI design.

## Implementation slices (execution order, non-binding on scope)

1. This ADR and the decision-register entries (docs only).
2. Derived progress read model: `nextAction`, `waitingSince`, `resolutionDisputed`
   (always `false` until slice 7) and the EXPERT needs-attention queues.
3. Frontend: Issue-detail lifecycle timeline.
4. Frontend: lifecycle/remediation action UI.
5. Backend: progress notes.
6. Backend: dispute domain and persistence (history, services, atomic closure, caps,
   concurrency tests).
7. Backend: dispute HTTP, DTOs, log projection, rate limiter, privacy tests.
8. Frontend: dispute UI.

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Slices 3 and 4 depend only on the backend that
exists; slices 6 to 8 are the only ones that add authority-adjacent semantics.

Note: the supporting analysis (`docs/architecture/issue-progression-design.md`, section 10) numbers the same steps differently (its order is 1 → 4 → 2 → 3 → 5 → 6 → 7 → 8, where its step 4 is the derived read model that is slice 2 here, its step 2 the timeline, its step 3 the action UI). The order of work is identical.
