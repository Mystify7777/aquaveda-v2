# ADR-0012: Administrator targeting, last-Admin protection, and administrative recovery (resolves #249)

## Status

Accepted (2026-11-23) as the authoritative administrator-targeting policy.
**Policy locked; enforcement pending.** This ADR is documentation only: it
changes no code, route, schema, or UI. The current `mute`, `suspend`, and lift
endpoints (#174, #175, #207) do **not** yet enforce it (see "Compliance gap").
Backend enforcement is owned by **#255** (implementation-only), and the other
follow-ups are listed below. **#250** is the read-only Admin directory/detail
UI: it consumes this policy for presentation only and implements no governance
mutation. Dependency chain: #249 (this policy) -> #255 (backend enforcement) ->
#250 (read-only Admin UI).

Supersedes the "no rule invented" notes in GOV-M6, GOV-S7,
`mute-enforcement.md`, and `hard-suspension.md` (retained as history; each now
points here). Completes ADR-0010 §13 for the Admin-as-target case and does not
alter any other ADR-0010 decision.

## Context

Facts established from the code and docs at the time of this decision:

- All governance mutations (`mute`, `mute/lift`, `suspend`, `suspend/lift`) are
  ADMIN-only. **No check on the target exists**: an Admin can restrict
  themselves, any peer Admin, or every other Admin.
- A MUTED Admin cannot govern (all writes blocked; mute is always temporary and
  self-heals). A HARD_SUSPENDED Admin can do nothing but `/auth/*`. A TEMPORARY
  restriction is lifted by SYSTEM expiry (request path, login path, sweep); an
  INDEFINITE suspension ends only by an Admin lift (or an appeal, not built).
- There is **no product operation that creates, promotes, or demotes an Admin**
  (ADR-0010 §13/non-goals). Admins exist only through the operator-run
  production bootstrap CLI (#102), which is keyed by email, creates a new ADMIN
  independently of other Admins, and reports `unchanged` for an existing ADMIN
  email. It **cannot restore a restricted Admin**.
- Governance events have `actorType` `USER | SYSTEM` only.

Consequences today: one indefinite self-suspension of the only Admin is
unrecoverable by the product *and* by the bootstrap CLI; and one rogue or
compromised Admin can suspend every other Admin, leaving the platform with a
single actor of unchecked power. Both are unacceptable.

## Decision

### D1. Definitions

- **Admin target**: a target account whose `role` is `ADMIN` when the operation
  is evaluated. State is irrelevant: an ACTIVE, MUTED, HARD_SUSPENDED, or
  DELETION_PENDING Admin is equally an Admin target.
- **Governance-capable Admin** (the unit of every count in this ADR): `role =
  ADMIN` **and** *effective* account state ACTIVE, where effective state is what
  the request-path guards compute: persisted ACTIVE, **or** a TEMPORARY
  restriction whose `expiresAt` has passed. An unexpired-MUTED Admin is **not**
  capable (a muted Admin cannot perform governance writes). Counting is
  conservative on purpose. The count is read at operation time; it is never
  cached or stored.
- **Operator**: a human with production deployment access (platform one-off task
  runner plus database secrets) running a sanctioned CLI under the guardrails of
  `docs/ops/production-admin-bootstrap.md` (#102/#109/#110/#118). It is an
  *out-of-band authority*, **not** an application role, not grantable in the
  product, and not reachable over HTTP.

### D2. Targeting matrix

| Actor | Operation | Target | Verdict |
| --- | --- | --- | --- |
| ADMIN | mute, suspend, lift mute, lift suspension | USER or EXPERT | **Allowed** (all existing preconditions unchanged) |
| ADMIN | mute, suspend, lift mute, lift suspension | **self** | **Prohibited** |
| ADMIN | mute, suspend, lift mute, lift suspension | **another ADMIN** (any state) | **Prohibited** |
| OPERATOR | restrict (mute / suspend) an Admin | ADMIN | **Conditionally allowed** (D3 guard, D6 procedure, D7 audit) |
| OPERATOR | lift / restore a restricted Admin | ADMIN | **Allowed** (D6 procedure, D7 audit) |
| SYSTEM | expiry lift of a TEMPORARY restriction | any, incl. ADMIN | **Allowed** (existing behavior) |
| anyone, including the Operator | any operation after which zero governance-capable Admins would remain | ADMIN | **Prohibited, no override** (D3) |

Answers to the #249 questions, in one place:

- Self-mute, self-suspension (temporary or indefinite), self-lift: **prohibited
  for every Admin.** There is no temporary-only carve-out: self-restriction has
  no legitimate product use (an Admin who wants to stop acting can stop), and
  every form of it is a lockout risk.
- Admin A mutes / suspends / lifts Admin B: **prohibited**, for mute and
  suspension alike. The target Admin's current state does not change the verdict
  and does not make anything conditional: protection depends only on role.
- Whether an Admin may change another Admin's governance state generally:
  **no.** Admin accounts are never restricted, lifted, or otherwise changed by
  another Admin through the product.
- Higher capability: **yes.** Restricting or restoring an Admin requires
  Operator authority. The existing ADMIN capability is insufficient and is not
  extended; no `SUPERADMIN` role is introduced.

### D3. Last-governance-capable-Admin invariant (lockout protection)

**I1 is the required invariant: every committed state must retain at least one
governance-capable Admin.** I1 is a requirement on every authority. It is not a
claim that every path is technically serialized; the enforcement guarantee
differs by path and is stated per bullet below.

- No operation by any authority (product, Operator, or future feature) may
  commit a state with zero governance-capable Admins. There is no force flag,
  no override, no emergency exception.
- **Product Admin mutations satisfy I1 by construction**: they cannot touch
  Admin targets at all (D2), so they cannot reduce the Admin set, including in
  the race of two Admins suspending each other (both attempts are rejected,
  `ADMIN_TARGET_PROTECTED`). This needs no cross-document transaction or lock,
  and none is introduced.
- **Operator tooling must preserve I1 under its supported operational model**
  (one Operator run at a time, below). Concurrent Operator runs are outside that
  model and are not technically serialized by the tool.
- The Operator restriction tool must refuse when the capable-Admin count
  **excluding the target** is zero. Remedy: create a replacement Admin with the
  bootstrap CLI first, then restrict. After the write the tool recounts and
  fails loudly if the invariant is violated. The recount is **detection and
  alerting only; it is not a concurrency mechanism**: count-before-write plus a
  recount does not make I1 safe under concurrent Operator runs. The tool relies
  on an **operational constraint**: at most one Operator restrict/restore run
  executes at a time (runbook procedure). The tool does not enforce this:
  concurrent Operator runs are outside the supported model and are not
  serialized, so I1 is guaranteed for the product path and preserved, not
  technically enforced, for the Operator path.
- The same invariant constrains future operations: **no Admin account may enter
  `DELETION_PENDING` (#177) or be permanently deleted/anonymized (#178) if it is
  the last governance-capable Admin.** (This constrains #177/#178; it does not
  resolve GOV-X1.)
- No product operation may change an ADMIN's `role` (unchanged from ADR-0010);
  this keeps the Admin set stable under product control.

### D4. Required authority per operation

| Operation | Minimum authority | Sufficient: existing ADMIN? |
| --- | --- | --- |
| Self mute / self suspension / self lift | none: **prohibited** | n/a |
| Admin -> Admin mute / suspension | **Operator** | **No** |
| Restrict the last capable Admin | none: **prohibited** | n/a |
| Lift another Admin's restriction | **Operator** (or SYSTEM expiry for TEMPORARY) | **No** (peer lift would defeat an Operator action) |
| Restore governance access after lockout | **Operator** | **No** |
| Mute / suspend / lift a USER or EXPERT | ADMIN (unchanged) | Yes |

### D5. Prohibited operations (regardless of ordinary Admin authority)

1. Any Admin restricting or lifting themselves (self-lockout).
2. Any Admin restricting or lifting another Admin through the product
   (peer takeover, mutual lockout).
3. Any operation, by anyone, leaving zero governance-capable Admins
   (last-Admin lockout), including Admin deletion/anonymization of the last one.
4. An Operator action with no recorded reason or audit event (D7), or run
   without the production guardrails.
5. Any product path (endpoint, UI control, appeal outcome, SYSTEM job) that
   changes an Admin's role or restores/lifts an Admin's restriction other than
   expiry of a TEMPORARY restriction.
6. Any state in which an Admin's recovery would depend on something other than
   the Operator or SYSTEM expiry (peer Admins, appeals, self-service). An
   INDEFINITE suspension of an Admin exists only as an Operator act under D3 and
   is lifted only by the Operator.

### D6. Recovery policy

Recovery authority is the Operator. Conditions: production target, explicit
confirmation, independently supplied expected database name, no
command-line secrets (the #102/#109/#110/#118 guardrails), a written reason,
and an audit event (D7).

| Situation | Recovery |
| --- | --- |
| Admin cannot access governance because their account was restricted | Operator restores that account (restore tool, follow-up F2). Peers cannot. |
| System has **no usable** Admin (none governance-capable) | Operator creates a new Admin with the existing bootstrap CLI (a new email; works today regardless of other Admins' state), then restores or retires the others. This is the always-available root recovery. |
| Admin accidentally restricted | Cannot happen through the product (D2). If an Operator restricted wrongly: Operator restore. |
| Restriction expires | TEMPORARY restrictions (all mutes; temporary suspensions) are lifted by SYSTEM expiry, at the request path or at login (the sweep is not required for an Admin to recover because login restores). No human action needed. |
| Permanent (INDEFINITE) restriction on an Admin | Exists only by Operator action; ends only by Operator restore. ADMIN accounts have **no appeal path** (appeals #176 are not defined for Admins and are deferred). |
| Credentials lost on an otherwise ACTIVE Admin | Out of scope (no password authority exists for any role); recovery is the "no usable Admin" row. |
| Operator loses database/deployment access | Out of scope: the project cannot recover administrative control without it. Keep at least two Admin accounts and at least two operators (operational recommendation, not enforced). |

The bootstrap CLI outcome `unchanged` for an existing Admin **does not restore**
state; the runbook must say so (F4).

### D7. Audit semantics

- Rejected operations (D2/D3 refusals) append **no** governance event
  (consistent with ADR-0008 §7); they are visible in request logs only.
- Operator restrict/restore events use the existing action families (`MUTE`,
  `HARD_SUSPEND`, `MUTE_LIFTED`, `SUSPENSION_LIFTED`) with a **new
  `actorType: "OPERATOR"`** (actor absent, like `SYSTEM`; to be added to
  `ACTOR_TYPES` by F2, which changes the governance-event contract) and a
  **required private reason** that includes the Operator's change-record
  identifier. An Operator state change with no event is a failed run, reported
  loudly (the event write is non-transactional per GOV-S9; the tool must say so
  explicitly when the state changed but the event did not).
- SYSTEM expiry events are unchanged.
- Admin-visible history (#181) shows `actorType` and, for `OPERATOR`, no actor
  identity (there is none in the product).

### D8. Consumer contract

**Governance mutation endpoints (backend enforcement: #255)** must, for `mute`, `mute/lift`,
`suspend`, `suspend/lift`:

1. Check order: authenticate -> ADMIN actor -> validate ids -> load target
   (`404` if missing) -> **target protection** -> state preconditions.
2. If `target._id == actor.id`: `403 FORBIDDEN`, `details.reason =
   "SELF_TARGET_PROHIBITED"`. Else if `target.role == "ADMIN"`: `403 FORBIDDEN`,
   `details.reason = "ADMIN_TARGET_PROTECTED"`. Both reasons are added to the
   client-safe allowlist. Protection is evaluated before state, so it never
   reveals a restricted Admin's state.
3. The conditional atomic write pins `role` (not ADMIN) in addition to state and
   `accountStateVersion`; a zero-match never infers `FORBIDDEN` (ADR-0007 §4
   rule) and resolves to `NOT_FOUND` / `STATE_RACE`.
4. A rejected request changes no state, bumps no `accountStateVersion`, deletes
   no session, and appends no event.

**Admin governance UI** (#250 is read-only and renders no mutation controls;
this rule binds it for presentation and any later mutation UI): never render
mute, suspend, or lift controls for a
directory row whose `role` is `ADMIN` or whose `id` equals the signed-in user's
id; show an explanatory line instead ("Administrator accounts are managed by
operators"). The server remains the only authority; the UI must not rely on
having hidden a control. No "request"/"escalate" button is introduced.

**Authorization tests (#255):**

- Matrix: ADMIN actor x {mute, mute-lift, suspend, suspend-lift} x target
  {self, peer ADMIN in ACTIVE / MUTED / HARD_SUSPENDED} -> `403`
  (`SELF_TARGET_PROHIBITED` / `ADMIN_TARGET_PROTECTED`), asserting no state,
  version, session, or event change.
- ADMIN x {USER, EXPERT} targets still succeed (regression).
- Mutual-suspension race: two ADMINs targeting each other concurrently -> both
  `403`; zero state change.
- A target promoted to ADMIN between pre-read and write -> not mutated
  (role-pinned filter).
- Check order: protection precedes state preconditions (`409` never returned
  for an Admin target).
- Non-ADMIN actors (`403`) and anonymous (`401`) unchanged; muted Admin still
  cannot govern.

**Operator tooling (F2) tests:** refuses the last capable Admin; allows
restricting an Admin when another capable Admin exists; recount; audit event
with `actorType: OPERATOR` and required reason; refuses non-production targets
and unconfirmed runs; restore works on a MUTED and a HARD_SUSPENDED Admin; the
bootstrap CLI still never restores.

**Audit docs:** `governance-audit-events.md` records `OPERATOR` as reserved.

## Rationale

- **Role-based protection is the simplest sufficient rule.** It removes
  self-lockout, mutual lockout, rogue-Admin takeover, and the last-Admin race in
  one condition that does not need counts, locks, or transactions.
- **Admins are provisioned out-of-band, so they should be disciplined
  out-of-band.** ADR-0010 already refuses product authority over Admin
  promotion/demotion; restricting an Admin is the same class of act. The
  Operator already owns the only path that creates Admins.
- **I1 is stated over capable Admins, not Admin accounts**, because a muted or
  suspended Admin cannot recover the platform.
- **Operator authority is deliberately not a role**: a new role would be a new
  privilege-escalation surface in the product, exactly what the policy removes.
- **No appeal for Admins** keeps recovery single-path and avoids inventing an
  appeal system (#176 is deferred).

## Alternatives considered

- **Peers may restrict peers, with a last-Admin count guard** - rejected:
  the mutual-restriction race cannot be closed without a lock or transaction
  (ADR-0006: no transactions), and a rogue Admin keeps the power to remove all
  peers.
- **Self-mute/self-suspend allowed for temporary restrictions only** - rejected:
  no product use; an error or expiry race still produces lockout; adds a
  special case to every consumer.
- **A `SUPERADMIN` role or Admin quorum / two-person approval** - rejected:
  new role and approval machinery for a very small Admin population; the
  Operator is already the highest authority.
- **Admins may lift each other's restrictions (but not impose them)** - rejected:
  defeats an Operator restriction and re-creates the peer-authority question.
- **Bootstrap CLI restores existing Admins** - rejected: bootstrap's guarantee
  is "never changes an existing account"; restoration is a different, audited
  act (F2).
- **Allow the Operator to override I1** - rejected: the safe path (create a
  replacement Admin, then restrict) always exists.

## Consequences

- One unambiguous answer to every #249 question (D2-D6); #255 (backend
  enforcement) and #250 (read-only Admin UI) can be built from this document alone.
- Admin-account discipline is an Operator workflow, slower than a product button.
  This is accepted; creating a replacement Admin first is the price of I1.
- **Compliance gap (recorded, not hidden):** until #255 lands, the existing
  endpoints still allow self/peer restriction. The previously documented
  "unresolved/no rule invented" risk (GOV-M6, GOV-S7, `hard-suspension.md`,
  `mute-enforcement.md`) therefore remains **live in code** even though the
  policy is decided. Production must not rely on Admin-targeting safety before
  #255.
- Governance-event contract grows by one `actorType` (`OPERATOR`) in F2.
- #177/#178 gain a last-capable-Admin guard requirement.

## Follow-ups (none is implemented by this ADR)

- **#255** (filed) - backend enforcement of D2, D3 and D8 in the
  account-governance mutation endpoints: self-target protection, Admin-target
  protection, last-capable-Admin protection, atomic role/state/version checks,
  rejection semantics, and the authorization tests. Implementation only; this
  ADR remains the authority.
- **#250** (filed) - read-only Admin directory/detail UI. Consumes this policy
  for presentation only; it implements no governance mutation.

To be filed (not implemented here):

- **F2** - Operator break-glass tool: restrict/restore an Admin, `OPERATOR`
  actor type, last-Admin refusal, recount, audit event.
- **F3** - last-capable-Admin guard in #177 (deletion request) and #178.
- **F4** - runbook: lockout recovery section; state that `unchanged` never restores.
- **F5** - (optional) directory affordance flag so the UI need not infer
  protection from `role`/`id`.

## Explicitly out of scope

Admin credential reset; Admin appeals; multi-person approval; automatic
detection of idle/inactive Admins; Admin promotion/demotion; Operator identity
management; changes to Expert revoke/restore (GOV-X2); deletion policy (GOV-X1).

## References

- Issue #249; enforcement #255; read-only Admin UI #250; related #174, #181, #207, #219
- ADR-0010 (§13, §14), ADR-0007 §4, ADR-0006, ADR-0008 §7
- `docs/architecture/hard-suspension.md`, `mute-enforcement.md`,
  `governance-audit-events.md`, `admin-directory.md`
- `docs/ops/production-admin-bootstrap.md`
- `docs/architecture/decision-register.md` - GOV-T1-T10
