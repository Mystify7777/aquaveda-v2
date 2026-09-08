# Routes Milestone — discovery & API contract report

**Status: investigation report only. No route files created, no
`app.js` changes, no dependency changes.** Produces the Route Contract
Matrix and the decisions it depends on; implementation is a separate,
later step.

Sources read directly: `server/src/services/{issue,knowledge,comment,
project}.service.js`, `server/src/services/errors.js`,
`server/src/routes/auth.routes.js`, `server/src/middleware/auth.js`,
`server/src/app.js`, `server/src/models/*.js` (index definitions),
`src/lib/api/{client,types,system}.ts`, `src/app/api/system/route.ts`,
`docs/architecture/decision-register.md`, git history (confirmed: no
V1 legacy repository exists anywhere in this repo or its history — only
referenced textually in prior milestone handoffs; its business logic
was already extracted into ADR-0003/0004 and is not re-derivable from
code here).

---

## 0. Inventory — every domain-service operation that actually exists

Confirmed by direct `grep` of every service's exports. **9 operations
total, across 4 services. Zero retrieval/listing operations exist
anywhere** — not deferred, genuinely absent (consistent with the
Authorization milestone's same finding for edit/delete).

| Service | Operation | Signature |
|---|---|---|
| Issue | `createIssue` | `(actorContext, payload)` |
| Issue | `changeStatus` | `(actorContext, issueId, targetStatus)` |
| Knowledge | `createKnowledge` | `(actorContext, payload)` |
| Knowledge | `submitForReview` | `(actorContext, knowledgeId)` |
| Knowledge | `approve` | `(actorContext, knowledgeId)` |
| Knowledge | `reject` | `(actorContext, knowledgeId, feedback)` |
| Knowledge | `revise` | `(actorContext, knowledgeId, updatedContent)` |
| Comment | `createComment` | `(actorContext, payload)` |
| Project | `createProject` | `(actorContext, payload)` |

Indexes already exist on `Issue` (`location: "2dsphere"`, `status: 1`,
`reportedBy: 1`) and `Knowledge` (`status: 1`, `author: 1`) —
persistence was built anticipating future listing/filtering routes, but
no service function reads them yet. **This report's Route Contract
Matrix below therefore covers only these 9 write operations.** Any
GET/list route is out of scope here (§7) — inventing one now would
mean inventing both the service operation and its HTTP contract
simultaneously, the same failure mode already avoided in the
Authorization milestone.

---

## 1. Existing API conventions — confirmed, not assumed

### 1a. Backend (Express) conventions, from `auth.routes.js` + `app.js`

- Routers are **self-contained**: `auth.routes.js` never imports any
  domain service, by design (a checkable scope boundary, not just
  prose). The general Routes milestone will need its own equivalent
  files per domain area, not one router importing everything.
- **Thin routing**: HTTP request → service call → HTTP response. No
  business logic in route handlers. This must be preserved for domain
  routes.
- **Local, not global, error mapping**: `sendDomainError`/
  `ERROR_STATUS_MAP` live inside `auth.routes.js` itself, explicitly
  because a shared/global version was deliberately deferred ("that
  decision belongs to a future Routes milestone with its own review").
  **That review is now due** — see §4.
- **Validation is local to the router that needs it**: `registerSchema`/
  `loginSchema` live in `auth.validation.js`, applied only in the two
  routes that need a body shape; `/refresh`, `/logout`, `/me` have none
  because they're cookie/context-driven, not because validation was
  skipped.
- **Known vs. unknown errors are never treated the same**: only errors
  with a status mapped in `ERROR_STATUS_MAP` forward their `.message`
  to the client. Anything unmapped logs server-side in full and returns
  a fixed generic 500 body. This exact pattern must carry over — it is
  not auth-specific, it is a correctness property (never leak internal
  error detail) that applies to every domain route equally.

### 1b. Global wiring, from `app.js`

- `express.json()`, `cookie-parser`, `cors`, then `authMiddleware`
  globally, in that order, before any router mounts.
- `authMiddleware` is **advisory** — every request gets
  `req.actorContext` (populated `{id, role}` or `null`), and a
  missing/invalid token never rejects the request at the middleware
  layer. This is what makes anonymous browsing possible and must not
  be changed by the Routes milestone.
- A global 404 handler (`{success:false, message:"Not found"}`) and a
  global error-handling middleware
  (`{success:false, message: err.message||"Internal server error"}`)
  already exist as the outermost safety net — **but neither matches
  the `{success, data, message, code?}` envelope** (§5 — both omit
  `data`, and the global error handler omits `code` too). This is a
  pre-existing gap, not something this milestone introduces, but it's
  now directly relevant because §5 requires envelope consistency.

### 1c. No V1 legacy code to reconcile against

Confirmed by `git log` across all branches/history: this repository has
never contained the V1 codebase. "Existing API conventions" for this
report means the two files above (`auth.routes.js`, `app.js`) — there
is no second, older convention competing with them.

---

## 2. Authentication middleware placement

**Confirmed correct pattern, to be replicated exactly, not reinvented:**

- `authMiddleware` is mounted once, globally, in `app.js`, before any
  router. Domain routers **must not** mount their own copy or call
  `verifyAccessToken`/read cookies themselves — that would create a
  second actor-resolution path, which `auth.routes.js`'s own header
  comment explicitly identifies as the exact defect this architecture
  avoids ("no other file... independently resolves an actor").
- Every domain route handler's only job re: identity is to read
  `req.actorContext` (already populated or `null`) and pass it straight
  through to the relevant service function as that service's first
  argument — exactly how `auth.routes.js`'s `/me` route already does it
  (`res.json({ user: req.actorContext })`, no service call).
- **Route handlers must not call `requireActor()`/`requireRole()`.**
  Those are domain-service-layer primitives (AUTH-L1/L2, `server/src/
  services/authorization.js`), consumed only by the four domain
  services. A route calling them directly would duplicate domain
  authorization at the HTTP boundary — exactly the anti-pattern this
  brief calls out. The route's only authorization-adjacent
  responsibility is deciding *whether a route requires any actor at
  all before even calling the service* (see §2a) — everything past
  that point is the service's job, not the route's.

### 2a. Does any route need an HTTP-layer "must be logged in" gate?

Investigated directly: **no route needs one, because every one of the
9 operations already calls `requireActor()` as its own first line**
(confirmed in §0's source files). A route-level "reject anonymous
requests" check would be **redundant** with what the service already
guarantees, not a missing piece — calling the service with
`actorContext = null` already produces the correct `UNAUTHORIZED`
domain error, which the route's error-mapping layer (§4) turns into
401. Adding a second, earlier gate at the route layer would be
duplicating a check that already exists one layer down, for no
behavioral gain — explicitly the kind of duplication AUTH-L1's
consolidation was meant to eliminate, not reintroduce at a different
layer.

**Conclusion: all 9 routes stay unguarded at the Express layer (no
route-level `if (!req.actorContext) return 401` check anywhere);
`requireActor()` inside each service remains the single, sole
enforcement point.** This is a locked-worthy finding, listed in §8.

---

## 3. Validation boundary

### 3a. Body/shape validation — needed, and where

Every `payload`-shaped operation (`createIssue`, `createKnowledge`,
`createComment`, `createProject`, `reject`'s `feedback`, `revise`'s
`updatedContent`) currently has **zero shape validation before
Mongoose** — Phase D's own header comments confirm this explicitly
("Payload shape validation (Zod) is an API-boundary concern that does
not exist yet... assume the caller has already produced a shape-valid
payload"). This is not a gap introduced by Routes — it's the
documented, deliberate state Phase D left things in, on record, waiting
for exactly this milestone.

Per the `auth.validation.js` precedent: each domain area gets its own
local Zod schema file (`issue.validation.js`, `knowledge.validation.js`,
`comment.validation.js`, `project.validation.js`), applied only to the
routes that accept a body, mirroring `registerSchema`/`loginSchema`'s
placement exactly.

### 3b. Path parameter validation (IDs)

`changeStatus`, `submitForReview`, `approve`, `reject`, `revise` all
take a Mongo ObjectId as a path-shaped parameter
(`issueId`/`knowledgeId`). Every one of these already independently
wraps its first `findById` in a try/catch translating a Mongoose
`CastError` into `DomainError(VALIDATION_FAILED)` (confirmed across
all 4 relevant service files — the Phase D "CastError translation"
fix). **This means route-level path-param validation would be
redundant with existing, already-tested service behavior**, exactly
the same shape as §2a's finding for actor presence. No route-level
ObjectId-format check is needed; malformed IDs already surface
correctly as `VALIDATION_FAILED` → 400 through the existing error
path.

### 3c. Unknown fields

No existing convention discards unknown body fields explicitly — Zod's
default (`.parse`) strips unrecognized keys silently by not including
them in the parsed output, which is what `auth.validation.js`'s
`registerSchema`/`loginSchema` already rely on (confirmed: routes pass
`parsed.data`, not raw `req.body`, downstream). Domain route schemas
should follow the same pattern — parse, then pass `parsed.data`, never
`req.body`, to the service.

### 3d. Mongoose/domain validation remains defense-in-depth

Confirmed unchanged and still necessary: every service's own
`wrapMongooseValidationError` helper stays exactly as-is. Zod at the
route boundary catches malformed requests early with client-friendly
messages; Mongoose schema validation remains the structural backstop
for anything Zod's schema doesn't (yet) enforce, or for direct
service-layer callers (tests) that bypass Zod entirely — this two-layer
relationship is explicitly how `auth.service.js`'s email
canonicalization already works (Zod canonicalizes at the boundary,
`auth.service.js` also canonicalizes independently "for callers that
bypass this route entirely"). Domain routes should preserve the same
two-layer relationship, not collapse validation into Zod alone.

---

## 4. Error translation

### 4a. Proposed status mapping (extending `ERROR_STATUS_MAP`'s existing pattern)

| `DomainErrorCode` | HTTP status | Notes |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Already mapped in `auth.routes.js`; identical meaning here |
| `UNAUTHORIZED` | 401 | Already mapped |
| `FORBIDDEN` | 403 | **Not yet mapped anywhere** — `auth.routes.js` has never needed it (no role checks in that router). New for this milestone. |
| `NOT_FOUND` | 404 | Already mapped |
| `TARGET_NOT_FOUND` | 404 | **Not yet mapped** — Comment-specific (`refType`/`refId` doesn't resolve). Same HTTP status as `NOT_FOUND`, distinct domain code, per `errors.js`'s own doc comment distinguishing them. |
| `INVALID_STATE` | 409 | **Not yet mapped** — "the target is not in a state this operation accepts" is a conflict-with-current-state situation, matching `EMAIL_ALREADY_REGISTERED`'s existing 409 precedent (an existing-state conflict, not a client-input format problem) |
| `INVALID_PARENT` | 409 | **Not yet mapped** — Comment parent-rule violation, same conflict-with-state reasoning as `INVALID_STATE` |
| `STATE_RACE` | 409 | **Not yet mapped** — concurrent-modification conflict; 409 is the standard HTTP status for this class of failure |
| `AUTHORIZATION_POLICY_UNRESOLVED` | **See §4b — deliberately not a normal mapping** | |

### 4b. `AUTHORIZATION_POLICY_UNRESOLVED` — explicit confirmation, not silently FORBIDDEN

**Confirmed: this must not collapse into 403.** `errors.js`'s own
comment on `authorizationPolicyUnresolved()` states the distinction
directly: an ordinary `FORBIDDEN` means "this actor is not allowed";
`AUTHORIZATION_POLICY_UNRESOLVED` means "no one can be correctly
evaluated for this yet, because the policy itself does not exist."
Mapping both to the same HTTP status would erase that distinction at
exactly the boundary where an API consumer (including the eventual
frontend) most needs it — a 403 implies "you specifically lack
permission," which is false for every actor attempting
`acknowledged→in_progress` or `in_progress→resolved` today, regardless
of role.

**Proposed distinct treatment**: **501 Not Implemented**, with
`code: "AUTHORIZATION_POLICY_UNRESOLVED"` and the existing D-3a message
forwarded verbatim (it's already client-safe — "authorization for
X -> Y is not yet defined (D-3a)" contains no internal detail). 501 is
the correct HTTP semantic for "this operation is recognized but its
authorization mechanism is not implemented" — distinct from every 4xx
status above, which all describe request or state problems, not a
missing capability on the server's side. This is a **proposal for
review**, not locked by this report alone (see §8) — an alternative
(403 with a distinguishing `code` field, relying on `code` alone to
carry the distinction) is defensible and should be explicitly chosen
or rejected before implementation, not left implicit.

Either way, **`AUTHORIZATION_POLICY_UNRESOLVED` gets its own entry in
whatever status map is built — it must never simply fall through to
the same branch as `FORBIDDEN`.**

### 4c. Unmapped/unknown errors

Same principle as `auth.routes.js`'s `sendDomainError`: only errors
with a status in the map forward `.message` to the client; anything
else logs server-side in full and returns a fixed generic 500 body.
This principle is not auth-specific and must be preserved exactly for
domain routes — most likely via **one shared error-mapping utility**
this time, since the same table now needs to live somewhere used by 4+
routers rather than duplicated 4 times (the auth router's own doc
comment already flagged this as a "future Routes milestone" decision —
this is that decision, to be made explicitly in §8, not smuggled in).

---

## 5. Response shape — envelope compatibility, checked directly, not assumed

The frontend's actual, already-built contract (`src/lib/api/types.ts`):

```ts
ApiSuccess<T> = { success: true, data: T, message: string }
ApiFailure    = { success: false, data: null, message: string, code?: string }
```

`src/app/api/system/route.ts` (a Next.js-side route, Foundation
milestone) **already conforms to this exactly** —
`{ success, data, message }` on success, `{ success, data: null,
message, code }` on failure.

**🔴 Confirmed finding: `auth.routes.js` does NOT conform to this
envelope.**

| Route | Actual shape today | Matches `ApiResponse<T>`? |
|---|---|---|
| `POST /register`, `/login`, `/refresh` (success) | `{ success: true, user }` | ❌ No `data`, no `message` |
| `POST /logout` (success) | `{ success: true }` | ❌ No `data`, no `message` |
| `GET /me` (success) | `{ success: true, user }` | ❌ No `data`, no `message` |
| `sendDomainError` (any auth failure) | `{ success: false, code, message }` | ❌ No `data: null` |
| `app.js` global 404 | `{ success: false, message }` | ❌ No `data: null`, no `code` |
| `app.js` global error handler | `{ success: false, message }` | ❌ No `data: null`, no `code` |

Concretely: `apiRequest<T>()` unconditionally does `return body.data`
on success. Called against any current auth endpoint, `body.data` is
`undefined` — the `user` object would be silently lost, not thrown as
an error (no runtime schema check exists in `apiRequest`, so this
fails silently rather than loudly). **This has not caused a visible bug
yet only because frontend Authentication integration hasn't started**
(explicitly a later milestone per the existing roadmap) — but it is a
real, confirmed, pre-existing incompatibility, not a hypothetical one.

**This report does not fix `auth.routes.js`** — that file belongs to
the closed Authentication milestone, and silently patching it as a side
effect of Routes discovery would be exactly the kind of scope creep
this project's discipline has consistently avoided elsewhere. It is
flagged here, explicitly, as a **required decision for whoever starts
frontend Authentication integration**, and as the reason the Routes
milestone's own new routes must not repeat the same mistake.

**Recommendation for Routes milestone's new routes: conform to
`ApiResponse<T>` exactly, on every route, every status code, no
exceptions** — `{ success: true, data: <resource>, message: <string> }`
on success, `{ success: false, data: null, message, code }` on every
failure, including the global 404/error-handler fallbacks (which would
also need updating for consistency, since a request to an unmatched
domain route currently gets the non-conforming global 404 shape).

---

## 6. Route Contract Matrix

Base path convention: `/api/v1/<domain>`, matching `/api/v1/auth`'s
existing precedent. Every route consumes `req.actorContext` from the
existing global middleware; no route re-resolves identity itself (§2).
Every response conforms to `ApiResponse<T>` (§5). Status codes below
combine §4's mapping with each operation's success case.

| Service operation | HTTP method | Route | Auth required (route-level) | Request body / params | Success status | Error → status |
|---|---|---|---|---|---|---|
| `createIssue` | POST | `/api/v1/issues` | None (service enforces via `requireActor`) | body: `{title, description, location, severity?, category?, domain?}` | 201 | `VALIDATION_FAILED`→400, `UNAUTHORIZED`→401 |
| `changeStatus` | PATCH | `/api/v1/issues/:issueId/status` | None | path: `issueId`; body: `{targetStatus}` | 200 | `VALIDATION_FAILED`→400, `UNAUTHORIZED`→401, `FORBIDDEN`→403, `NOT_FOUND`→404, `INVALID_STATE`→409, `STATE_RACE`→409, `AUTHORIZATION_POLICY_UNRESOLVED`→**501 (§4b, needs sign-off)** |
| `createKnowledge` | POST | `/api/v1/knowledge` | None | body: `{title, body, region, ...}` (exact shape per `Knowledge.js` schema, not fully enumerated here — belongs to the implementation plan, not this report) | 201 | `VALIDATION_FAILED`→400, `UNAUTHORIZED`→401 |
| `submitForReview` | POST | `/api/v1/knowledge/:knowledgeId/submit` | None | path: `knowledgeId` | 200 | `UNAUTHORIZED`→401, `FORBIDDEN`→403 (non-author), `NOT_FOUND`→404, `INVALID_STATE`→409 |
| `approve` | POST | `/api/v1/knowledge/:knowledgeId/approve` | None | path: `knowledgeId` | 200 | `UNAUTHORIZED`→401, `FORBIDDEN`→403 (non-EXPERT or self-review), `NOT_FOUND`→404, `INVALID_STATE`→409, `STATE_RACE`→409 |
| `reject` | POST | `/api/v1/knowledge/:knowledgeId/reject` | None | path: `knowledgeId`; body: `{feedback}` | 200 | `VALIDATION_FAILED`→400 (empty feedback), `UNAUTHORIZED`→401, `FORBIDDEN`→403, `NOT_FOUND`→404, `INVALID_STATE`→409, `STATE_RACE`→409 |
| `revise` | POST | `/api/v1/knowledge/:knowledgeId/revise` | None | path: `knowledgeId`; body: `{title?, body?, region?}` (per §0's payload note — only these 3 fields, confirmed in the service) | 200 | `VALIDATION_FAILED`→400, `UNAUTHORIZED`→401, `FORBIDDEN`→403 (non-author), `NOT_FOUND`→404, `INVALID_STATE`→409 |
| `createComment` | POST | `/api/v1/comments` | None | body: `{refType, refId, body, parentComment?}` | 201 | `VALIDATION_FAILED`→400 (bad refType, or D-COMMENT-1 violation via `invalidParent`), `UNAUTHORIZED`→401, `TARGET_NOT_FOUND`→404, `INVALID_PARENT`→409 |
| `createProject` | POST | `/api/v1/projects` | None | body: `{title, description, originIssue}` | 201 | `VALIDATION_FAILED`→400, `UNAUTHORIZED`→401, `NOT_FOUND`→404 (bad originIssue), `INVALID_STATE`→409 (ineligible Issue status) |

Notes on the matrix:
- "Auth required (route-level)" is **"None" for every row**, per §2a's
  finding — this is intentional and consistent, not an omission per
  row.
- `changeStatus`'s route uses `PATCH` (a partial state update) rather
  than `POST`, the one method choice in this matrix that isn't a direct
  copy of `auth.routes.js`'s all-`POST` pattern (that router has no
  analogous "transition a resource's state" operation to model against).
  Flagged for explicit review, not silently assumed — `POST` would also
  be defensible and matches this codebase's only existing precedent.
- Exact request-body field lists for `createKnowledge` are deliberately
  left approximate here — enumerating them precisely from
  `Knowledge.js`'s schema is implementation-plan-level detail, not
  discovery-level; listing them wrong in this report would be a
  documentation defect of exactly the kind flagged in the previous
  Authorization review cycle.

---

## 7. Explicitly out of scope for this report (and, likely, for the Routes milestone itself)

- Any GET/listing/retrieval route — no service operation exists to
  route to (§0). Building one now means inventing the service
  operation too, which is domain work, not routing work.
- Fixing `auth.routes.js`'s envelope non-conformance (§5) — belongs to
  whoever starts frontend Authentication integration, flagged not
  fixed here.
- D-3a resolution in any form — `AUTHORIZATION_POLICY_UNRESOLVED`'s
  proposed 501 mapping (§4b) is a *representation* decision (how an
  already-unresolved state appears over HTTP), not a resolution of the
  underlying policy question. The two D-3a-gated transitions remain
  exactly as blocked as before.
- Any edit/delete route — no service operation exists (consistent with
  the Authorization milestone's own finding).
- A generic multi-domain error-mapping *implementation* — this report
  identifies that one is now needed (§4c) but does not write it; that's
  implementation-plan work.

---

## 8. Open decisions requiring explicit sign-off before an implementation plan is written

1. **`AUTHORIZATION_POLICY_UNRESOLVED` → 501, or 403 with a
   distinguishing `code`?** (§4b) — proposed 501, not locked.
2. **`changeStatus` → `PATCH` or `POST`?** (§6 note) — proposed PATCH,
   not locked, given no existing precedent to defer to either way.
3. **Should the shared error-mapping utility (§4c) be built now, as
   part of Routes, or is duplicating `auth.routes.js`'s local pattern
   across 4 new routers acceptable for this milestone, with
   consolidation deferred?** Building it now touches `auth.routes.js`
   only if it's refactored to use the new shared utility too — a scope
   decision (does Routes get to touch the closed Authentication
   milestone's file to consolidate, or does the new utility exist
   standalone until a later cleanup pass touches `auth.routes.js`?)
   that needs an explicit answer, not an assumption.
4. **Route-level "no auth check at all" (§2a) — confirm this is
   correct and intended**, not merely a discovery-time observation that
   should have prompted adding one. Restated because it's the kind of
   finding easy to mistake for a gap rather than a confirmed, evidence-
   backed design conclusion.
5. **Global 404/error-handler envelope non-conformance** (§5's
   `app.js` findings) — does fixing these belong to this milestone
   (they're shared, cross-cutting infrastructure, arguably route-layer)
   or count as touching already-closed Authentication-milestone
   territory the same way `auth.routes.js` itself does?
