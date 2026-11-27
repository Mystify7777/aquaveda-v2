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

## Frontend: read-only Admin accounts UI (#250)

Consumes this contract; it changes nothing in it and implements **no** governance mutation.

- **Routes** (inside the `(protected)` group, so the URLs are canonical): `/admin/accounts` (directory) and `/admin/accounts/[userId]` (detail + governance history; `?page=` pages the history). ADMIN nav gets an "Accounts" link (`src/lib/expert/role-links.ts`, UX only).
- **Authorization:** authentication stays `(protected)/layout.tsx`. `RequireAdmin` gives a signed-in non-ADMIN an access message and **makes no request** for them; this is presentation, not authority. The backend (ADMIN only) is the authority and its `403`/`401` are rendered through `LoadError` (sign-in offered on 401).
- **Query semantics** are the backend's: `role`/`accountState` exact enum values (the vocabulary and the `q` 2-100 bounds are re-exported from `server/src/domain/account-directory.js` in `src/lib/accounts/directory-contract.ts`, the same boundary pattern as `issues/discovery-contract.ts`); `q` trimmed; `page` a positive integer. URL order is `role`, `accountState`, `q`, `page`; inactive filters and page 1 are omitted. **One rule: the page accepts exactly what the API accepts (`accountDirectoryQuerySchema` is `.strict()`), and anything else is surfaced and never sent.** That covers an unknown parameter, a repeated parameter, an unrecognised `role` / `accountState` (case-sensitive), a `q` outside 2-100 characters, and a `page` that is not a positive integer: the page shows each problem in an alert, makes no request, and offers "Clear filters". Nothing invalid is dropped or coerced, so a mistyped filter can never broaden the result set. Blank values (what the GET form submits for "Any") mean "not set". Filtering restarts at page 1 (the GET form carries no `page`). Past-the-end pages explain themselves and link back. The detail page's history `?page=` stays lenient (a smaller, separate surface). Trade-off: an unrelated parameter (for example a tracking `utm_*`) also blocks the page until removed; this is accepted for an internal governance tool.
- **Privacy-safe rendering:** components read only the allowlisted fields of `AdminAccountEntry` / `AdminGovernanceEvent` (`src/lib/api/types/accounts.ts`); the API's exclusions (password hash, sessions, `bio`, `expertApplication`, versions, private `reason`, `references`, `idempotencyKey`) are never read, and tests inject them into payloads to prove they are never rendered. History is shown in API order and never re-sorted (a SYSTEM expiry event carries the restriction's expiry time, so it can sort later than expected). SYSTEM actors render as "System (automatic)".
- **No mutation surface:** `src/lib/api/accounts.ts` exports only the three read functions (asserted), the only form is a `GET` search form, and results/detail contain no buttons. ADR-0012 (GOV-T9): Admin accounts and the viewer's own account show "Administrator accounts are managed by operators and cannot be restricted from here."
- **Browser coverage (tracked follow-up, not done here):** the interaction guarantees (open, fill, submit; suspension confirmation; Escape/outside-click during a mutation; in-place refresh; return to history page 1; failure then reconciliation; no duplicate mutation) are covered by component and integration tests only. At least one Playwright workflow over the real mutation path should be added (to be filed); it was not written here because it could not be run in the authoring sandbox.
- **Limits:** the state shown is the persisted state (a lapsed restriction is flagged "Lapsed / not yet lifted"); the directory reads are not live-updating; no e2e/browser smoke spec was added (see CLAUDE.md for what was verified).

## Frontend: Admin governance mutation controls (#264)

Adds mute, suspend, lift mute and lift suspension to the account **detail** page, composed over the existing mutation endpoints. The directory list stays read-only. No backend, policy, privilege-tier, Operator-tooling, appeal, deletion or purge change.

- **Who gets controls:** only `USER` and `EXPERT` targets that are not the viewer. Admin rows and the viewer's own row get none and keep the operator-managed note (ADR-0012 GOV-T9). This is **presentation**: the backend remains the only authority (ADR-0012 target rules, state preconditions, atomic writes), and its refusal is presented, never second-guessed.
- **Which actions:** there is no server capability list for account governance, so availability follows the **persisted** account state, matching the backend preconditions: `ACTIVE` -> Mute, Suspend; `MUTED` -> Lift mute; `HARD_SUSPENDED` -> Lift suspension; everything else (deletion states, unknown) -> none, with an explanation. A lapsed restriction keeps its lift (it is still its persisted state until lifted). Contradictory actions are never offered together.
- **Request contract** (`src/lib/api/account-governance.ts`, separate from the read-only `accounts.ts` whose export list is test-pinned): mute `{expiresAt, reason?, safeReason?}`; suspend `{kind: INDEFINITE | TEMPORARY(+expiresAt), reason (required), safeReason?}`; lifts `{reason?}`. Limits (2000 / 500) come from the backend domain modules via `governance-contract.ts`. The expiry is computed at **submit** time from presets (1 h, 24 h, 7 d, 30 d) or a custom local date-time; the server re-validates.
- **Confirmation:** suspension has a separate confirmation step naming the account and consequence; nothing is sent until confirmed. Mute and lifts confirm in their own dialog with an explicit action label. The private reason is never echoed back or shown anywhere; `safeReason` is the only user-facing text and is labelled as visible.
- **Duplicate-submission prevention:** a ref lock (not just `disabled`), controls locked while in flight, Escape/Close cannot abandon an in-flight request, all actions disabled during the post-mutation refresh.
- **No blind retry, ever.** There is no client idempotency key (the server derives one from the account's state version), and the audit event is a second non-transactional write (GOV-S9), so a failure can leave the state changed. Outcomes:
  - `STATE_RACE` / `INVALID_STATE` (stale view): own copy ("nothing was applied ... review it and choose again"; the server's "reload and retry" text is never shown), re-read account + history, no re-send.
  - `SELF_TARGET_PROHIBITED` / `ADMIN_TARGET_PROTECTED`: presented as authoritative, then re-read. The client now preserves the backend's allowlisted `reason` as `ApiError.serverReason` (an additive client change; `ApiError.reason` remains the client-side timeout marker).
  - `404`: "no longer exists", re-read. Network/timeout/5xx/unusable response: unknown outcome, re-read and say so.
  - `400 VALIDATION_FAILED`: stays on the form with the values kept; `401`: sign-in link; generic `403` and the admin's own restriction (#248): safe shared copy. These re-send only on the admin's own deliberate submit.
- **Reconciliation:** account and history refresh **in place** (new `useApiResource().refresh()` keeps the data on screen, exposes `refreshing` / `refreshError`; `reload` is unchanged). A failed refresh keeps the stale data and shows a "Try again" that re-reads. From a deeper history page the view moves to page 1, where the new event sorts first.
- **Limits:** no scheduled-expiry or `lapsed` auto-refresh; no per-action capability endpoint; custom end dates use the browser's local zone; the private reason is ordinary client-side memory (React state) while the dialog is open. The security property is that it is **never rendered and never sent anywhere except the intended governance mutation request**; clearing the state on close and on open is hygiene, not a security boundary, and is not DOM-observable so it is not test-pinned.
