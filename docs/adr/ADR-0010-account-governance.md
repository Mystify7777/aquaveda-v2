# ADR-0010: Account governance — lifecycle, suspension, deletion, and Admin authority (records #168)

## Status

Accepted. Records the decisions locked in Issue #168; recorded in this
repository by #170 (2026-11-16). This ADR is a **recording**: every
decision below is taken from #168 and introduces no new policy. Where this
repository's existing code or documents overlap or disagree, the overlap is
listed under "Reconciliation with existing decisions" and not silently
resolved.

This ADR does not implement account governance. No schema, migration, route,
service, or frontend change is made by it. Implementation proceeds in the
focused follow-up issues; [#173](../architecture/account-state-enforcement.md)
(authenticated-request enforcement) already exists and is referenced, not
restated.

Decisions marked **Deferred** are intentionally undecided here and are
collected in "Deferred decisions".

## Source and authority

Hierarchy, highest first:

1. **Locked decisions** — the final locked Resolution of Issue #168, recorded
   in "Decision" §1–§15. Where comment-level discussion on #168 is not
   reflected in that Resolution, it is not treated as authoritative unless
   separately confirmed.
2. **Derived artifacts** — the lifecycle, suspension, appeal, and
   deletion/recovery diagrams and the state, session, data-disposition,
   Admin-capability, audit, and evasion matrices. #168 contains no diagrams;
   these are *derived representations* of the locked text, not copies of it.
   Every cell and arrow is stated in, or directly entailed by, the cited
   section. **A derived artifact never adds a decision;** if it appears to,
   the locked text governs.
3. **Implementation details not locked by #168** — listed under "Reconciliation
   with existing decisions" (e.g. #173 specifics). They describe current code
   and do not become governance policy by appearing here.
4. **Reconciliation constraints** (GOV-X1–X4) and **Deferred decisions** —
   explicitly undecided; they are not policy and must not be treated as such.

## Context

AquaVeda has authentication, role-based authority (ADR-0003/0004/0007/0008,
Product Invariant 9), content-level Discussion moderation (ADR-0009, COM-L14–L16)
and database-backed refresh sessions (decision register, "Locked —
Authentication"). It had no account-level lifecycle: no way to restrict an
account's contributions, block a suspended identity, let an owner delete and
recover an account, or bound what an Admin may do to an account.

#168 resolved that gap. This ADR is the stable reference those follow-up
issues cite.

## Locked principles

1. Server-side account state is authoritative.
2. Browser storage is never the security authority.
3. Suspension and deletion are separate concepts.
4. Expert revocation is separate from both.
5. Historical domain facts are not rewritten because current authority changes.
6. The existing JWT/session architecture is preserved unless an implementation
   issue proves a necessary change.
7. No retention period is invented by this architecture.
8. No universal moderation state machine.
9. No device fingerprinting or behavioral surveillance in MVP.
10. Admin authority is capability-specific.

## Decision

### 1. Account state model

A small authoritative account lifecycle, plus **separate** governance /
restriction metadata. Current account state is queryable; governance history is
append-only (§14). A single status enum does not encode governance history.

| State | Meaning |
| --- | --- |
| `ACTIVE` | Normal account access. |
| `MUTED` | Authenticated and read-capable; contribution operations are blocked. |
| `HARD_SUSPENDED` | Authenticated account access blocked except the suspension / appeal / recovery surface. |
| `DELETION_PENDING` | User-owned, recoverable deletion state. |
| `PERMANENTLY_DELETED` | Terminal. |

Transitions stated or directly implied by #168 (nothing else is implied; the
unspecified ones are listed under "Deferred decisions"):

```text
ACTIVE ──mute (Admin)───────────► MUTED
MUTED ──expiry (server) / lift──► ACTIVE

ACTIVE ──hard suspend (Admin)───► HARD_SUSPENDED          (temporary: expiresAt | indefinite: no expiry)
HARD_SUSPENDED ──expiry / Admin lift / accepted appeal──► ACTIVE eligibility (old sessions never resurrected; lift/appeal issue a fresh session)

ACTIVE ──owner requests deletion──► DELETION_PENDING
DELETION_PENDING ──owner recovery──► ACTIVE eligibility (fresh session; an outstanding suspension is not bypassed)
DELETION_PENDING ──recoverable window elapsed, async worker──► PERMANENTLY_DELETED   (terminal)
```

Capability by state (from #168 §1–§4, §6, §9):

| State | Authenticated application use | Read public content | Contribute | Suspension / appeal / recovery surface |
| --- | --- | --- | --- | --- |
| `ACTIVE` | yes | yes | yes (normal authorization) | n/a |
| `MUTED` | yes (read-capable) | yes | **no** (server-evaluated, §2) | n/a |
| `HARD_SUSPENDED` | **blocked** except the suspension/appeal/recovery surface | as an anonymous visitor (§6) | no | **yes** |
| `DELETION_PENDING` | **blocked** (normal use); sessions invalidated | as an anonymous visitor | no | recovery (§9) |
| `PERMANENTLY_DELETED` | blocked; session records removed | as an anonymous visitor | no | n/a (terminal) |

Provenance: derived from §2–§4, §6, and §9; no cell introduces behavior not
stated or directly entailed there. Details #168 does not state (for example
what a `DELETION_PENDING` user sees on the recovery surface) are not specified
here.

### 2. MUTE

- A temporary contribution restriction. A muted user may authenticate and read
  public content but cannot create or modify contribution-bearing resources.
  The server owns the decision.
- Blocked operations include Issue creation, Discussion creation,
  Comments/Replies, Knowledge contribution/editing, and contribution-bearing
  Project actions.
- Ownership-preserving / non-contribution account operations **must be
  explicitly classified**, not implicitly blocked. (**Deferred:** the
  classification itself.)
- Expiry is server-side via `expiresAt`. No security-critical client timer is
  required.

### 3. HARD_SUSPENDED

- Blocks authenticated account activity except the suspension / appeal /
  recovery surface.
- Temporary suspensions use `expiresAt`; indefinite suspensions use no expiry.
  Expiry may restore eligibility automatically but **must not resurrect old
  sessions** (§4).
- The affected user receives a safe suspension reason where policy permits.
  Internal moderation notes are never exposed.
- An Admin may lift a suspension without an appeal. Appeals are a separate
  governance workflow (§8).

```text
ACTIVE ──hard suspend (Admin)──► HARD_SUSPENDED
   on entry:  refresh sessions invalidated; only the suspension / appeal / recovery surface is reachable;
              authenticated requests receive ACCOUNT_SUSPENDED (kind, safe reason, expiry, appeal availability)
   temporary: expiresAt ──expiry──► ACTIVE eligibility (old sessions not resurrected)
   indefinite: no expiry ──► until an Admin lift or an appeal decision (review/appeal policy: deferred)
   any time:  Admin lift (no appeal required) ──► ACTIVE eligibility (fresh session)
```

### 4. Sessions

The existing server-side authority model is preserved: authenticated requests
resolve the current User and account state from persistence, never from stale
JWT claims.

| Event | Session effect |
| --- | --- |
| Enter `HARD_SUSPENDED` | Active refresh sessions invalidated. |
| Enter `DELETION_PENDING` | Active refresh sessions invalidated. |
| Enter `PERMANENTLY_DELETED` | Remaining session records removed. |
| Recovery from `DELETION_PENDING` | Pre-recovery sessions invalidated; a **fresh session** is required. |
| Suspension expiry | Eligibility may be restored automatically; old sessions are **not** resurrected. |
| Suspension lift / accepted appeal | Restoration creates a **fresh session**. |
| Enter `MUTED` | **No** blanket session invalidation; contribution authorization is evaluated server-side. |

Existing access tokens may remain cryptographically valid until expiry, but
become unusable for blocked account states through current account-state checks.

### 5. Suspension response contract

Uses the existing response-envelope/error architecture with the stable
machine-readable code **`ACCOUNT_SUSPENDED`**.

- The response **may** expose: suspension kind, safe reason, expiry, and whether
  an appeal is available.
- It **must not** expose private moderation notes or internal enforcement data.
- The frontend may route an authenticated suspended session to a dedicated
  suspension surface; **routing is not the security boundary.**

### 6. Public routes and anonymous behavior

- Anonymous public browsing remains available (Product Invariant 5).
- `ACTIVE` and `MUTED` users browse public content under normal authorization.
- A `HARD_SUSPENDED` identity cannot use authenticated application
  capabilities.
- A browser that has logged out or otherwise no longer presents the suspended
  identity cannot be reliably identified as that person by ordinary
  public-route handling. **Public-route blocking is therefore not defined as a
  guaranteed identity-level anti-evasion mechanism.**

### 7. Suspension evasion

MVP enforcement is account-based.

| Signal | Status |
| --- | --- |
| Browser storage | Defense-in-depth / risk signal only |
| Signed cookies | Defense-in-depth / risk signal only |
| Device / browser identifiers | Defense-in-depth / risk signal only |
| IP / network signals | Defense-in-depth / risk signal only |
| Session history | Defense-in-depth / risk signal only |
| Account-linking signals | Defense-in-depth / risk signal only |

None is authoritative proof of human identity. A future abuse-prevention system
may evaluate evasion risk with such signals but **must first document**:
purpose, security value, bypassability, privacy impact, retention,
false-positive consequences, and operator visibility. Fingerprinting or
behavioral surveillance is not introduced merely because it is technically
possible.

### 8. Appeals and remediation

- Appeals are first-class governance records with submission, review, decision,
  actor, timestamps, evidence/notes, and audit history.
- Temporary suspensions may expire without an appeal when policy permits;
  indefinite suspensions remain subject to explicit review/appeal policy
  (**Deferred:** that policy).
- Apology/remediation is an **optional policy outcome**, not a universal
  domain requirement.
- Accepted appeals and lift decisions transition the account back to `ACTIVE`
  eligibility. Restoration creates a fresh session.

```text
HARD_SUSPENDED ─┬─ temporary: expiry (policy permitting) ───────────────────┐
                ├─ Admin lift (no appeal required) ─────────────────────────┤
                └─ appeal: submitted ─► reviewed ─► decision                │
                                                      ├─ accepted ──────────┤
                                                      │  (optional remediation, per policy)
                                                      └─ rejected ─► remains HARD_SUSPENDED
                                                                              ▼
                                                        ACTIVE eligibility + FRESH session
```

### 9. User-owned deletion and recovery

- Account deletion is separate from moderation. Only the account owner
  initiates normal account deletion. Admins receive no arbitrary
  account-deletion authority from this architecture.
- Deletion enters `DELETION_PENDING`, invalidates sessions, prevents normal
  authenticated use, and remains recoverable for a **documented retention
  window** (duration: **Deferred**, §10).
- Recovery verifies the account owner, restores `ACTIVE` eligibility where
  policy permits, invalidates old sessions, and issues a new session. Recovery
  after suspension **does not bypass** an outstanding suspension.

```text
ACTIVE ──owner requests deletion──► DELETION_PENDING ──recovery (verified owner)──► ACTIVE eligibility
                                        │  sessions invalidated                       old sessions invalidated
                                        │                                             new session issued
                                        │                                             (outstanding suspension NOT bypassed)
                                        └─ recoverable window elapses ─► async permanent deletion (§10)
```

### 10. Permanent deletion

- Occurs **asynchronously** after the recoverable-deletion boundary.
- **No synchronous multi-collection deletion cascade** is permitted from an
  HTTP request.
- The permanent-deletion worker must be idempotent, retryable, observable, and
  auditable. Session and private-identity cleanup are included. External
  object cleanup is future work if external storage is introduced.
- **No retention period is invented.** The duration must be set by a documented
  product/security/legal policy before implementation is configured.

### 11. Data disposition: Model B → Model C

Initial implementation uses **Model B**:

| Data class | Disposition |
| --- | --- |
| Private identity / account data | DELETE |
| Public / domain contributions | ANONYMIZE |
| Governance / security audit | RETAIN according to policy |
| Sessions / ephemeral credentials | DELETE / PURGE |

The implementation must preserve public/domain history and chronology while
removing direct identity linkage. The architecture is intentionally designed
toward **Model C**: explicit disposition rules per data class and per domain,
not one blanket anonymization rule. Public contributions are not blindly
cascade-deleted.

### 12. Expert revocation

Separate from suspension and deletion: `EXPERT → USER`, with an Admin actor,
mandatory reason, timestamp, and audit event.

- Revocation removes **future** Expert authority. It does not rewrite
  historically valid approvals, reviews, or verifications.
- Current Expert assignments, pending/in-progress reviews, approved Knowledge,
  and application state must be explicitly resolved by implementation policy
  (**Deferred**). Restoration is a separate governance decision (**Deferred**).

### 13. Admin capability boundary

Admin capabilities are explicit and capability-specific.

| Granted to Admin | Not granted by this architecture |
| --- | --- |
| User directory | Automatic authority to promote/demote ADMIN |
| Inspect account state | Arbitrary account deletion |
| MUTE | Changing passwords |
| HARD_SUSPEND | Impersonating users |
| Lift suspension | Bypassing governance controls |
| Review appeals | |
| Expert revoke / restore | |
| Governance history | |
| Deletion notifications | |

### 14. Governance audit

Governance events are **append-only** and capture at least: `actor`, `target`,
`action`, `reason`, `timestamp`, `previousState`, `resultingState`, and relevant
reference IDs.

| Required event family | |
| --- | --- |
| Mute / lift | Hard suspend / lift |
| Appeal submission / resolution | Deletion request / recovery / permanent deletion |
| Expert revoke / restore | |

Visibility is capability-specific:

| Audience | Sees |
| --- | --- |
| Affected user | Safe, policy-relevant information |
| Admin | Governance detail |
| (restricted) | Private enforcement notes remain restricted |

### 15. Admin directory vs analytics

The future Admin directory is a **governance surface**: identity, role, account
state, suspension state, registration time, and relevant governance history.
Usage analytics are a separate concern. Terminology must distinguish:
registered users, active accounts, authenticated sessions, unique authenticated
users, visits, unique visitors, and page views.

## Reconciliation with existing decisions

Nothing below rewrites an earlier decision; each item records an overlap or
tension for the owning implementation issue to settle explicitly.

1. **Product Law 1 / Invariant 10 vs Model B anonymization — a policy
   contradiction requiring resolution before permanent-deletion
   implementation (#178); not an implementation detail.** `domain-model.md`
   states "Every contribution traces to an account (Product Law 1)" and
   Invariant 10 states every issue, comment, article, and project traces to the
   account that created it; `product-invariants.md` requires a new ADR to
   change an invariant. §11 requires public contributions to survive permanent
   deletion with direct identity linkage removed. This ADR does **not** amend
   the invariant and does not pick an interpretation. The decision that must be
   made first: **does permanent deletion preserve internal historical
   attribution, public attribution, both, or neither?** That answer determines
   the anonymization model, and the purge-worker implementation must not choose
   it implicitly.
2. **ADR-0007 invariants constrain the future Expert-revocation policy; #168
   does not yet specify how they interact.** This is an unresolved policy
   intersection, not (yet) a contradiction. ADR-0007 makes remediation
   authority grant-derived rather than role-derived (a grantee may be any
   User) and §9 states role changes never silently void work in progress, so
   `EXPERT → USER` does not by itself invalidate a grant. §12 delegates the
   handling of an Expert's current assignments, pending reviews, approved
   Knowledge, and application state to implementation policy (Expert-revocation
   issue). Until that policy is decided, ADR-0007 §9 stands unchanged.
   Authority that ADR-0007 and ADR-0008 derive from the *current* role follows
   that role as those ADRs already define.
3. **Implementation details of #173 not locked by #168.** #168 locks only the
   code `ACCOUNT_SUSPENDED`. #173 additionally introduced
   `ACCOUNT_DELETION_PENDING` and `ACCOUNT_PERMANENTLY_DELETED`, the HTTP 403
   status, the `accountStateVersion` concurrency field, and refresh-time
   invalidation. These describe current code
   (`docs/architecture/account-state-enforcement.md`), are not governance
   decisions, and are not restated or extended here; #173 does not implement
   MUTE contribution enforcement or any transition.
4. **Session invalidation timing.** #168 §4 states blocked states invalidate
   refresh sessions. #173 enforces this at refresh/request time (all refresh
   sessions are deleted when a blocked account refreshes) and establishes the
   `accountStateVersion` increment invariant that every governance state
   mutation must follow so a concurrent refresh cannot issue a session after a
   blocking transition. Invalidation **at the moment of the transition** is
   the responsibility of the transition issues (#174–#180) per
   `account-state-enforcement.md`.
5. **Existing session decisions are consistent.** Fresh-database role/state
   resolution (register, Authentication L11), single-use refresh rotation, and
   the logout-versus-access-token-expiry trade-off (L17) are preserved: access
   tokens stay cryptographically valid until expiry and are neutralized by
   current-state checks, as §4 states.
6. **Terminology.** "Suspension", "mute", "deletion", and "revocation" apply to
   **accounts** only. Discussion `HIDDEN` / self-hide (ADR-0009, COM-L15) is
   content visibility, not account governance, and COM-L16 excludes suspension
   from Discussion moderation. ADR-0009's "no `DELETED` state" concerns
   Discussion content, not the account state `PERMANENTLY_DELETED`.
7. **Admin authority extends, not replaces, prior decisions.** AUTH-L4
   recorded ADMIN's lack of a concrete capability; #91 (Expert approval) and
   COM-L15 (Discussion moderation) later gave ADMIN concrete powers. §13 adds
   the account-governance capabilities and keeps Product Invariant 9
   (Experts verify, Admins govern).
8. **Registers.** `docs/architecture/decision-register.md` is the canonical
   register. The older `docs/domain/decision-register.md` states it is
   superseded and is not updated.

## Deferred decisions

Intentionally not decided by #168 or this ADR:

- the recoverable-deletion window and any retention duration (product /
  security / legal policy required before configuration);
- classification of ownership-preserving / non-contribution account operations
  under MUTE, and the exact contribution-bearing Project actions;
- indefinite-suspension review/appeal policy; which suspensions permit expiry
  without appeal; whether remediation applies in a given case;
- what counts as a "safe" suspension reason;
- Expert revocation handling of current assignments, pending reviews, approved
  Knowledge, and application state; Expert restoration policy;
- the representation of anonymized contributions and per-domain Model C
  disposition rules;
- how an outstanding suspension is represented while an account is
  `DELETION_PENDING`, and transitions between restriction states not stated in
  §1 (for example `MUTED` ↔ `HARD_SUSPENDED`);
- reconciliation of Product Invariant 10 with Model B (Reconciliation item 1);
- external object cleanup (only if external storage is introduced);
- any suspension-evasion risk system (must satisfy §7 first);
- content and recipients of Admin "deletion notifications";
- analytics definitions and implementation (§15).

## Alternatives rejected (from #168)

- A single status enum encoding governance history — current state and history
  are separate.
- A universal moderation state machine.
- Synchronous multi-collection deletion cascade from an HTTP request.
- A blanket cascade delete of public contributions.
- Admin authority over account deletion, passwords, impersonation, or ADMIN
  promotion/demotion.
- Blanket session invalidation on MUTE.
- Fingerprinting / behavioral surveillance as MVP suspension-evasion defense.
- Treating public-route blocking as identity-level anti-evasion.

## Consequences

- Implementation issues cite this ADR and the register entries GOV-L1–L15
  instead of re-deriving policy; a change to a locked item is a change to
  #168 and is reviewed as such.
- Several implementation policies remain explicitly open (see Deferred) and
  block the issues that depend on them, notably permanent deletion
  (retention, Invariant 10) and Expert revocation (assignments).
- Governance mutation implementations must apply the `accountStateVersion`
  invariant from `account-state-enforcement.md`.

## Non-goals

- No schema, migration, route, service, or frontend change.
- No new governance policy, retention period, or deletion window.
- No resolution of GOV-X1 or GOV-X2 (they belong to the permanent-deletion and
  Expert-revocation implementation decisions).
- No amendment of any existing ADR or Product Invariant.

## Implementation sequencing (non-binding; the issue tracker is authoritative)

```text
#170 this ADR + register
  → account-state persistence → append-only governance audit
  → MUTE → HARD_SUSPENDED → appeals → deletion/recovery
  → permanent deletion (blocked on GOV-X1 and a retention policy)
  → data disposition → Expert revocation (blocked on GOV-X2 policy)
  → Admin directory → threat/security boundaries
```

(#173, authenticated-request enforcement, is already implemented.)

## Implementation amendments

### #172 — Governance audit events use a dedicated collection

§14 requires governance events to be append-only and independent of current
account state. They are therefore stored in their own collection
(`GovernanceEvent`), not on `User`. Append-only is enforced at the application
(Mongoose) boundary; making it authoritative against raw-driver or
out-of-process writes requires database-level permissions, which are an
operations decision outside #172. This is a deliberate addition to the earlier
"five domain collections plus Session" rule (ADR-0007 constraints; the
`verify-models` registered-models guard is updated accordingly). Embedding in
`User` was rejected: it would mix history with state, grow without a domain
bound, and could not carry a different retention/purge disposition (§11
"governance/security audit: RETAIN according to policy"). Details, retry
semantics, and immutability enforcement: `docs/architecture/governance-audit-events.md`.
No other part of this ADR changes.

## References

- Issue #168 (architecture), #170 (this record), #173 (enforcement)
- `docs/architecture/account-state-enforcement.md`
- `docs/architecture/decision-register.md` — "Locked — Account Governance (ADR-0010)", AUTH-L6
- `docs/vision/product-invariants.md` (Invariants 5, 9, 10)
- ADR-0004, ADR-0007 §9, ADR-0008, ADR-0009 (COM-L14–L16)
