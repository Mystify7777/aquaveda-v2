# Routes — implementation plan

**Status: plan only until Phase 0/1 execution below. Locked decisions:
`decision-register.md` §"Locked — Routes" (ROUTE-L1–L6), resolving the
5 open decisions from `routes-milestone-discovery-report.md` §8.**

Execution follows the checkpointed phase structure below. Each
checkpoint stops for review before the next begins.

- **Checkpoint A** — Phase 0 (baseline re-check) + Phase 1 (shared HTTP
  error infrastructure)
- **Checkpoint B** — Phase 2 (4 validation modules)
- **Checkpoint C** — Phase 3 (Issue routes)
- **Checkpoint D** — Phase 4–6 (Knowledge, Comment, Project routes)
- **Checkpoint E** — Phase 7–9 (app.js integration, global 404/error
  normalization, `auth.routes.js` migration)
- **Checkpoint F** — Phase 10–12 (full verification, documentation)

---

## Phase 0 — baseline re-check (no changes)

Re-confirm, by direct re-inspection, that nothing has drifted since the
discovery report:
- Exactly 9 service operations exist (no new retrieval/listing
  appeared).
- `AUTHORIZATION_POLICY_UNRESOLVED` still exists in `errors.js`, still
  guards the same 2 Issue transitions.
- `req.actorContext` is still produced exclusively by `authMiddleware`,
  still advisory (never rejects).
- `src/lib/api/types.ts`'s `ApiResponse<T>` contract is unchanged.

## Phase 1 — shared HTTP error infrastructure

**New file: `server/src/http/respond.js`** (new `http/` directory —
first file of its kind; not placed in `services/` since this is
route/HTTP-layer concern, not domain-service-layer, mirroring the same
services/vs-middleware boundary already established for `authorization.js`
vs `authMiddleware`).

Responsibilities:
- `sendSuccess(res, data, message, status = 200)` →
  `res.status(status).json({success: true, data, message})`
- `sendError(res, err)` — the shared version of `auth.routes.js`'s
  `sendDomainError`, generalized: maps a `DomainError`'s `.code` through
  one canonical table to an HTTP status, forwards `.message` only for
  known/mapped codes, logs-and-genericizes anything unmapped, per
  ROUTE-L6's envelope.

Canonical status table (ROUTE-L4, discovery report §4a):

```
VALIDATION_FAILED                → 400
UNAUTHORIZED                     → 401
FORBIDDEN                        → 403
NOT_FOUND                        → 404
TARGET_NOT_FOUND                 → 404
INVALID_STATE                    → 409
INVALID_PARENT                   → 409
STATE_RACE                       → 409
AUTHORIZATION_POLICY_UNRESOLVED  → 409  (code field distinguishes it — ROUTE-L4)
INVALID_CREDENTIALS              → 401  (carried over from auth.routes.js, for Phase 9)
EMAIL_ALREADY_REGISTERED         → 409  (carried over from auth.routes.js, for Phase 9)
REFRESH_FAILED                   → 401  (carried over from auth.routes.js, for Phase 9)
```

Unmapped codes: `console.error` the real error server-side in full,
respond `{success: false, data: null, message: "Internal server
error"}` at 500 — never forward `.message` for these.

### Tests (focused, offline — no DB needed, mirrors
`authorization.service.test.js`'s pattern)

**New: `server/tests/http-respond.test.js`** — construct a fake `res`
object (`{status, json}` spies), assert:
- `sendSuccess` produces exactly `{success, data, message}`.
- `sendError` for every mapped code produces the correct status +
  `{success:false, data:null, message, code}`.
- `AUTHORIZATION_POLICY_UNRESOLVED` specifically produces 409 **and**
  `code: "AUTHORIZATION_POLICY_UNRESOLVED"` — a dedicated assertion,
  not folded into the generic mapped-code loop, since this is the one
  code sharing a status with two others and needing its own regression
  protection (ROUTE-L4).
- An unmapped/unknown error produces the generic 500 body, and does
  NOT forward the original `.message`.

**Stop here. Report Phase 0/1 results before Phase 2.**

---

## Phase 2 — validation modules (4 files, Zod, mirrors `auth.validation.js`)

- `server/src/validation/issue.validation.js` — `createIssueSchema`,
  `changeIssueStatusSchema`
- `server/src/validation/knowledge.validation.js` — `createKnowledgeSchema`,
  `rejectKnowledgeSchema` (feedback), `reviseKnowledgeSchema`
  (title?/body?/region?, matching the service's actual 3-field
  contract — discovery report §6 note)
- `server/src/validation/comment.validation.js` — `createCommentSchema`
- `server/src/validation/project.validation.js` — `createProjectSchema`

Each: parse only, strip unknown fields via Zod's default behavior,
routes pass `parsed.data` downstream, never raw `req.body` — exact
`auth.validation.js` precedent (discovery report §3c/§3d).

Focused tests, one file per validation module, offline, no DB —
mirrors `verify-validation.js`'s existing style.

**Stop. Report results.**

---

## Phase 3 — Issue routes

`server/src/routes/issue.routes.js`:
- `POST /api/v1/issues` → `createIssue(req.actorContext, parsed.data)`
- `PATCH /api/v1/issues/:issueId/status` →
  `changeStatus(req.actorContext, req.params.issueId, parsed.data.targetStatus)`

No `requireActor`/`requireRole` calls in this file (ROUTE-L3). Uses
`sendSuccess`/`sendError` from Phase 1.

Focused DB-backed tests (`tests/issue.routes.test.js`, same
`request()`-helper pattern as `auth.routes.test.js`): success cases,
validation failure, missing actor, EXPERT-gated failure, invalid
transition, state race, and **explicitly** the D-3a transitions →
confirm 409 + `code: "AUTHORIZATION_POLICY_UNRESOLVED"`, not 403.

**Stop. Report results.**

---

## Phase 4–6 — Knowledge, Comment, Project routes

Same pattern as Phase 3, one router + one focused test file each:
- `knowledge.routes.js`: `POST /knowledge`, `POST /knowledge/:id/submit`,
  `POST /knowledge/:id/approve`, `POST /knowledge/:id/reject`,
  `POST /knowledge/:id/revise`.
- `comment.routes.js`: `POST /comments`.
- `project.routes.js`: `POST /projects`.

**Stop after each router or after all three — developer's call at
Checkpoint D; default is all three together since they're
structurally identical in risk profile, unlike Issue's D-3a
complexity.**

---

## Phase 7–9 — integration (Checkpoint E)

7. Mount all 4 routers in `app.js`, after `authMiddleware`, before the
   global 404 — preserve existing middleware order exactly (`json` →
   `cookie-parser` → `cors` → `authMiddleware` → routers → 404 →
   error handler).
8. Normalize `app.js`'s global 404 and global error handler onto
   `sendError`/the `ApiResponse<T>` envelope (ROUTE-L6) — both
   currently omit `data`.
9. Migrate `auth.routes.js` (ROUTE-L5): replace local
   `ERROR_STATUS_MAP`/`sendDomainError` with the shared `sendError`;
   replace `{success:true, user}` responses with
   `sendSuccess(res, {user}, "...")`. **Authentication business logic
   (cookies, tokens, refresh rotation) untouched** — only response
   construction changes.

Full auth regression suite re-run required after Phase 9 — this is the
one phase touching a previously-closed, 138/138-verified milestone.

**Stop. Report results before Phase 10.**

---

## Phase 10–12 — verification + documentation (Checkpoint F)

10. Full envelope audit across every route (success + failure shape).
11. Full `npm test` — expect prior 138 + new route/validation/http-
    respond tests, 0 failures, reported with exact numbers (tests,
    suites, pass, fail, cancelled, skipped) — no qualitative-only
    reporting.
12. Update `CLAUDE.md` and `decision-register.md`'s Routes section from
    "implementation not yet started" to implemented/verified, with the
    real numbers. Confirm explicitly: 9 service operations = 9 routes,
    no extras, D-3a still unresolved end-to-end through the HTTP layer.

---

## Out of scope (restated from ROUTE-L1–L6, binding)

No GET/listing routes, no edit/delete routes, no D-3a resolution
(ROUTE-L4 only changes its HTTP representation), no change to
`authMiddleware`'s advisory behavior, no new domain service operations.
