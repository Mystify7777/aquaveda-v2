# Expert application details: contract and UI design

Status: **Revision 2, backend and frontend implemented (EXP-L9–L20 in the decision register). Taxonomy values provisional; governance E2E pending.** Cross-layer change (backend contract, persistence, frontend), tracked in its own issue, not in #104.
Builds on: EXP-L1–L8 (#91), ADR-0002 (independent backend package), ADR-0005 (embedded history), ADR-0006 (conditional atomic transitions), UI-L1–L5.

## 0. Review resolution

| Finding | Resolution | § |
|---|---|---|
| P1 revision filter vs MongoDB | Exact filter, evaluation semantics, zero-match rule, required real-MongoDB tests | 4.5 |
| P1 DTO tied to one revision | `revision` and `submission` derived from one array in one function; error contract | 4.3, 4.5 |
| P1 acknowledgement auditability | Immutable retained text per version **and** server-computed SHA-256 persisted; CI-pinned digests | 3.1 |
| P1 shared-module coupling | Zero-import pure module, enforced by test; single re-export file; ADR-0002 respected | 3.2 |
| P1 #104 status | Issue is open; closure is conditional on your verification | 2 (D1) |
| P2 provider semantics | Owner, keying, generation tokens, dedupe, refresh triggers, failure modes | 5.3 |
| P2 note rule | Trim-then-validate, UI explanation, exact boundary tests | 4.4, 7 |
| P2 history growth | Worst-case arithmetic, revisit trigger | 4.1 |
| P2 legacy DTO | `submission: null`, never fabricated, UI distinguishes | 4.3 |
| P2 taxonomy | Stable keys vs labels; still pending domain review | 3.3 |
| P2 apply breaking change | Caller list, deploy order, no shim (stated assumption) | 6 |
| P2 timeline mapping | Event-to-display table; no invented "Under review" timestamp | 5.2 |
| Abuse protection | Reuse the existing IP rate limiter on apply | 4.6 |
| URL security | Parser rules, dedupe, explicit never-fetch non-goal | 3.1 |

## 1. Problem

`POST /expert-application` is an empty strict body. The reviewer DTO is `{ userId, name, bio, requestedAt, history }`, and `bio` has no write path anywhere (not in `registerSchema`, no profile route), so it is always `""`. An ADMIN decides on a name and a date. Rejection notes are optional, approval carries no note, and applicants learn outcomes only by visiting the status page.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | #104 is **open on GitHub** (checked Oct 18). Close it only after its existing scope is verified. Frontend vitest (569), node tests (16), lint and typecheck were green on `main` in the sandbox; `npm run build` (sandbox font fetch blocked) and the governance E2E are still unverified. This feature is a separate issue. |
| D2 | Reject note required, 10–500 chars after trim, enforced in request validation only so historical entries stay readable. |
| D3 | `references` optional, max 3, https only, no userinfo. A link is never treated as proof of expertise. |
| D4 | Dedicated fixed water-domain taxonomy, 1–3 selections, server-validated, no free-text categories. |
| D5 | Minimal in-app indicators (USER state in nav, ADMIN pending count, role refresh after approval). No polling, no new data library. |
| D6 | Email notifications deferred (parking lot). |
| D7 | Submission persisted per history entry. Experience required (80–1000). Affiliation optional (≤120). Acknowledgement required and persisted. No uploads/phone/ID. Re-apply prefills from the previous submission and stores a new independent one. Approval grants EXPERT only. No form library unless proven necessary. |
| D8 | Approve note optional: when present, trimmed 1–500 (whitespace-only is a 400; the UI omits the key when blank). No 10-char minimum, since "Welcome aboard" is a fine note. |

## 3. Submission

```
submission {
  expertiseAreas: ExpertiseValue[1..3]   unique, from §3.3
  experience:     string  trimmed, 80..1000, plain text
  affiliation?:   string  trimmed, 1..120 (client omits the key when empty)
  references?:    string[0..3]  see §3.1
  acknowledgement: { version, textSha256, acceptedAt }   // all server-set except `version`
}
```

Request body (`.strict()`): the first four fields plus `acknowledgement: { version }`. The client can never supply text, hash, or timestamp. Experience prompt: "What have you worked on, where, and for how long?" All text renders as plain text (#88: untrusted content, no raw HTML).

### 3.1 References and acknowledgement

**References.** Parse with the platform `URL` class. Require `https:`, a non-empty hostname, and no username/password. Store the parsed `href`; de-duplicate on the normalized `href`; max 2048 chars each. Render as the hostname with `rel="noopener noreferrer nofollow"`. **The server never fetches submitted URLs**: no link previews, reachability checks or "verification" may be added as an incidental enhancement; that would create an SSRF surface and imply verification the authority model does not provide.

**Acknowledgement.** One statement with two distinct clauses, an accuracy declaration about the application and a commitment about future Expert conduct. Wording (v1): "I confirm that the information in this application is accurate and complete to the best of my knowledge. If approved, I will review Knowledge submissions impartially and will not review my own. I understand an administrator decides this application, and that approval grants Knowledge review access only." It does not mention revocation: no revoke path exists.
- **Product decision (settled):** the earlier wording covered only the conduct commitment, so it did not attest that the submission is truthful. v1 now covers both. **v1 is unreleased**, so its wording was settled and re-pinned before release; from the first release it is frozen and any change adds version 2.
- **Form obligation (frontend phase):** the checkbox sits directly beside the exact text, rendered from `ACKNOWLEDGEMENT_TEXTS[CURRENT_ACKNOWLEDGEMENT_VERSION]` (never hand-copied), under a lead-in "By submitting this application you agree to:". The text is never paraphrased, truncated or collapsed.
- Texts live in an immutable map `ACKNOWLEDGEMENT_TEXTS = { 1: "..." }`. A shipped version's text is never edited; a wording change adds version 2.
- The service computes `textSha256` from its own text for the submitted version and stores `{ version, textSha256, acceptedAt }`. Any version other than a current one is a 400 (stale client copy).
- A test pins the SHA-256 of every shipped version's text, so an accidental edit fails CI.
- Auditability therefore does not depend on version control alone: the hash is in the record.

### 3.2 Shared contract boundary

`server/src/domain/expert-application-submission.js` is **pure with zero imports** (values, labels, limits, acknowledgement texts, and pure validation/normalization helpers), like `issue-search.js`. Hashing needs `node:crypto`, so it lives in the service, never in this module.
- A test reads the module source and asserts it has no `import`/`require`, so a backend-only dependency cannot creep in and break the frontend bundle.
- The frontend reaches it through exactly one file, `src/lib/expert/submission-contract.ts`, which only re-exports (the `discovery-contract.ts` / `classification.ts` pattern). **Confirmed against ADR-0002:** it constrains what `server/` imports (it stays self-contained), not who consumes its pure modules, and the existing frontend already imports `issue-search.js` and `issue-classification.js` this way (`issue-discovery-contract.md`). The direction is frontend to server only, limited to import-free files under `server/src/domain/`; the frontend build context must include that directory. A top-level shared package stays deferred until a workspace exists.
- Both sides run the **same** validation code, so drift is structurally impossible. The server Zod schema derives its enums and bounds from the module, and a table-driven test asserts the Zod schema and the pure validator accept and reject the same vectors.

### 3.3 Expertise taxonomy (proposal, structure approved, values pending domain review)

Independent of `issue-classification.js` (issue categories describe reported problems, not expertise). Stable machine `value` keys are never renamed or reused; labels and descriptions are rewordable.

| value | Label | Covers |
|---|---|---|
| `water_quality_treatment` | Water quality and treatment | Testing, contamination, purification |
| `groundwater_wells` | Groundwater and wells | Aquifers, borewells, recharge monitoring |
| `water_supply_distribution` | Supply and distribution | Pipelines, pumping, tanks, municipal networks |
| `rainwater_conservation` | Rainwater and conservation | Harvesting, watershed management, efficiency |
| `wastewater_sanitation` | Wastewater and sanitation | Sewage, treatment, reuse |
| `flood_drainage_hydrology` | Flooding, drainage and hydrology | Waterlogging, stormwater, surface water |
| `agricultural_water_use` | Agricultural water use | Irrigation, crop water management |
| `community_field_practice` | Community and field practice | Local water management, NGO and participatory work |
| `policy_governance` | Policy and governance | Regulation, water rights, programmes |
| `other` | Other water expertise | Water-related, fits none of the above |

Values are informational for the ADMIN decision; they scope no review. **Before keys are final:** a domain owner confirms the entries are distinct enough for consistent administrator use (the repo has no water-expertise vocabulary beyond issue categories).

## 4. Persistence and API contract

### 4.1 Persistence

`expertApplication.history[]` entries gain an optional `submission` subdocument, present only on `toStatus: "pending"` entries: `{ fromStatus, toStatus: "pending", actor, timestamp, submission }`.
- Additive: no migration, no backfill, no new collection, no flat reviewer/applicant fields (ADR-0005).
- **Not** `required` in Mongoose: legacy entries lack it, and update validators have no document context for a conditional `required`. The apply service guarantees presence for every new write.
- **Growth is not domain-bounded.** Worst case per attempt (estimate): experience 1000 chars (≤4 KB UTF-8) + affiliation ≤0.5 KB + 3 × 2048-char URLs (6 KB) + ack hash/ids/timestamps (<0.5 KB) ≈ 11 KB, plus a decision entry with note ≤500 chars (≤2 KB). Against MongoDB's 16 MiB document limit that is >1,000 full cycles per user, unreachable without abuse. Mitigation today: the rate limit in §4.6. **Revisit trigger:** any user with >50 attempts or a MongoDB document-size error, at which point a cooldown or attempt cap needs a product rule (parking lot; not invented here).

### 4.2 Apply

`POST /api/v1/expert-application`, strict body per §3. The existing single conditional write is unchanged: `none -> pending` `$set`s the object (filter `{ expertApplication: { $exists: false } }`), `rejected -> pending` `$push`es the entry (filter on `status: "rejected"`). The submission is part of that same entry, so ADR-0006 guarantees are untouched and no new write exists. 201 returns the applicant DTO.

### 4.3 DTOs

- **History entry DTO:** `submission` key present only on `toStatus: "pending"` entries; its value is the object, or `null` for a legacy entry. Never a fabricated `{}`. Decision entries carry `note` as today.
- **Applicant (`GET /me`, apply result):** history with the applicant's own submissions (no reviewer identity). The UI derives the latest pending entry for read-only display and re-apply prefill.
- **Reviewer (queue items, decision results):** adds `revision` and top-level `submission`. Both are computed in one pure function from the **same history array** of one read: `revision = history.length`; `submission = latestPendingEntry(history)?.submission ?? null`. For a pending application the last history entry is always its `→pending` entry (status changes only by appending an entry, EXP-L3), so `revision` identifies exactly the entry whose submission is shown. A test asserts this invariant across fixtures. Email stays excluded (EXP-L6).
- **Legacy:** a pending application without a submission yields `submission: null`; both UIs treat that explicitly (§5.1), never as an empty submission.

### 4.4 Decision requests

- `POST /:userId/reject` body `{ revision, note }`, strict. `revision`: integer 1..10 000 (missing, non-integer, ≤0 or oversized is a 400). `note`: trimmed **then** validated, 10–500, required, persisted trimmed.
- `POST /:userId/approve` body `{ revision, note? }`, strict; `note` per D8.
- Existing entries without notes are unaffected: the minimum is a request-schema rule, not a Mongoose `note` constraint.
- **`revision` range:** integer 1..10 000 (`REVISION_MAX`). History growth is not domain-bounded, but the 16 MiB document limit is reached first (about 1,200 full cycles, roughly 2,400 entries). An application whose history somehow exceeded the bound could not be decided through the API (`revision` fails validation); that is an unsupported, operator-repair state, not something the contract serves.

### 4.5 Revision pinning (accepted)

The status-only guard cannot protect content-based decisions: admin A sees S1, admin B rejects, the applicant re-applies with S2, and A's approve still matches `pending`, approving content A never saw.

**Meaning:** `revision` is the history length of the application the reviewer saw (§4.3).

**Decision flow:**
1. Existing pre-read (`findById(...).select("role expertApplication").lean()`) keeps its checks (not found, self-decision, status must be `pending`). New: `revision !== history.length` throws `STATE_RACE` with details `{ expectedRevision, currentRevision }`, which is only the early, readable error.
2. The **authoritative guard is one atomic conditional write**, with all conditions in a single query predicate:
   ```js
   User.findOneAndUpdate(
     { _id, role: "USER",
       "expertApplication.status": "pending",
       "expertApplication.history": { $size: revision } },
     { $set: { "expertApplication.status": toStatus, ...(approved ? { role: "EXPERT" } : {}) },
       $push: { "expertApplication.history": entry } },
     { new: true, runValidators: true })
   ```
   MongoDB evaluates the predicate and applies the update atomically on that one document (ADR-0006). `expertApplication` is an embedded document (not an array), so the dotted path resolves to the `history` array and `$size` matches arrays of exactly `revision` elements (it takes an integer literal, not a range).
3. **Zero match is `STATE_RACE`**: never success, never retried against the latest revision, never merged. Nothing is written.

**Error contract:** 400 `VALIDATION_FAILED` (missing/malformed `revision`, note rules, extra keys); 404 `NOT_FOUND`; 403 `FORBIDDEN` (non-ADMIN, self-decision). Staleness is two distinct 409s, decided by the pre-read order (status is checked before revision):
- `STATE_RACE`: the application is still `pending` but its revision differs from the one sent, **or** the atomic write matched nothing (a competing decision or re-application landed between the pre-read and the write).
- `INVALID_STATE`: the application is no longer `pending` when the request is evaluated, because another decision already landed. This also wins over a revision mismatch, since the status check runs first.

Both mean "stale, refresh", and the UI already treats them alike. A competing pair on one revision therefore yields one success and one 409 that is `STATE_RACE` or `INVALID_STATE`, depending on whether the loser's pre-read ran before or after the winner's write.

**Verification gate:** I could not run MongoDB in the authoring sandbox, so the filter's behaviour is specified, not yet demonstrated. Implementation is not complete until the tests in §7 pass against **real MongoDB** using this exact production-shaped filter.

### 4.6 Abuse protection

Reuse the existing `createRateLimiter` (IP-keyed sliding window, in-memory, currently wired only on auth routes) on `POST /expert-application`, with limits chosen at implementation and a test for the standard 429 envelope. Known limits, as documented in `rate-limiter.js`: per-instance memory store, IP-keyed. No per-user cooldown (deferred).

## 5. Frontend design

### 5.1 Surfaces

**Applicant (`/learn/expert-application`)** is state-driven.
- *Not applied:* short explanation (what Experts do, what review involves, "approval grants Knowledge review, not admin powers"), then the form: expertise checkboxes with live "n/3", experience with counter and minimum hint, optional affiliation, repeatable reference rows (max 3), acknowledgement, submit. Controlled form, no new dependency, using the shared pure validator; inline errors via `aria-describedby`, focus to the first invalid field, submit `aria-busy` while in flight, double-submit ref guard as today.
- *Pending:* read-only copy of the submission plus timeline. No edit or withdraw (no endpoint; the UI promises neither). **Legacy** (`submission: null`): "Submitted before details were collected", no details block.
- *Rejected:* reviewer note first, then the form re-opens prefilled from the latest submission (empty form for a legacy rejected application).
- *Approved:* as today, without the reload instruction (§5.3).

**ADMIN (`/admin/expert-applications`)** is master-detail on desktop, stacked on mobile. Detail: name, applied date, expertise tags, experience, affiliation, reference hostnames, a Re-application block (previous submission and note). A legacy item shows a visible "No details provided (submitted before details were required)" marker and stays decidable. Decisions send the `revision` the reviewer saw. Reject: required note with counter; the button stays disabled until the trimmed note is ≥10 chars and a visible message says why ("Explain why, at least 10 characters, so the applicant knows what to change"). Approve: explicit confirm, optional note. A live region announces the outcome and focus moves to the next item. A `STATE_RACE` shows "This application changed while you were reviewing; review the latest version" and refreshes.

### 5.2 Timeline (event-to-display mapping)

| Persisted fact | Display | Date |
|---|---|---|
| history entry `→pending` | "Submitted" | entry timestamp |
| current `status === "pending"` (no decision entry yet) | "Awaiting review" (current state, not an event) | none: nothing is persisted for it |
| history entry `→approved` | "Approved" (+ optional note) | entry timestamp |
| history entry `→rejected` | "Not approved" (+ note) | entry timestamp |

No "Under review" timestamp is manufactured. Re-applications list chronologically; the latest cycle is expanded, earlier cycles collapsed. No review-time promise.

### 5.3 Status provider and role refresh

`ExpertStatusProvider`, mounted under `AuthProvider` in the authenticated shell, is the **sole fetcher**; the nav, panel and queue read its state and call `refresh()` or supply the mutation result.

- **Roles:** USER fetches `GET /me`; ADMIN fetches `GET /?page=1&limit=1` and reads `total`; EXPERT and anonymous stay idle.
- **`total` accuracy (verified in the service):** `total = User.countDocuments(filter)` with the same filter as the page query, independent of `page`/`limit` (`limit` only bounds `find`). `limit=1` is valid (max 50). A test seeds 3 pending and asserts `limit=1` gives `items.length 1, total 3`.
- **Keying and invalidation:** state is tagged `userId:role` plus a generation counter. Any identity or role change (login, logout, account switch, `refreshUser` role change) resets to idle and bumps the generation; an in-flight result whose generation no longer matches is dropped (the token pattern already used in `useApiResource`). A refresh completing after logout or an account switch therefore cannot write into the new session.
- **Dedupe:** one in-flight promise per key held in a ref. React Strict Mode's double effect reuses it, so one request is issued; the first effect's cleanup only unsubscribes and does not cancel the shared request.
- **Refresh triggers:** identity change; after the user's own apply or decision; after `refreshUser`; when the tab becomes visible if the last success is older than 60 s. No timers or polling. Between triggers a change made elsewhere is not seen, which the UI does not hide (below).
- **Failure:** error with no prior data gives state `error`: the nav shows the neutral entry (no chip or badge) and pages show their own load error with retry. Error with prior data keeps it flagged `stale`: the nav drops the chip, pages show the data with "may be out of date" and retry. A 401 clears state and defers to the existing auth session-failure path. Stale values are never shown as current.
- **Role refresh on approval:** `refreshSession` (`POST /refresh`) is only wired inside `AuthProvider` init, and `AuthContext` exposes just `{status, user, login, register, logout}`, so a component cannot update `user.role` by calling it. Add `AuthProvider.refreshUser()`, calling the existing `getCurrentUser()` (`/auth/me`, fresh role per EXP-L7) into `setAuthenticated`, with no token rotation and no reload. Supersedes UI-L4's "no auth-provider change".

## 6. Compatibility and blast radius

- **Data:** no migration; existing applications keep working (`submission: null`, decidable, `revision` = history length).
- **Breaking request shapes:** apply (body required), approve and reject (`revision`; reject `note`). An old client sending `{}` or a body-less decision gets 400, failing closed with the existing visible error.
- **Deploy order:** backend and frontend deploy independently (Topology B). No compatibility shim: deploy backend first, then frontend; the window fails closed. **Assumption to confirm:** the product is pre-release, with no live users depending on the old shape.
- **Callers to migrate together:** `src/lib/api/expert-application.ts` and its tests, panel, queue, decision component, `tests/helpers/expert.js` (add `validSubmission()` and the `revision` argument; its consumers in the Knowledge moderation tests need re-running on real MongoDB), `server/scripts/verify-validation.js` and `verify-models.js`, route and service tests, `e2e/governance-lifecycle.spec.ts`, the API listing in `server/README.md`, and `docs/engineering/testing.md`.
- **Docs:** EXP-L9+ entries in the decision register, UI-L4 superseded, domain-model section for the taxonomy.

## 7. Tests

- **Contract:** zero-import enforcement; Zod and pure validator agree on shared vectors; acknowledgement text digests pinned; URL rules (non-https, userinfo, empty host, duplicates, normalized dedupe).
- **Notes:** whitespace-only, 9, 10, 500 and 501 chars for reject; approve whitespace-only (400), 1 and 500; unexpected keys and `role`/`status`/`acceptedAt` smuggling (400).
- **Service, real MongoDB:**
  - Submission persisted on the pending entry for `none` and `rejected` re-apply, with the acknowledgement hash recorded server-side.
  - Legacy records give `submission: null`.
  - The exact §4.5 filter: competing approve vs reject on the same `revision` (exactly one wins, the other `STATE_RACE`).
  - The A/B/re-apply interleaving: A holds revision N, B rejects, the applicant re-applies, A's decision with N fails `STATE_RACE`, the document is unchanged, and no role is granted.
  - Missing, malformed, zero, negative and oversized `revision` give 400.
  - Last-entry-is-pending invariant.
  - The existing apply and decide concurrency tests still pass.
- **Routes:** 401/403 unchanged; apply rate limit returns the standard 429 envelope; `limit=1` queue `total`.
- **Frontend:** form validation and focus, double submit, prefill, legacy states, timeline mapping, reject-note explanation, `STATE_RACE` recovery, provider (single request under Strict Mode, generation drop after logout/account switch, failure and stale states, visibility refresh), `refreshUser`, role-nav indicator states.
- **End to end:** governance E2E on real MongoDB; `npm run verify:frontend`; backend verify.

## 8. Remaining before lock

1. Domain owner confirms the taxonomy keys (§3.3).
2. Confirm the pre-release assumption (§6).
3. Close #104 after you run `npm run verify:frontend` and the governance E2E.

Resolved by review: revision pinning accepted; `refreshUser` accepted; provider accepted with the semantics in §5.3; approve note optional (D8); cooldown deferred while basic rate limiting is retained (§4.6).

## 9. Execution order

1. Lock this document; add EXP-L9+ decision-register entries.
2. Backend: pure domain module and its tests, schema, validation, service (apply, DTOs, pinned decide), routes (+ rate limit), fixtures, verify scripts; real-MongoDB tests green.
3. Frontend: contract boundary, API client, `AuthProvider.refreshUser`, `ExpertStatusProvider`, form, review detail, nav indicators, tests.
4. Governance E2E; `npm run verify:frontend`; backend verify.

Parked (not this release): email notifications, withdraw/edit of a pending application, re-apply cooldown, document uploads, queue position and applicant activity signals (see `docs/future/parking-lot.md`).
