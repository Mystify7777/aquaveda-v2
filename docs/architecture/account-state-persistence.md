# Account State Persistence

Status: Implemented in #171. Policy source: [ADR-0010](../adr/ADR-0010-account-governance.md)
(records #168). Enforcement at the request boundary: [account-state-enforcement.md](./account-state-enforcement.md) (#173).

This document defines **what is stored** for the current account lifecycle and
which stored combinations are valid. It does not define who may change state,
when, or how (mutation issues #174–#180), and it stores no governance history
(#172).

## Stored shape (`User`)

| Field | Type | Meaning |
| --- | --- | --- |
| `accountState` | enum, required, default `ACTIVE` | `ACTIVE`, `MUTED`, `HARD_SUSPENDED`, `DELETION_PENDING`, `PERMANENTLY_DELETED` (existing, #173) |
| `accountStateVersion` | number ≥ 0, required, default `0` | Concurrency serialization point (existing, #173) |
| `accountStateChangedAt` | Date, absent by default | When the **current** state was entered. Absent on never-restricted (including all legacy) users. |
| `accountRestriction` | subdocument, absent by default | **Current** restriction for `MUTED` / `HARD_SUSPENDED` only |
| `authGeneration` | integer ≥ 0, absent = 0, never exposed | Credential generation (#207): access tokens issued under an older value are rejected; bumped atomically when a suspension is restored. See [hard-suspension.md](./hard-suspension.md) |
| `accountRestriction.kind` | `TEMPORARY` \| `INDEFINITE`, required | Explicit; indefinite is never inferred from a missing expiry |
| `accountRestriction.expiresAt` | Date | Required for `TEMPORARY`; must be absent for `INDEFINITE` |
| `accountRestriction.safeReason` | trimmed string ≤ 500 | The user-visible reason only. Private moderation notes are never stored here. |

`Session.authGeneration` (#219): the credential generation a refresh session was
issued under (optional, absent = 0, stored only when non-zero, so existing Session
records need no migration). `refresh()` accepts a session only when it equals the
user's current `authGeneration`; session cleanup is bound to a generation. See
[hard-suspension.md](./hard-suspension.md) ("Restoration and session-cleanup protocol").

Not stored here (by design): actor, internal notes, `previousState`, event
history, appeal data, deletion-window duration. Those belong to the append-only
governance event model (#172) or are deferred by ADR-0010.

The 500-character `safeReason` bound is a persistence placeholder (no approved
document specifies it), not governance policy.

## Valid combinations (enforced)

Single source: `server/src/domain/account-restriction.js` →
`validateAccountRecord()`; applied by a `User` pre-validate hook.

| `accountState` | `accountRestriction` | `accountStateChangedAt` |
| --- | --- | --- |
| `ACTIVE` | absent | optional |
| `MUTED` | required; `TEMPORARY` with `expiresAt` (mute is a temporary restriction, ADR-0010 §2) | required |
| `HARD_SUSPENDED` | required; `TEMPORARY` + `expiresAt`, or `INDEFINITE` without `expiresAt` | required |
| `DELETION_PENDING` | absent (see Unresolved) | required |
| `PERMANENTLY_DELETED` | absent | required |

Also: `expiresAt` must be after `accountStateChangedAt`; `safeReason`, if
present, is non-empty text.

This is a validity rule for **stored records**, not a transition graph. ADR-0010
states some transitions and defers others (e.g. `MUTED` ↔ `HARD_SUSPENDED`); the
model neither blesses nor forbids them. Terminality of `PERMANENTLY_DELETED`
(`isTerminalAccountState`) is enforced by mutation services via a conditional
filter, not by the schema.

### Where enforcement applies

- Mongoose `save()`/`validate()`: yes, **only when** the document is new or a
  governance path (`accountState`, `accountRestriction`,
  `accountStateChangedAt`) changed. A bad raw record therefore never blocks an
  unrelated save; partial selections skip the check.
- Raw update operators (`updateOne`, `findOneAndUpdate`) bypass Mongoose
  validators. Mutation services (#174–#180) **must** call
  `validateAccountRecord` on the resulting record and use conditional atomic
  updates that also `$inc` `accountStateVersion` in the same write (ADR-0006;
  #173 invariant).
- `toJSON` strips `accountRestriction` (defense in depth). A user-visible
  projection of the restriction is an explicit DTO decision for #175.

### Expiry

`isRestrictionExpired(restriction, now)` defines the data semantics
(`TEMPORARY` expires at `expiresAt`; `INDEFINITE` never). **Nothing evaluates it
yet**: acting on expiry (restoring eligibility, never resurrecting old sessions,
ADR-0010 §3–§4) belongs to #174/#175. Until then no restriction data exists in
any database, so #173 behavior is unchanged.

## Indexes

Both are **partial**; ACTIVE users (the overwhelming majority) have no entries,
so ACTIVE-user writes and index size are unaffected.

| Index | Partial filter | Access path it serves (ADR-0010) |
| --- | --- | --- |
| `account_state_changed` `{accountState, accountStateChangedAt}` | state ∈ {MUTED, HARD_SUSPENDED, DELETION_PENDING} | asynchronous deletion worker finding `DELETION_PENDING` past the recoverable boundary (§10); Admin directory filtering by state (§13) |
| `account_restriction_expiry` `{accountRestriction.expiresAt}` | `accountRestriction.expiresAt` exists | server-side expiry of temporary restrictions (§2, §3) |

`PERMANENTLY_DELETED` is deliberately excluded: it is terminal and no specified access path needs it (the purge worker selects `DELETION_PENDING`; ADR-0010 does not call for listing purged accounts). Widening the filter later is additive.

Tests assert both are declared partial (and the exact state set) and that the corresponding queries use
them (`explain`). On an existing deployment the builds are over a collection
where no document matches the partial filters, so they complete immediately.

## Migration / backfill

**No schema migration is required.** New fields are absent-by-default, so every
existing `ACTIVE` user is already valid and stays shape-identical (verified:
new and legacy ACTIVE users persist no new fields).

**One normalization IS required for correctness** (found while reconciling #173):
users created before #173 may lack `accountState` and/or `accountStateVersion`
in the stored document. Mongoose supplies defaults on hydration, and the auth
middleware treats a missing state as `ACTIVE`, but #173's atomic refresh
reservation filters on the **stored** `accountStateVersion` (`0`), which does
not match a missing field. Such a user fails every refresh with `REFRESH_FAILED`
(reproduced against real MongoDB; characterized in
`tests/backfill-account-state.test.js`).

Remedy (no change to #173 code):

```text
MONGO_URI=... npm --prefix server run backfill:account-state            # dry run: counts only
MONGO_URI=... npm --prefix server run backfill:account-state -- --apply # write
```

Behavior: sets only missing/`null` `accountState` → `ACTIVE` and
`accountStateVersion` → `0`; never alters existing values; writes no restriction
fields; leaves `updatedAt` untouched (the Expert-application queue orders by
it); idempotent; output is counts only. Run it **before** relying on refresh for
pre-#173 accounts; it is safe to run repeatedly and while the app is serving.
Whether to additionally harden the #173 reservation filter to tolerate missing
fields is a separate decision for the #173 owners.

## Reconciliation with #173 and ADR-0010

- `accountState` and `accountStateVersion` are unchanged; `/me`, middleware, and
  refresh code are untouched.
- #173 blocks `HARD_SUSPENDED` regardless of `expiresAt`. Correct today (no
  restriction data exists); honoring expiry is #174/#175.
- #173's refresh-time session invalidation is unchanged; transition-time
  invalidation remains #174–#180 (GOV-X3).
- GOV-X1 and GOV-X2 are untouched.

## Unresolved

- **Outstanding suspension while `DELETION_PENDING`** (ADR-0010 Deferred): not
  storable yet, because the restriction carries no state discriminator and the
  representation is undecided. Loosening the validator later is additive.
- **Governance event reference** on the restriction: omitted until #172 defines
  the event model (adding an optional field is additive).
- **Pre-#173 refresh defect** (above): mitigated by the backfill; a code-side
  hardening is not made here.
