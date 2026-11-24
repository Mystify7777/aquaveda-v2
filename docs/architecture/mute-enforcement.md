# MUTE Enforcement and Expiration

Status: Implemented in #174. Policy source: [ADR-0010](../adr/ADR-0010-account-governance.md)
§2, §4, §13, §14. Builds on [account-state-persistence.md](./account-state-persistence.md) (#171),
[governance-audit-events.md](./governance-audit-events.md) (#172) and
[account-state-enforcement.md](./account-state-enforcement.md) (#173).

A MUTED account is authenticated and read-capable but cannot contribute. The
server decides on every request; nothing depends on the frontend hiding
buttons.

## Enforcement: one fail-closed guard

`contributionRestrictionMiddleware` (`server/src/middleware/contribution-restriction.js`)
is mounted after `authMiddleware` and `accountStateMiddleware` and before every
domain router. For a MUTED actor it rejects **every non-safe HTTP method**
(anything except GET/HEAD/OPTIONS) with `403 ACCOUNT_MUTED`, unless the
operation is on an explicit allowlist. The allowlist is **empty**.

Consequence: a contribution endpoint added in the future is blocked by default;
nothing has to remember to opt in. A test mounts synthetic POST/PUT/PATCH/DELETE
routes behind the same middleware and proves they are blocked, and a drift test
walks the real Express router and fails if any write route exists that is not in
the classified table below.

### Classification (every write route that exists today)

| Surface | Routes | MUTED |
| --- | --- | --- |
| Reads | all GET/HEAD/OPTIONS | allowed |
| Identity / session | `/api/v1/auth/*` (login, refresh, logout, me) — mounted before the guard | allowed |
| Issues | `POST /issues`; acknowledge, start, resolve, verify, fail-verification; remediation grant, accept, decline, release, withdraw, revoke | **blocked** |
| Comments / replies | `POST /comments` | **blocked** |
| Discussions | create; report; hide; unhide | **blocked** |
| Knowledge | create; submit; revise (editing); approve; reject | **blocked** |
| Projects | `POST /projects` | **blocked** |
| Expert application | apply; approve; reject | **blocked** |
| Account governance | `POST /accounts/:id/mute`, `/mute/lift`, `/suspend`, `/suspend/lift` | **blocked** (a muted Admin cannot govern; mute is always temporary, so this self-heals) |

**There are no per-feature exceptions.** Authority acts (lifecycle, review,
moderation) are blocked as well as content creation: the rule is "a muted
account performs no writes", which is simpler and safer than inventing a
contribution/authority split. ADR-0010 deferred the classification of
non-contribution operations; this table is that classification for the routes
that exist. Operations ADR-0010 will need available while muted (appeals #176,
user-owned deletion/recovery #177) do not exist yet and **must be added to
`NON_CONTRIBUTION_WRITE_ALLOWLIST` explicitly, with a documented reason**, when
they are built.

### Response contract

`403` with `code: "ACCOUNT_MUTED"` in the standard envelope
(`{ success:false, data:null, message, code }`). `ACCOUNT_MUTED` is a new code
(ADR-0010 locks only `ACCOUNT_SUSPENDED`); the HTTP status follows the other
account-state codes. No restriction details (expiry, safe reason) are included
yet; whether a muted user should see them is deferred.

## Expiry (server-side)

- `accountRestriction.expiresAt` is required for MUTE (always TEMPORARY).
- **Effective state** is computed on every request in `authMiddleware`: a MUTED
  account whose restriction has expired is treated as ACTIVE for that request.
  An expired mute stops blocking immediately, with no job or timer involved.
- **Persisting the lift** (state -> ACTIVE, restriction cleared, version bumped,
  `MUTE_LIFTED` event by the `SYSTEM` actor stamped at `expiresAt`) happens
  best-effort on the first request after expiry via `expireMuteIfDue`. It is
  idempotent and race-safe (conditional on state, version and an expired
  TEMPORARY restriction): concurrent requests, an Admin lift and a sweep produce
  one transition and one event. A failure to persist never blocks or re-blocks
  the request.
- `liftExpiredMutes({ limit })` sweeps due accounts via the
  `account_restriction_expiry` index. Enforcement does not depend on it, and
  **nothing schedules it yet**.
- A MUTED record with no valid restriction cannot expire and stays blocked
  (fail closed).

## Operations (Admin)

| Route | Service | Effect |
| --- | --- | --- |
| `POST /api/v1/accounts/:userId/mute` `{ expiresAt, reason?, safeReason? }` | `muteAccount` | ACTIVE -> MUTED until `expiresAt` (must be in the future; no maximum imposed) |
| `POST /api/v1/accounts/:userId/mute/lift` `{ reason? }` | `liftMute` | MUTED -> ACTIVE |

ADMIN only (service-enforced). Strict bodies; responses are explicit DTOs
(`id`, `accountState`, `accountStateVersion`, `restriction`, `eventId`); the
private `reason` is never returned. Only an ACTIVE account can be muted (other
states are `409 INVALID_STATE`: ADR-0010 leaves other transitions deferred).
> **Historical note (superseded):** this section originally stated that no rule
> was invented about muting Admins or oneself.
> **Current policy:** [ADR-0012](../adr/ADR-0012-administrator-targeting-and-lockout-protection.md)
> (#249): an Admin cannot mute themselves or another Admin. This is
> enforced in code (#255; see [admin-targeting-enforcement.md](./admin-targeting-enforcement.md)).

Each change is one conditional atomic update pinned on state **and**
`accountStateVersion` with `$inc` of the version in the same write, and the
resulting record is checked with `validateAccountRecord` (the #171/#173
invariant). Accounts that pre-date #173 and lack the stored fields are handled
by the filters, so mute/lift/expiry do not depend on the backfill.

Sessions are **not** invalidated by MUTE (ADR-0010 §4): the same access and
refresh tokens keep working; only contribution is blocked.

## Governance events

One event per transition through `recordGovernanceEvent`, idempotency key
`${action}:${targetId}:${newAccountStateVersion}` (so the same transition can
never be recorded twice, and mute -> lift -> mute yields three distinct
events). `MUTE` and admin `MUTE_LIFTED` carry the Admin as actor; expiry lifts
use `actorType: SYSTEM`.

**Known limitation (no transactions, ADR-0006):** the state write and the event
write are two operations. (Since #207 the retry-and-surface step is the shared
`recordTransitionEvent` seam in `services/governance-audit.js`; #204 replaces it.) The event write is retried (idempotent); if it still
fails, the error is logged and surfaced and the state change is **not** rolled
back, so the failure mode is a missing audit event, never a false one. Options
for closing the gap (a transaction on replica sets, or an outbox on the User
document) are not decided here.

## Unresolved / deferred

- Allowlist entries for appeals and deletion/recovery (when built).
- Whether the muted user should see `expiresAt` / a safe reason in the response.
- The audit-event gap above.
- ~~Muting Admins / self-muting: no rule invented; review.~~ **Historical (superseded):** decided by [ADR-0012](../adr/ADR-0012-administrator-targeting-and-lockout-protection.md) (#249): prohibited; enforced by #255.
- Nothing schedules the sweep; the frontend classifies `ACCOUNT_MUTED` / `ACCOUNT_SUSPENDED` and shows state-specific copy (#248, `src/lib/api/account-restriction.ts`).
- The version pin in `muteAccount` is defense in depth: the ACTIVE state filter
  already yields a single concurrent winner, and the tests do not isolate the
  pin (an ABA interleaving cannot be forced deterministically).
- A max/min mute duration is not specified and none is imposed.
