# Admin directory read API (#181)

Read-only governance surface (ADR-0010 §13, §15; GOV-L13, GOV-L15). Mutations are owned by #174/#175/#177/#180 and are not touched.

## Routes (all ADMIN-only; anonymous 401, non-ADMIN 403 before any validation; mounted on `/api/v1/accounts`)

| Route | Result |
| --- | --- |
| `GET /` | paginated directory |
| `GET /:userId` | one directory entry (404 unknown id, 400 malformed) |
| `GET /:userId/history` | paginated governance history of that account |

## Directory entry (allowlist, `account-directory.dto.js`)

`id, name, email, role, registeredAt, accountState, accountStateChangedAt|null, deletionPending, deletionRequestedAt|null, restriction: { kind, expiresAt|null, safeReason|null, lapsed } | null`

Never returned: `passwordHash`, sessions, `authGeneration`, `accountStateVersion`, `bio`, `expertApplication` (incl. submission), private governance `reason`, idempotency keys, event references.

- `email` is returned: ADMIN-only, the only unique human identifier, and a search target. Nothing else identifying is added.
- `restriction.lapsed`: TEMPORARY restriction whose `expiresAt` has passed but whose lazy persisted lift has not happened yet. Reads never mutate (no lazy lift, no event). `accountState` is the **persisted** state.
- `deletionPending` = `accountState === DELETION_PENDING`; `deletionRequestedAt` = `accountStateChangedAt` in that state. "Deletion notifications" (content/recipients) are deferred by ADR-0010 and not invented; the pending set is identified by state filter plus the `ACCOUNT_DELETION_REQUESTED` event in history.

## Query contract (`GET /`; unknown params rejected 400, no silent unfiltered result)

| Param | Rule |
| --- | --- |
| `page`, `limit` | shared bounds (limit 1-50, default 20) |
| `role` | `USER|EXPERT|ADMIN` |
| `accountState` | the five lifecycle states (persisted state). **Decided:** `PERMANENTLY_DELETED` is included in the default listing (all states are listed by default; none is hidden). Future deletion/tombstone work (#178) may refine the projection or privacy semantics |
| `q` | trimmed, 2-100 chars. Matches (OR): exact `_id` when 24-hex; **email prefix**; **name prefix**, both case-insensitive, regex-escaped, anchored |

Filters combine with AND. Order: `createdAt DESC, _id DESC`. Response: `{ items, page, limit, total, totalPages }`.

Index use: unfiltered/role/state lists use `user_directory_order {createdAt:-1,_id:-1}` (new, only index added). Email prefix uses the unique email index. **Name prefix has no supporting index** (case-insensitive); a `q` search is therefore a bounded-by-collection scan. Accepted at current scale; revisit trigger: user count where search latency matters -> collation/normalized-name index.

## Governance history (`GET /:userId/history`)

Events with `target = userId`, `occurredAt DESC, _id DESC` (index `governance_event_target_history`). Entry: `id, action, actorType, actor: { id, name|null } | null, previousState, resultingState, safeReason|null, occurredAt`. Actors hydrated with **one** batched `User.find` per page (no N+1).

Excluded: private `reason`, `references`, `idempotencyKey`. Whether ADMIN may read the private reason is **not decided here** (ADR-0010 §14 "private enforcement notes remain restricted"); conservative default is exclusion.

## Open / deferred

- Private-reason visibility to ADMIN (above).
- Deletion-notification content/recipients (ADR-0010 deferred).
- Rate limiting of directory reads (ADMIN-only, not added).

## Admin rows are not governable here (ADR-0012, #249)

The directory shows Admin accounts. **#250 is read-only and provides no
governance mutation controls.** Any future governance UI must not offer mute,
suspend, or lift for a row whose `role` is `ADMIN` or whose `id` is the
signed-in user's. The server remains authoritative: the mutation endpoints
reject those requests with `403` (`SELF_TARGET_PROHIBITED` /
`ADMIN_TARGET_PROTECTED`); enforced by #255 (see
[admin-targeting-enforcement.md](./admin-targeting-enforcement.md)). The directory contract
itself is unchanged by this decision.
