# HARD_SUSPENDED Lifecycle and Enforcement

Status: Implemented in #207. Policy source: [ADR-0010](../adr/ADR-0010-account-governance.md)
§1, §3, §4, §6, §13, §14. Builds on
[account-state-persistence.md](./account-state-persistence.md) (#171),
[governance-audit-events.md](./governance-audit-events.md) (#172),
[account-state-enforcement.md](./account-state-enforcement.md) (#173) and
[mute-enforcement.md](./mute-enforcement.md) (#174). Appeals (#176) and
user-owned deletion/recovery (#177) are out of scope.

## Operations (Admin only, service-enforced)

| Route | Service | Effect |
| --- | --- | --- |
| `POST /api/v1/accounts/:userId/suspend` | `suspendAccount` | ACTIVE -> HARD_SUSPENDED |
| `POST /api/v1/accounts/:userId/suspend/lift` | `liftSuspension` | HARD_SUSPENDED -> ACTIVE |

Suspend body (strict, explicit `kind`):

```text
{ "kind": "TEMPORARY", "expiresAt": "<ISO future>", "reason": "<private>", "safeReason"?: "<user-visible>" }
{ "kind": "INDEFINITE",                              "reason": "<private>", "safeReason"?: "<user-visible>" }
```

`kind` is mandatory so an indefinite suspension can never result from merely
omitting `expiresAt`: TEMPORARY requires a future `expiresAt`, INDEFINITE
forbids it. No maximum duration is imposed. The private `reason` is **required**
(a suspension must be accountable; this is an implementation decision, stricter
than MUTE, where it is optional): a HARD_SUSPEND requires a private administrative
reason for auditability. It is **not** a universal rule for other governance
actions. `reason` is the mandatory internal rationale; `safeReason` is the
optional user-visible explanation. Lift body: `{ "reason"?: "..." }`.

Responses are explicit DTOs (`id`, `accountState`, `accountStateVersion`,
`restriction { kind, expiresAt, safeReason }`, `eventId`); the private `reason`
is never returned and is never stored on `User`.

## Transition and authorization matrix

| From | Operation | Result | Notes |
| --- | --- | --- | --- |
| ACTIVE | suspend (ADMIN) | HARD_SUSPENDED | the only eligible source |
| MUTED | suspend | **rejected** `409 INVALID_STATE` | conservative **implementation-level** safety decision, not an ADR-0010 prohibition: ADR-0010 leaves unstated restriction-state transitions deferred, so none is invented (lift the mute first) |
| HARD_SUSPENDED | suspend | **rejected** `409` | already suspended |
| DELETION_PENDING | suspend | **rejected** `409` | suspension and deletion are separate; an outstanding suspension under deletion is deferred (ADR-0010) |
| PERMANENTLY_DELETED | suspend | **rejected** `409` | terminal |
| HARD_SUSPENDED | lift (ADMIN) / server expiry | ACTIVE | |
| any other state | lift | **rejected** `409` | `liftMute` and `liftSuspension` are not interchangeable |

| Actor | suspend / lift |
| --- | --- |
| anonymous | `401` |
| USER, EXPERT | `403` |
| ADMIN | allowed (a suspended or muted Admin is blocked by the account-state guards first) |
| SYSTEM (expiry only) | lift of an expired TEMPORARY suspension, event `actorType: SYSTEM` |

Every change is one conditional atomic update pinned on state **and**
`accountStateVersion` with `$inc` in the same write; the resulting record is
checked with `validateAccountRecord`. Accounts that pre-date #173 and lack the
stored fields are handled by the filters (no backfill dependency).

## Enforcement and sessions

- Every authenticated request goes through the existing database-backed
  `accountStateMiddleware` (#173): `403 ACCOUNT_SUSPENDED`, for reads and writes
  alike, using the **effective** state. HARD_SUSPENDED takes precedence over
  MUTED by construction (one state enum), so the response is never
  `ACCOUNT_MUTED`. Anonymous public browsing is unaffected. `/auth/me`,
  login, refresh and logout are mounted before the block, by #173 design:
  `/auth/me` returns only `{ user, accountState }` so a client can route a
  suspended session to a suspension surface.
- **At suspension** all refresh sessions are deleted (ADR-0010 §4).
  Cleanup failure does not undo the suspension: the account is already blocked
  everywhere and a leftover session is inert (the refresh path rejects and
  deletes it).
- **At lift and at expiry** residual sessions are deleted **before**
  eligibility is restored, so an old session can never be resurrected; a failure
  aborts the lift (the account stays suspended) and can be retried. The user
  must log in again (fresh session).
- Login of a suspended account is `403 ACCOUNT_SUSPENDED`; the browser, JWT
  claims and client timers are never state authority.

### Credential generation: no resurrection of access tokens (ADR-0010 §4)

Purging refresh sessions is not enough: an access JWT issued before the
suspension is cryptographically valid until its natural expiry and would work
again the moment the account returned to ACTIVE. The invariant, enforced and
tested:

> Any access credential issued before a suspension is restored (Admin lift,
> automatic expiry, or sweep) remains unusable after restoration. A fresh login
> is required.

Mechanism (no redesign of authentication):

- `User.authGeneration` (optional integer, absent = 0, never exposed). The
  access token carries the generation it was issued under as a `gen` claim,
  **only when non-zero**, so tokens for users who never had credentials
  invalidated are unchanged in shape and legacy tokens/users keep working with
  no backfill.
- Every request compares `token.gen` with the user's current `authGeneration`
  (read fresh from MongoDB, like role and account state). A mismatch is treated
  exactly like an invalid token: no actor.
- The generation is incremented **in the same atomic write that restores
  eligibility** (`$inc` with `accountStateVersion`, in the conditional update),
  for suspension lift, expiry and sweep alike. One restoration = one bump, even
  under concurrent lift/expiry/requests.
- It is bumped at **restoration, not at suspension**: while suspended a stale
  token must still reach `ACCOUNT_SUSPENDED` (the #173 contract the client uses
  to route to a suspension surface); it only becomes unusable once the account
  is eligible again, which is exactly when resurrection would otherwise occur.
- `login()` and `refresh()` sign tokens with the user's current generation
  (login re-reads it after a lazily persisted expiry), so a fresh login after a
  lift produces a token the server accepts.
- **Expiry path:** a request that discovers an expired suspension while
  carrying a pre-suspension token persists the restoration (bumping the
  generation) and is treated as unauthenticated; the token is never promoted to
  an ACTIVE actor, so expiry cannot resurrect it either. The user logs in again.
- MUTE never changes the generation (ADR-0010 §4: MUTE does not invalidate
  sessions); an expired mute does not demand a new login.

Future restorations that require a fresh session (account recovery from
`DELETION_PENDING`, #177; accepted appeals, #176) must use the same
in-the-restoring-write generation bump.

## Expiry (server-side)

- Expiry is evaluated on every authenticated request in `authMiddleware`
  **and at login** (`auth.service`): a TEMPORARY suspension whose `expiresAt`
  has passed is restored. Without the login
  hook an account would stay locked out after expiry, because a suspended user
  has no session to carry a request.
- The lift is then persisted idempotently (`expireSuspensionIfDue`): state ->
  ACTIVE, restriction cleared, version bumped, `SUSPENSION_LIFTED` by the SYSTEM
  actor stamped at `expiresAt`, and the credential generation is incremented.
  Concurrent requests, an Admin lift and a sweep produce one transition, one
  event and one generation bump. Failure to persist never re-blocks the login;
  a request carrying a pre-suspension token is unauthenticated either way (see
  Credential generation).
- INDEFINITE suspensions never expire. A HARD_SUSPENDED record with no valid
  restriction cannot expire and stays blocked (fail closed).
- `liftExpiredSuspensions({ limit })` is a housekeeping sweep over the
  `account_restriction_expiry` index (needed only so stored state and history
  are tidy for accounts that never return). Enforcement does not depend on it
  and nothing schedules it yet.

## Audit consistency (shared seam, depends on #204)

All governance transitions (MUTE, MUTE_LIFTED, HARD_SUSPEND, SUSPENSION_LIFTED)
call one function, `recordTransitionEvent`
(`server/src/services/governance-audit.js`), after their atomic state update.
#207 introduces **no new** state-then-event solution: it extracted #174's
retry-and-surface behavior into that single seam so that the durable model of
#204 (transaction, outbox or reconciliation) replaces exactly one function for
every transition. Until then the behavior is unchanged: the event write is
retried (idempotent, key `${action}:${target}:${newVersion}`); if it still
fails the state change is **not** rolled back, the error is logged and surfaced
(a missing event, never a false one). A test forces that failure and asserts the
state stays committed and no false event exists.

## Privacy

- Private `reason` lives only on the GovernanceEvent; never on `User`, never in
  an API response, never in `ACCOUNT_SUSPENDED` or `/auth/me`.
- `ACCOUNT_SUSPENDED` carries only `code` and `message` (and so does the login
  refusal): no reasons, expiry or restriction. ADR-0010 §5 *permits* exposing
  kind, safe reason, expiry and appeal availability; that user-facing
  projection is deferred to the appeals work (#176), where appeal availability
  becomes real.

## Unresolved / deferred

- MUTED -> HARD_SUSPENDED (escalation) stays rejected as a conservative implementation decision until the governance policy settles it (ADR-0010 leaves it deferred, not prohibited).
- Private `reason` is required for a suspension: review this implementation
  decision.
- No rule about suspending Admins or oneself: an Admin can suspend any ACTIVE
  account including their own, and an indefinite self-suspension locks that
  Admin out until another Admin lifts it. Review before production.
- No maximum or minimum suspension duration (none specified).
- ~~Access-token window~~ **closed** by the credential generation above (it was
  a review-blocking defect: the first draft let a pre-suspension access token
  work again after a lift).
- A racing refresh can leave a residual Session document after suspension; it is
  inert while suspended and purged before restoration.
- Durable audit consistency: #204. Sweep scheduling, user-facing suspension
  details and appeals: later issues.
