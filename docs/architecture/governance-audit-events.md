# Governance Audit Events

Status: Implemented in #172. Policy source: [ADR-0010](../adr/ADR-0010-account-governance.md)
§14 (records #168) and its #172 implementation amendment.

An audit event is an immutable fact: *this actor did this action to this
account, moving it from `previousState` to `resultingState`, for this reason, at
this time.* It is history, separate from current account state (`User`), and is
never consulted for enforcement. This issue adds the model and an append/read
service only: no routes, no Admin UI, no mutation of account state, no
authorization (callers authorize first).

## Stored shape (`GovernanceEvent`)

| Field | Meaning |
| --- | --- |
| `idempotencyKey` | Required, unique. Identifies the logical action (retry safety, below). |
| `action` | One of the 11 event families (below). |
| `actorType` | `USER` (an Admin, or the account owner for owner-initiated actions) or `SYSTEM` (server-side expiry, deletion worker). |
| `actor` | Performer; required for `USER`, absent for `SYSTEM`. |
| `target` | The affected account. Retained after the account is purged. |
| `previousState` / `resultingState` | Account state before/after; for `EXPERT_*` the role (`EXPERT`/`USER`). |
| `reason` | **Private** enforcement reason. Required only for `EXPERT_REVOKED` (ADR-0010 §12). |
| `safeReason` | The user-visible reason, where policy permits. |
| `references` | Up to 10 `{ type: UPPER_SNAKE, id: ObjectId }` (e.g. `EVENT`, `APPEAL`); open vocabulary, no migration for new kinds. |
| `occurredAt` | When the action happened (explicit, defaults to now). |
| `createdAt` | Insert time. There is **no `updatedAt`**: events are never updated. |

Persistence bounds (`reason` ≤ 2000, `safeReason` ≤ 500, ≤ 10 references) are
placeholders, not governance policy.

## Event families and what the action name determines

**Validation boundary.** `validateGovernanceEventInput` validates event-*shape*
semantics: required fields, vocabulary, actor rules, and facts that follow from
the action's own name. It does **not** validate lifecycle legality or
authorization, and it will accept a well-formed event for a move the lifecycle
would never permit (e.g. `HARD_SUSPEND` from `PERMANENTLY_DELETED`; a test
documents this). The mutation services (#174–#180) own the transition graph and
authority rules, and are responsible for recording only the (previousState,
resultingState) pair of a transition they have already authorized and applied.

| Action | previousState | resultingState |
| --- | --- | --- |
| `MUTE` | any account state | `MUTED` |
| `MUTE_LIFTED` | `MUTED` | any account state |
| `HARD_SUSPEND` | any account state | `HARD_SUSPENDED` |
| `SUSPENSION_LIFTED` | `HARD_SUSPENDED` | any account state |
| `APPEAL_SUBMITTED` | any account state | any account state |
| `APPEAL_RESOLVED` | any account state | any account state |
| `ACCOUNT_DELETION_REQUESTED` | any account state | `DELETION_PENDING` |
| `ACCOUNT_RECOVERED` | `DELETION_PENDING` | any account state |
| `ACCOUNT_PERMANENTLY_DELETED` | `DELETION_PENDING` | `PERMANENTLY_DELETED` |
| `EXPERT_REVOKED` | role `EXPERT` | role `USER` (reason required) |
| `EXPERT_RESTORED` | role `USER` | role `EXPERT` |

## Retry / duplicate behavior

`recordGovernanceEvent(input)` → `{ event, created }`.

1. Callers supply a required `idempotencyKey` for the logical action. Recommended
   deterministic derivation: `${action}:${targetId}:${accountStateVersionAfterTransition}`
   (each state change already increments `accountStateVersion`, #173), so a
   retried transition reuses its key.
2. First write inserts → `created: true`.
3. Same key + same content (action, actor, target, states, reasons, references;
   `occurredAt` ignored) → returns the **original** event, `created: false`; the
   first `occurredAt` wins. Holds under concurrent retries (the unique index
   arbitrates; tested with 12 simultaneous calls → one event).
4. Same key + different content → `INVALID_STATE` with
   `details.reason = "IDEMPOTENCY_KEY_CONFLICT"`; the stored event is untouched.

A governance action references its audit event by the returned `event._id`;
`getGovernanceEvent(id)` resolves it, and later events can cite earlier ones via
`references` (e.g. a lift citing its suspension).

## Immutability

**GovernanceEvent is append-only at the application / Mongoose boundary.**
Database-level permissions are required to make that invariant authoritative
against raw-driver or out-of-process writes (below).

Enforced at the Mongoose boundary: all event-domain fields are `immutable`
(`createdAt` is generated metadata); existing documents
cannot be saved; `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`,
`findOneAndReplace`, `findOneAndDelete`, `deleteOne`, `deleteMany`, document
`deleteOne`/`updateOne`, and `bulkWrite` are rejected with
`GOVERNANCE_EVENT_IMMUTABLE`. Only `create`/`insertMany` append. The service
exposes only `recordGovernanceEvent` and `getGovernanceEvent` (asserted by a
test); there is no update/delete API and none will be added.

**What this does not guarantee:** MongoDB itself still permits mutation and
deletion through the raw driver (`Model.collection.*`) or any other process with
write privileges; Mongoose cannot intercept that. "The application does not
modify audit events" is therefore a weaker property than "audit events cannot be
modified". Database-level protection (an application role without
update/delete on this collection) is an operations decision outside this issue
and is **recommended before production**. Test cleanup uses the raw driver
deliberately.

## Privacy

Events are never serialized raw: `toJSON` strips `reason` and `idempotencyKey`.
The only projection added is `toAffectedUserGovernanceEvent` — an allowlist of
`id`, `action`, `occurredAt`, `safeReason`; it omits actor identity, the private
reason, references, and states. The Admin governance-history projection is
`toAdminGovernanceEvent` (#181, `admin-directory.md`).

## Separation from account state

Recording an event never writes to `User` (tested), and `User` stores no
governance history. Current state (`accountState`, restriction metadata) and
history are independent; the mutation issues write both, with the event's
`idempotencyKey` derived from the state change.

## Indexes

| Index | Serves |
| --- | --- |
| `governance_event_idempotency` `{idempotencyKey}` unique | retry resolution |
| `governance_event_target_history` `{target, occurredAt:-1, _id:-1}` | a target's governance history (ADR-0010 §13, §14); verified by `explain` |

## Unresolved / deferred

- Reason requirements for actions other than `EXPERT_REVOKED`: left to the
  implementing issues (a stricter rule can be added without migrating events).
- `SYSTEM` actor: ADR-0010 requires server-side expiry and an asynchronous
  deletion worker but does not name how a non-user actor is recorded;
  `actorType` is a representational choice made here.
- Admin-visible projection and any "private notes" visibility beyond the
  affected-user allowlist: #181.
- Retention of events: governance audit is RETAIN "according to policy"
  (ADR-0010 §11); no period is invented. `target` may reference a purged user.
- Whether `User.accountRestriction` should store the originating event id
  (deferred in #171): additive, decided by #174/#175.
- Database-level write protection (above).

## Operator actions (reserved by ADR-0012, #249)

ADR-0012 reserves a third `actorType`, `OPERATOR` (actor absent, like `SYSTEM`),
for the out-of-band Operator restriction/restoration of an **Admin** account. It
is **not implemented** (`ACTOR_TYPES` is still `USER | SYSTEM`); the Operator
tool follow-up adds it with a required private reason that includes the change
record identifier. Rejected Admin-targeting requests append no event.
