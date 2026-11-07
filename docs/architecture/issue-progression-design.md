# Issue progression, accountability and escalation: design proposal (#136)

Status: **Reviewed; D-1..D-11 resolved (section 9). Revision 2.** The binding record is [ADR-0008](../adr/ADR-0008-issue-progression-and-escalation.md) and the decision-register section "Locked: Issue progression, accountability and escalation"; this document is the supporting analysis behind it. Nothing here is implemented: no application code, route, schema or UI is changed by it.

Builds on, and does **not** alter: ADR-0003 (lifecycle), ADR-0005 (embedded history), ADR-0006 (conditional atomic transitions), ADR-0007 (remediation authorization, public activity log), Product Invariants 5, 6, 9, 10.

## 0. Findings that shape the proposal

1. **The lifecycle and its authorization are complete and implemented** (ADR-0003 + ADR-0007, #140/#142). What is missing is (a) a frontend consumer, (b) any way for a non-EXPERT to *challenge* a resolution claim, (c) any between-transitions progress record, and (d) a decision on what "escalation" means.
2. **"Escalation" is currently only a recommendation rule** (`high-severity-escalation`, `recommendation-service.md`): derived guidance, nothing is persisted or sent. This document reserves the word *escalation* for stored, attributable workflow records. The rule id stays (stable consumer contract); UI copy should call it "guidance", not "escalation".
3. **ADR-0007 already chose passive visibility over timers** ("derived 'awaiting review' age, queues of unacknowledged/unassigned issues; no timers") and deferred evidence rules "before the escalation work". Stalls are therefore a *derived read model*, not a stored escalation.
4. **Notifications are already parked** (`docs/future/parking-lot.md`); the expert-application timeline shipped in-app first. Same approach here.
5. **Escalation must be inert by construction:** it never changes `Issue.status`, never creates, accepts or alters a grant, and never confers authority. The only way an escalation affects an Issue is an EXPERT performing an *existing* ADR-0003/0007 operation.

## 1. Lifecycle (unchanged states; precise preconditions)

States: `open → acknowledged → in_progress → resolved → verified` (terminal). **No new status is introduced.** In particular there is no `disputed`, `stalled` or `reopened` status: these are overlays or derived facts, so the state machine stays small and ADR-0006's single-status atomic filters stay valid.

| Transition | Who (capability basis) | Preconditions | `note` | Reversible? | Event recorded |
|---|---|---|---|---|---|
| `null → open` | any authenticated user (report) | valid report | n/a | no | `statusHistory` initial entry |
| `open → acknowledged` | EXPERT (current role) | status `open` | optional | no | `statusHistory` |
| `acknowledged → in_progress` (start) | accepted grantee (grant record) | status `acknowledged`, grant accepted and pinned by `grantId` | optional | no | `statusHistory` |
| `in_progress → resolved` | accepted grantee | status `in_progress`, grant pinned | **required** (resolution statement) | only via failed verification | `statusHistory` |
| `resolved → verified` | EXPERT, never the resolver | status `resolved`, resolver derived from latest history entry | **required** | **no (terminal)** | `statusHistory` |
| `resolved → in_progress` (failed verification) | EXPERT | status `resolved` | **required** | this *is* the only backward edge | `statusHistory`; grant stays active |

- **Invalid:** every edge not listed (ADR-0003). In particular `acknowledged → open`, `in_progress → acknowledged`, `resolved → acknowledged`, any edge out of `verified`, and starting/resolving without an accepted grant.
- **"Reopen" does not exist in V2.** `resolved → in_progress` is failed verification only. A resolution the community disagrees with is handled by the **dispute** record (§4), which an EXPERT answers with the existing `verify` / `fail-verification`. Recurrence after `verified` stays parked (a new Issue, possibly with a future `relatedIssue`).
- **Terminal/non-terminal:** only `verified` is terminal. `resolved` is not (the log continues).
- **Remediation authorization interaction:** unchanged (ADR-0007 §2-§4). Grants never change status; transitions never touch the grant; failed verification keeps the accepted grant. No escalation or dispute operation may read or write `remediation`.

## 2. Accountability: capabilities, not roles

A *capability* is what an actor may do, derived from a **record fact** (a grant) or the **current role**, never from reporter status, ownership, participation or Project membership.

| Capability | Basis | Holder |
|---|---|---|
| `issue.acknowledge` | current role | EXPERT |
| `remediation.grant`, `remediation.withdraw` | current role | EXPERT |
| `remediation.revoke` | current role (governance only) | ADMIN |
| `remediation.accept` / `decline` / `release` | the grant record | the grantee |
| `remediation.start` / `resolve` | accepted grant record | the accepted grantee, nobody else |
| `remediation.progress` (**approved, D-1**) | accepted grant record | the accepted grantee |
| `resolution.verify` / `resolution.fail` | current role + history | EXPERT who is not the resolver |
| `resolution.dispute.raise` (proposed) | authenticated identity only | any signed-in user except the current resolver |
| `resolution.dispute.dismiss` (proposed) | current role + history | EXPERT who is not the resolver (merit); ADMIN who is not the resolver, only for abuse (**D-5**) |

Answers to the requested questions: **acknowledge** EXPERT; **accept responsibility** the named grantee; **start** and **resolve** the accepted grantee; **record progress** the accepted grantee; **verify** an independent EXPERT; **challenge a resolution** any signed-in user except the resolver, with **no authority**: a dispute is a recorded claim that routes attention to an EXPERT, nothing more.

## 3. Audit and event model

**Reuse what exists; add at most two things.**

- `statusHistory` (ADR-0005/0007): already has actor, timestamp, from, to, optional `note`, and the initial `null → open`. It fully satisfies the lifecycle requirement. **No change.**
- `remediationHistory` (ADR-0007): append-only typed responsibility events. **No change** unless D-1 is approved.
- **Integrity expectations (already enforced, restated):** both arrays are append-only (prefix unchanged after every write); one transition appends exactly one entry in the same atomic write; actor identity lives only in history entries; a note is bound to its event and takes that history's audience.
- **Rejected or failed operations are not recorded** in either history (ADR-0007 §8) and so never appear in the log. Operational visibility of failures stays in request logging, not in domain history. This proposal keeps that rule for disputes.
- **Stale state:** unchanged (ADR-0006): conditional atomic writes; zero-match means `STATE_RACE`/`NOT_FOUND`, never `FORBIDDEN`.

**D-1 (progress notes), approved.** Today the accepted assignee can record nothing between `start` and `resolve`, so the reporter sees silence. Decision: a `progress` event in `remediationHistory` (grantee only; status `in_progress`; accepted grant pinned by `grantId`; `note` required, ≤2000; appends one event; never changes status). Public projection: entry `progress_noted`, actor = the assignee (already public once accepted), note **public** (this is its purpose; notes on other responsibility events stay private per §7). Growth bound: cap per grant (50). Rejected alternative: rely on comments, which carry no accountability. It is part of the defined workflow, scheduled as its own slice, not an optional afterthought.

**New structure for disputes (D-2):** an embedded, append-only `Issue.disputeHistory[]` of typed events, mirroring `remediationHistory`:

```
{ type: "raised" | "dismissed" | "upheld" | "closed_verified",
  disputeId: ObjectId,                 // identity of this dispute, set on `raised`
  resolutionRef: Number,               // index of the in_progress->resolved statusHistory entry it challenges
  actor: ObjectId,                     // performer
  timestamp: Date,
  note?: string }                      // `raised`: reason (required); `dismissed`: required; `upheld`/`closed_verified`: none (the transition note is the explanation)
```

- *Open* disputes are **derived** (a `raised` with no closing event), like pending/accepted grants: no mutable status field to drift.
- **Why embedded, not a collection:** no cross-document atomicity is needed (closure rides the same write as the transition); five collections hold; precedent is `User.expertApplication` history and `remediationHistory`. **Alternative:** a sixth `IssueDispute` collection (needs an ADR; would lose single-write closure). Recommend embedded with the caps in §4.

## 4. Escalation matrix

| Type | Verdict | Initiator | Target | Reason/evidence | Ack/response | Changes status? | Activity-log event | Visibility | Abuse bounds | Closure |
|---|---|---|---|---|---|---|---|---|---|---|
| **Request review / attention** | **Derived, not stored** | n/a | n/a | n/a | n/a | no | none | public "waiting on" text + age | nothing to abuse | n/a |
| **Flag a stalled issue** | **Derived, not stored** | n/a | EXPERT queues | n/a | n/a | no | none | EXPERT queue sorted by waiting age; no SLA threshold | none | n/a |
| **Dispute a claimed resolution** | **Stored (new)** | any signed-in user except the resolver | EXPERT answer (no named recipient) | reason **required** (note contract, ≤2000); evidence links **deferred (D-7)** | an EXPERT closes it | **never** | yes: `resolution_disputed`, `dispute_closed` | §6 | below | by `verify`, `fail-verification` or an explicit dismiss |
| **External-authority referral** | **Out of scope** | | | | | | | | | needs organization accounts (parking lot); revisit only with a product requirement |

**Why request-review and stall flags are derived:** a stored "bump" adds no information the state and age do not already carry, is spammable, and without notifications reaches nobody. Instead: (a) EXPERT queues of `open` and unassigned/unaccepted issues and `resolved` awaiting verification, ordered by waiting time (ADR-0007's stated mitigation); (b) a public "what is it waiting on" line. **No threshold labels ("stalled" after N days) are proposed**: that invents an SLA the platform cannot enforce (**D-6**).

**Dispute semantics (precise):**

- An **open** dispute exists only while `status = resolved`; **raising** one is rejected in every other status, in particular on `verified` (terminal; recurrence is parked). Closed dispute history is append-only and remains after the Issue leaves `resolved`.
- A dispute is attached to a **resolution cycle** (`resolutionRef`). After failed verification and a later re-resolution a new cycle begins and new disputes are allowed.
- **Raise:** one open dispute per user per cycle; the resolver cannot raise. **Caps:** at most 5 open disputes per cycle and 20 `raised` events per Issue lifetime (constants, **D-3**); excess is `INVALID_STATE`. **Issue write routes have no rate limiter today**; a limiter on dispute raise (reusing `createRateLimiter`, as the auth and expert-application writes do) is part of the dispute HTTP slice, not an assumption of the current system.
- **Closure (all append events; none edits history):**
  - `fail-verification` closes every open dispute of the cycle as `upheld` **in the same atomic write** as the status entry.
  - `verify` closes every open dispute as `closed_verified` in the same write. A verifier may verify despite open disputes but must have seen them: the write is pinned on `disputeHistory` length, so a dispute raised between the verifier's read and write makes the write fail with `STATE_RACE` and the verifier re-reads it (the same pattern as the `statusHistory` length pin).
  - **Dismiss** (explicit, `note` required): an EXPERT on merit (including duplicate/spurious); ADMIN **only** for abuse (governance, Invariant 9; never `upheld`); **never the resolver of the challenged cycle**, whatever their role (review is independent of the resolution's author). Does not change status; the issue stays `resolved` awaiting verification.
- **No authority effect:** disputing never alters the grant, never blocks `verify`, never forces `fail-verification`. The EXPERT decides.
- **Single-EXPERT limit (ADR-0007) is unchanged:** disputes cannot unblock an issue the sole EXPERT resolved; it still waits for a second EXPERT.

## 5. Capability and decision matrix (who, in which state)

| Operation | open | acknowledged | in_progress | resolved | verified |
|---|---|---|---|---|---|
| acknowledge | EXPERT | n/a | n/a | n/a | n/a |
| grant / withdraw | no | EXPERT | EXPERT | no | no |
| revoke | no | ADMIN | ADMIN | no | no |
| accept / decline / release | no | grantee | grantee | no | no |
| start | no | accepted grantee | n/a | n/a | n/a |
| progress (D-1) | no | no | accepted grantee | no | no |
| resolve | no | no | accepted grantee | n/a | n/a |
| verify / fail-verification | no | no | no | EXPERT not resolver | no |
| raise dispute | no | no | no | signed-in non-resolver | no |
| dismiss dispute | no | no | no | EXPERT (merit) / ADMIN (abuse), neither being the resolver | no |

## 6. Reporter-facing progress and visibility

The reporter has **no special authority** (ownership is not authority). They see what everyone sees, plus their own events (participation) and, if they raised one, their own dispute. Progress for everyone is made legible with a derived, server-computed `nextAction` and `waitingSince` (read model; nothing stored):

| State (public view) | `nextAction` text intent |
|---|---|
| `open` | Waiting for an expert to review it |
| `acknowledged`, no accepted grant | Waiting for someone to take responsibility |
| `in_progress`, no accepted grant | No one is currently responsible; waiting for an expert to assign it |
| accepted grant, `acknowledged` | Waiting for work to start |
| accepted grant, `in_progress` | Work is under way |
| `resolved` | Awaiting independent verification (plus "disputed" when a dispute is open) |
| `verified` | Verified |

**Privacy invariant:** a *pending* grant must be indistinguishable from *no* grant for non-participants (ADR-0007 §7), so the public text above never differs between them. Only participants and EXPERT/ADMIN may see "waiting for <named person> to accept".

| Data | Anonymous / any signed-in | Participant (per event) | Resolver (subject of a dispute) | EXPERT / ADMIN (current role) |
|---|---|---|---|---|
| Status, `statusHistory` + its notes | yes | yes | yes | yes |
| Accepted assignee, `acceptedAt` | yes | yes | yes | yes |
| `nextAction`, `waitingSince` | yes | yes | yes | yes |
| `progress` notes (D-1) | yes | yes | yes | yes |
| "Resolution is disputed" (boolean, **no count**) | yes | yes | yes | yes |
| Dispute exists + outcome type (`upheld`/`dismissed`/`closed_verified`) | yes | yes | yes | yes |
| Dispute reason text | **no** | the disputant | **yes** (D-4) | yes |
| Disputant identity | **no** | the disputant | **no** (D-4) | yes |
| Dismissal note | no | the disputant | yes | yes |
| Raw `disputeHistory` | no | own events only | **never** (projected fields above only) | all |

**D-4 caveat (recorded, not hidden):** hiding the disputant's identity from the resolver is *privacy by interface*, not guaranteed anonymity. The reason text is shown to the resolver and may itself identify the author; the identity is present in the raw history and visible to EXPERT/ADMIN. The product must not promise anonymity, and the dispute form must say what the resolver will see.

**Public activity log (the explicit projection ADR-0007 §8 demands before a new source joins):** `resolution_disputed` (public actor **null**, note **null**, so identity and text stay private) and `dispute_closed` (+ outcome type; note null). `upheld` and `closed_verified` are explained by the already-public transition note. Dismissal notes follow the withdraw/revoke precedent: not public. D-1 adds `progress_noted` (assignee actor, public note: the one exception to "responsibility-event notes are private", because reporter-facing progress is its purpose). The log stays a **derived** read model: sources `statusHistory`, `remediationHistory`, `disputeHistory`; no stored log.

## 7. Notifications

**Not proposed; deferred and recorded** (already in the parking lot). V2 relies on in-app visibility: the reporter's `nextAction`, the dispute state on the Issue page, and EXPERT queues. A future notification decision must settle: recipient identity and consent, never notifying a non-participant about a private event, deduplication, per-recipient rate limits, a provider/secrets owner, and an acknowledgement expectation. None of that is invented here.

## 8. Concurrency and failure behavior

- Every state-changing operation is a state-conditioned single-document atomic write (ADR-0006/0007); no transactions.
- **Dispute raise:** filter `status = resolved`, the observed `statusHistory` length (so it cannot attach to a cycle that has moved), plus `disputeHistory` per-user and cap checks decided in the pre-read and re-validated by a `disputeHistory` length pin; a lost race is `STATE_RACE`.
- **Transition + dispute closure:** one `$set status` + `$push statusHistory` + `$push disputeHistory.$each` write, filter pinned on both history lengths (and the grant for start/resolve). A concurrent raise or dismiss makes it zero-match, never a partial close.
- **Zero-match never infers `FORBIDDEN`** (unchanged).
- Rejected operations append nothing. Errors reuse the existing codes and the allowlisted `reason` set (new reasons, if any, are added deliberately to `http/reasons.js`).
- Dispute operations never read or write `remediation` (an invariant to test, alongside the ADR-0007 Project one).

## 9. Decisions (D-1..D-11), resolved at review

| ID | Question | Decision |
|---|---|---|
| D-1 | Accountable progress notes (`progress` event)? | **Yes.** Part of the workflow; its own slice (step 5) |
| D-2 | Dispute storage | **Embedded `disputeHistory`** (no sixth collection) |
| D-3 | Caps and abuse bounds | **Yes:** 1 open per user per cycle, 5 open per cycle, 20 raised per Issue lifetime, plus a rate limiter on raise; all tested |
| D-4 | Resolver visibility | **Reason visible, identity hidden**, recorded as privacy by interface, not anonymity (§6 caveat) |
| D-5 | Dismissal authority | **EXPERT on merit; ADMIN for abuse only** (never upholds); **the resolver can never dismiss a dispute against their own resolution** |
| D-6 | Stall thresholds / SLA labels | **None.** Age is shown; age is given no meaning |
| D-7 | Evidence for disputes | **Text-only initially;** evidence is a separate URL-policy decision |
| D-8 | Dispute on `verified` / recurrence | **No** (terminal; recurrence stays parked) |
| D-9 | External-authority referral | **Deferred** (needs organization accounts) |
| D-10 | Public disclosure | **Boolean** "disputed", no count |
| D-11 | `high-severity-escalation` recommendation id | **Keep the id;** user-facing wording says "guidance" |

## 10. Implementation decomposition (focused, dependency-ordered)

1. **Decision gate:** review this document, lock D-1..D-11, record **ADR-0008** and decision-register entries (docs only).
2. **[Frontend] Issue-detail lifecycle timeline** (#142 follow-up): render the existing public `activity`, `assignee`, `statusHistory` with the redaction already enforced server-side. **No dependency on anything new**, can start right after step 1 (or now). Includes the "failed verification: remediation continues" copy ADR-0007 requires.
3. **[Frontend] Lifecycle/remediation action UI:** acknowledge, grant, accept/decline/release, start, resolve, verify, fail-verification, withdraw/revoke through the existing routes and `GET /:id/workflow`; capability-driven display (never role-driven guesses), `reason`-aware errors. Depends on 2.
4. **[Backend] Derived progress read model:** `nextAction` + `waitingSince` on the public detail DTO, and EXPERT "needs attention" queues (derived, no thresholds). No schema change. Frontend consumption rides with 2/3.
5. **[Backend] Progress notes (D-1, approved):** `progress` event, route, projection, concurrency tests. Two requirements for this slice: (a) the public progress note is user-controlled content shown to everyone, so the API projection and the frontend must treat it as untrusted text, never markup (the user-content policy, #88); (b) the 50-event cap is **per grant, not per Issue**, so sequential grants can accumulate; the slice documents and monitors aggregate embedded-history growth (a scale guard, not a reason to change the ADR unless grant churn makes the document limit realistic).
6. **[Backend] Dispute domain + persistence:** `disputeHistory`, raise/dismiss services, atomic closure inside `verify`/`fail-verification`, caps, invariants (never touches `remediation`), real-MongoDB concurrency tests.
7. **[Backend] Dispute HTTP/DTO/log:** routes, workflow/public DTO fields, activity-log projection (§6), privacy matrix tests, compatibility ledger.
8. **[Frontend] Dispute UI:** raise, status, outcome, EXPERT answer. Depends on 6 and 7.
9. **Deferred, not scheduled:** notifications, evidence attachments/links, active-expert counting, multi-assignee, external referral, recurrence.
10. **Cleanup:** remove the dormant `AUTHORIZATION_POLICY_UNRESOLVED` enum value (already tracked).

**Execution order: 1 → 4 → 2 → 3 → 5 → 6 → 7 → 8.** Step 5 is a committed part of the workflow, not optional. Steps 2 to 4 deliver most of the reporter-facing value with **no new domain behavior**; the dispute slices (6 to 8) are the only ones that add authority-adjacent semantics; their decisions (D-2 to D-5) are now locked in ADR-0008.

## 10a. Future UI: three distinct kinds of element (so they are not blurred)

The Issue detail must keep these visually and semantically separate. There is **no** single "Escalate" button: it would have no defined meaning.

| Kind | What it is | Examples | Rules |
|---|---|---|---|
| **Derived attention** (read-only) | Facts computed from state and age. Not an action, no authority, no record. | The `nextAction` line ("Waiting for someone to take responsibility"), "waiting 12 days", EXPERT needs-attention queues, "Resolution disputed. An expert review is pending." | Shown to everyone per the visibility matrix; never styled as a button; never claims a deadline or an SLA |
| **Lifecycle actions** (authority) | Operations that change status or responsibility, available only to the capability holder. | acknowledge, grant, accept/decline/release, start, progress note, resolve, verify, fail verification, withdraw/revoke | Rendered only when the server's workflow view says the viewer holds the capability; primary actions of their state; never guessed from role labels |
| **Resolution dispute** (a voice, no authority) | A recorded challenge that routes attention to an EXPERT. | "Challenge this resolution" with a required reason, for a signed-in non-resolver while the issue is `resolved` | Visually **subordinate** to the lifecycle actions (secondary placement and style); says plainly that it requests an expert review and does not change the status; states what the resolver will see (reason, not identity) |

Per state: **resolved + any signed-in non-resolver:** status "Resolved · Awaiting verification" and "Challenge this resolution". **resolved + EXPERT who is not the resolver:** a Verification panel with "Verify resolution", "Return to in progress" and the list of open disputes (reason text, dismiss with a note). **resolved + resolver:** the dispute state and the reasons (not the disputant). **Public/reporter:** "Resolution disputed. An expert review is pending." and, once closed, the outcome type (explained by the already-public transition note).

## 11. What this proposal deliberately does not do

It adds no status, role, permission, collection, route or notification. It does not merge comments or Projects into the activity log (each needs its own projection). It does not give disputes, reporters, Projects or ADMIN any remediation or verification authority, and it does not change ADR-0007.
