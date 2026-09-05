@AGENTS.md

# AquaVeda Progress

## Current Milestone

Authentication — implementation in progress. Architecture fully locked
(`docs/architecture/decision-register.md` §"Locked — Authentication").
Implementation plan Phases A–G **implemented, reviewed, and verified
for real against real MongoDB**: `npm run verify:models` **44/44**,
`npm run verify:validation` **63/63**, `npm test` **126/126**,
including every concurrency test (Issue, Knowledge, and the
refresh-token single-use race). Phase H (cookie deployment specifics —
`SameSite`, `Domain`) not started.

## Completed

### Domain Model Decision Phase
- Full entity-by-entity Domain Model Analysis (User, Issue, Knowledge,
  Comment, Project, Recommendation)
- Issue status lifecycle resolved and documented in `docs/adr/ADR-0003-issue-lifecycle.md`
- Knowledge moderation lifecycle resolved and documented in `docs/adr/ADR-0004-knowledge-lifecycle.md`
- Issue↔Project relationship (cardinality, ownership, authority) resolved
  in `docs/domain/domain-model.md`
- Recommendation resolved as a derived, non-persisted service output
- Cross-entity consistency review performed — no contradictions found
- `docs/architecture/decision-register.md` records the full disposition: locked
  decisions, deferred items, implementation details, and the one
  remaining open dependency
- `docs/domain/domain-model.md` updated with resolved lifecycles and the
  cross-entity principle (ownership/participation/contribution/governance/
  verification are distinct forms of authority)

**Open dependency carried forward, not resolved:** D-3a — the mechanism by
which a user becomes an authorized remediation actor for
`acknowledged → in_progress` and `in_progress → resolved` is deferred to
the Project/Act authorization design. No role, assignment model, or
membership-based authority has been invented to close it. This blocks
final closure of the Issue authority matrix; it does not block persistence
design from proceeding.

### Persistence Design
- Five collections mapped: User, Issue, Knowledge, Comment, Project.
  Recommendation stays unpersisted (derived service output)
- Embedded status/review history (ADR-0005), conditional atomic lifecycle
  transitions (ADR-0006) — both locked and approved
- `docs/architecture/persistence-design.md` (approved)

### Phase D — Service Implementation
- `server/src/services/`: `issue.service.js` (createIssue, changeStatus),
  `knowledge.service.js` (createKnowledge, submitForReview, approve,
  reject, revise), `comment.service.js` (createComment),
  `project.service.js` (createProject)
- `server/src/services/errors.js`: `DomainError` + `DomainErrorCode`
  enum, including `AUTHORIZATION_POLICY_UNRESOLVED` as D-3a's concrete
  runtime representation — `changeStatus()` throws it unconditionally for
  `acknowledged → in_progress` and `in_progress → resolved`, for every
  role. No one can move an Issue past `acknowledged` through the service
  layer yet; this is intentional, not a bug
- Actor context boundary: every service takes `actorContext = { id,
  role }` as an opaque input; services never touch JWTs/headers/sessions
- D-COMMENT-1 locked and tested: replies must target the same
  `(refType, refId)` as their parent; cross-target and reply-to-reply
  both rejected
- `server/tests/`: one test file per service, plus
  `tests/helpers/testDb.js` (isolated `TEST_MONGO_URI` connection +
  cleanup). Full suite verified green against real MongoDB, including
  all three concurrency tests (Issue `open→acknowledged` race, Issue
  `resolved→verified` race, Knowledge `approve`/`reject` race)
- Fixed during verification: CastError → `VALIDATION_FAILED` translation
  on every service's first ID lookup; test discovery glob
  (`"tests/**/*.test.js"`); env loading moved from `server.js` to
  `db.js` so `npm test` (which never touches `server.js`) still gets a
  populated `process.env`, with `TEST_MONGO_URI` enforced distinct from
  `MONGO_URI` at runtime
- Full detail: `docs/architecture/decision-register.md` §Persistence Design,
  §Phase D

### Authentication — Architecture (locked) and Implementation Phases A–G

**Architecture**, reviewed and locked across four rounds of proposal →
correction (see `docs/architecture/decision-register.md` §"Locked —
Authentication" and the four supporting analysis documents in
`docs/architecture/authentication-*.md`): Topology B deployment,
HttpOnly-cookie-only browser transport, proportionate security posture,
five-endpoint minimal auth API scope, `actorContext = { id, role }`
unchanged, D-3a unaffected, dedicated `Session` collection, split
access/refresh JWT secrets, `{ sub }` / `{ sub, sid }` payload split,
fresh-DB role resolution, hashed-only refresh-credential storage, TTL ≠
runtime enforcement, single-use refresh rotation, and the L17
logout-vs-access-token-expiry trade-off.

**Implementation, Phases A–G of `authentication-implementation-plan.md`**:
- `server/src/config/env.js` — canonical, shared environment
  configuration entry point; `server/src/config/db.js` refactored to
  consume it (mechanical, `connectDB()`'s behavior and `{ envVar }`
  mechanism unchanged)
- `server/src/models/Session.js` — `userId`, `tokenHash` (`select:
  false`), `expiresAt` with a real MongoDB TTL index
  (`expireAfterSeconds: 0`); `_id` serves as `sid`
- `server/src/services/auth-tokens.js` — `node:crypto` scrypt password
  hashing (stored format embeds cost params for future upgrades),
  `jsonwebtoken` sign/verify for access (`{ sub }`) and refresh
  (`{ sub, sid }`) tokens via split `JWT_ACCESS_SECRET`/
  `JWT_REFRESH_SECRET`, SHA-256 refresh-token hashing (deliberately not
  the same mechanism as password hashing)
- `server/src/services/auth.service.js` — `register`, `login`,
  `refresh`, `logout`. No `resolveActor` — request-actor resolution is
  reserved exclusively for the future auth middleware (Phase E), per an
  explicit correction to the implementation plan
- Refresh rotation uses a single atomic `Session.findOneAndDelete`
  (`_id`, `userId`, `tokenHash`, `expiresAt: { $gt: now }`) — reuses
  Phase D's conditional-atomic-update pattern rather than a new
  concurrency strategy; verified with a strict concurrency test
  (exactly one of two simultaneous identical-token refreshes succeeds)
- `server/src/services/errors.js` extended with `INVALID_CREDENTIALS`,
  `EMAIL_ALREADY_REGISTERED`, `REFRESH_FAILED` — same flat
  `DomainError`/`DomainErrorCode` contract, no new hierarchy
- **Two real bugs found and fixed during focused review, before this
  was considered done**: (1) token signing originally happened *after*
  persisting the User/Session, so a signing failure (e.g. misconfigured
  secret) could leave a permanently-stuck, duplicate-blocked account —
  fixed by signing both tokens before any write; (2) `verifyPassword`
  could throw on a corrupted/malformed stored hash (invalid hex,
  invalid scrypt params) instead of safely returning `false` — fixed
  with explicit hex and parameter validation, plus 12 new tests proving
  each malformed case is rejected without throwing
- `server/src/middleware/auth.js` (Phase E) — the sole, exclusive owner
  of request-actor resolution: cookie extraction → `verifyAccessToken`
  → fresh `User` lookup by `sub` → `{ id, role }`. Advisory, never
  rejects a request itself — missing/invalid/expired tokens all resolve
  to `actorContext = null`, preserving Product Invariant 5 (anonymous
  browsing). Role is read fresh from the database on every request,
  never trusted from the token — verified directly with a test that
  changes a user's role mid-session and confirms the *same*, still-valid
  access token reflects the new role on the next request. As of Phase F,
  now actually wired into the real Express pipeline (see below) —
  Phase E's own review correctly identified this as a non-blocking,
  intentional integration gap at the time, not a defect.
- `server/src/routes/auth.routes.js` + `app.js` wiring (Phase F): the
  five-endpoint auth API (`register`, `login`, `logout`, `me`,
  `refresh`), self-contained — grep-verified (via a regex matching
  actual `from "..."` import specifiers, not naive substring search) to
  never import `issue.service.js`/`knowledge.service.js`/
  `comment.service.js`/`project.service.js`. `app.js` now wires
  `cookie-parser → cors → authMiddleware (global) → routes`, in that
  order. Two new dependencies added (`cookie-parser`, `cors`), both
  flagged as required before installing, per this project's standing
  practice.
- **Two service-contract gaps found and fixed before Phase F could be
  wired up**: `refresh()` returned only tokens, but the route needs
  `{ user }` in its response — fixed by resolving the user fresh
  (consistent with L11) and returning the same shape as
  register()/login(). `logout()` took a bare `sid`, but a route only
  ever has the raw refresh-token cookie — fixed to accept the raw
  token and internally attempt verification, staying idempotent for
  every failure mode (missing/malformed/expired/already-consumed).
- Duration parsing (JWT lifetimes, `Session.expiresAt`, cookie
  `maxAge`) consolidated into one shared function
  (`auth-tokens.js`'s `parseDurationToMs`) rather than three
  independent regexes that could silently drift apart — a correction
  applied during Phase F's own review.
- Cookies: `access_token` (`Path=/`) and `refresh_token`
  (`Path=/api/v1/auth` — the whole auth namespace, not just the two
  routes that read it; an earlier comment claiming otherwise was
  corrected). `HttpOnly` and `Secure` (production) are locked;
  `SameSite`/`Domain` read from env vars, explicitly not guessed from
  Topology B alone (separate deployment ≠ automatically cross-site).
- CORS: explicit `ALLOWED_ORIGINS` allowlist, `credentials: true`,
  never a wildcard with credentials; a disallowed origin gets no
  `Access-Control-Allow-Origin` header via `callback(null, false)`
  (not a thrown error, which had briefly produced a misleading 500
  before being caught and fixed). Verified directly against a live
  server, not just asserted, plus 3 dedicated regression tests.
- Error mapping is local to `auth.routes.js` only (no generic/global
  error module) and, per an explicit review correction, only forwards
  `.message` to the client for a **known, mapped** `DomainErrorCode` —
  any unmapped/unexpected error (a bug, a raw Mongoose/library error)
  is logged in full server-side and always returns a fixed generic
  body, never its own message. Originally verified with a
  currently-reachable scenario (a non-string password reaching
  `crypto.scrypt` with no Zod validation in front of it yet); Phase G
  has since closed that specific hole earlier and more precisely (see
  below) — the test was updated to reflect the improved behavior, not
  deleted.
- **Phase G (Zod validation)**: `server/src/validation/auth.validation.js`
  — `registerSchema` (name: trimmed, 1–100 chars; email: trimmed,
  lowercased, valid format; password: 8–128 chars, no composition
  rules) and `loginSchema` (email same canonicalization; password only
  checked for presence — deliberately does NOT enforce registration
  password-length rules, since a login attempt must still reach
  credential verification regardless of whether the password would
  satisfy today's registration policy). Wired into `/register` and
  `/login` only, via `parsed.data` (not raw `req.body`) — this is what
  actually delivers Zod's canonicalization forward, not just validates
  shape. No schema for `/refresh`, `/logout`, or `/me` (cookie/context-
  driven, nothing to validate).
- **Real bug found and fixed during Phase G gathering, not hypothetical**:
  `login()`'s `User.findOne({ email })` never normalized casing — Mongoose's
  `lowercase: true` schema option only fires when *saving* a document,
  not on a plain query filter, so a user registering as
  `Test@Example.com` (stored correctly as lowercase) who later typed the
  same casing at login would get a false `INVALID_CREDENTIALS`. Fixed
  with a local `canonicalizeEmail()` helper applied in **both**
  `register()` and `login()` directly — not only in Zod — specifically
  because every service function in this project is also called
  directly by tests, bypassing Zod/routes entirely; a fix living only
  in Zod would have left that direct-call path still broken. Proven with
  a test that calls `login()` directly (no HTTP, no Zod) with a
  differently-cased email against an already-registered lowercase one.
- Reviewed with three minor cleanup items, all applied: a stale
  "No Zod validation yet" comment in `auth.routes.js` (Phase G had
  since been implemented in that same file), stale "Phase C" labeling
  in `verify-validation.js`'s header/output (removed — a verification
  script shouldn't permanently encode milestone numbering), and one
  route-level test that claimed to prove name-trimming but only checked
  that registration succeeded — strengthened to assert the actual
  returned (trimmed) name.
- D-3a untouched: no file in this phase reads, writes, or reasons about
  Issue status/lifecycle
- Full detail: `docs/architecture/decision-register.md` §"Locked —
  Authentication"; implementation narrative in
  `docs/architecture/authentication-implementation-plan.md`

### Foundation Slice
- Root app shell: `layout.tsx` with metadata, fonts (Space Grotesk,
  IBM Plex Sans, IBM Plex Mono via `next/font/google`), Navbar, Footer
- ThemeProvider boundary (Client Component, isolated from Server layout)
- Route-level states: `loading.tsx`, `error.tsx`, `not-found.tsx`
- Design token system in `globals.css`: full named palette + semantic
  tokens, light and dark mode, `@theme inline` Tailwind v4 bridge,
  `contour-rule` utility, `prefers-reduced-motion` override
- One real Server → Client data loop: `getSystemSnapshot()` in `lib/system.ts`
  → `/api/system` Route Handler → `FoundationStatusCard` (server-seeded)
  → `FoundationRefreshButton` (client refetch via `useTransition`)

### UI Primitives
- `Button` (variant + size CVA, `asChild` via Radix Slot)
- `Card` + `CardHeader` + `CardTitle` + `CardDescription` + `CardContent` + `CardFooter`
- `Badge` (domain-aware variants: `default`, `verified`, `warning`, `critical`, `outline`)
- `Input`
- `Textarea` (vertical-resize only)
- `Separator` (`role="none"`, decorative)
- `Skeleton` (Server Component, animate-pulse)
- `Avatar` + `AvatarImage` + `AvatarFallback` (Radix-backed)

### Layout
- `Navbar` (Server Component, desktop nav)
- `ThemeToggle` (Client Component, hydration guard, Sun/Moon icons)
- `MobileNav` (Client Component, Radix Dialog drawer, auto-close on route
  change, active link highlight, proper ARIA)
- `Footer`

### Documentation
- `docs/vision/vision.md`
- `docs/vision/principles.md`
- `docs/vision/product-invariants.md` (standalone — constitutional rules
  that survive any domain model restructuring)
- `docs/engineering/standards.md` (coding rules, dependency policy, DoD, commits)
- `docs/engineering/testing.md`
- `docs/adr/ADR-0001-new-repository.md`
- `docs/adr/ADR-0002-backend-architecture.md`
- `docs/adr/ADR-0003-issue-lifecycle.md`
- `docs/adr/ADR-0004-knowledge-lifecycle.md`
- `docs/domain/domain-model.md`
- `docs/architecture/decision-register.md`
- `docs/architecture/nextjs-patterns.md`
- `docs/future/parking-lot.md`

### Repository layout
- `server/` sibling directory established with `package.json` and milestone
  build plan in `server/README.md` — backend built here, not in a separate repo.
  Future evolution path: `apps/web` + `apps/server` workspace layout.

## Architectural Decisions

- New repository over in-place migration (ADR-0001)
- Keep Express as separate API service, same repository (ADR-0002)
- Issue status lifecycle: 5-state, EXPERT-only verification,
  resolver≠verifier hard invariant (ADR-0003)
- Knowledge moderation lifecycle: revision-capable rejection, EXPERT-only
  review, reviewer≠author hard invariant (ADR-0004)
- Issue↔Project: `0..*` cardinality, immutable required origin reference,
  no automatic authority from Project membership
- Recommendation: derived service output, not a persisted entity
- Persistence Design: five collections only, embedded histories
  (ADR-0005), conditional atomic lifecycle transitions (ADR-0006), no
  transactions, no flat actor fields (identity lives in history entries)
- Phase D: opaque `actorContext` boundary — services never decode JWTs
  or touch sessions, so Authentication can be built independently and
  wired in later without touching service internals
- Authentication: dedicated `Session` collection rather than a
  `User`-embedded field (identity and session have different
  lifecycles/retention/invalidation semantics); split
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`; access JWT `{ sub }` only,
  refresh JWT `{ sub, sid }`, role never trusted from a token; refresh
  rotation is a single atomic `findOneAndDelete`, not a read-then-write
  pair; request-actor resolution belongs exclusively to middleware, not
  duplicated in the service layer
- Env loading anchored in `server/src/config/db.js`, not `server.js` —
  every entry point that needs the database (app, tests, future
  scripts) imports `db.js`, so `.env` loads consistently everywhere
- Domain/persistence boundary deliberately preserved throughout — domain
  decisions (e.g. "status history has domain significance") are recorded
  separately from persistence-shape decisions (embedded vs. referenced),
  which are explicitly left to the Persistence Design milestone
- Server Components by default; Client Components at the smallest boundary
- Tailwind v4 CSS-first theming; semantic tokens only in components
- Dependency policy: `package.json` reflects what's built today, never what's planned
- `MobileNav` uses Radix Dialog directly — one concrete use case does not
  justify a generic Sheet abstraction yet
- Product Invariants live in `docs/vision/product-invariants.md` separately
  from the domain model — constitutional rules should be findable independently

## Technical Debt

- `not-found.tsx` copy says "hasn't been built yet" — will need updating
  as real routes ship (acceptable for now, honest placeholder)
- **D-3a (remediation-assertion authority) remains unresolved** — not
  technical debt in the usual sense, but an explicitly deferred domain
  dependency, now enforced in code as `AUTHORIZATION_POLICY_UNRESOLVED`.
  Do not resolve it by inventing a role, assignment model, or
  membership-based authority without a dedicated Project/Act
  authorization design session.
- No API routes/controllers exist yet for the five domain services
  (Issue/Knowledge/Comment/Project) — only reachable from tests.
  Intentional; a future Routes milestone, deliberately separate from
  Authentication's own five-endpoint auth API (Phase F).
- Auth middleware, routes, and Zod validation now exist
  (`server/src/middleware/auth.js`, `server/src/routes/auth.routes.js`,
  `server/src/validation/auth.validation.js`) and are wired into the
  real Express pipeline (`app.js`: `cookie-parser → cors →
  authMiddleware → routes`). Implemented, reviewed, and **verified for
  real: 126/126** against real MongoDB. Phase H (cookie deployment
  specifics — `SameSite`, `Domain`) remains genuinely not started.

## Next Milestone

Authentication implementation, continuing with the plan's Phase H
(cookie configuration). `HttpOnly`, `Secure` in production, and `Path`
for both cookies are already locked; `SameSite` and `Domain` remain
genuinely deployment-dependent and can't be finalized until real
hosting targets are chosen — expect this phase to be about confirming
env-var wiring, not making new architectural decisions.

D-3a remains explicitly **not** in scope for Phase H — it produces/
consumes identity, not remediation authority.

## Reviewer Notes

Design System + Foundation milestone reviewed and rated 9.8/10 (prior review).

Domain Model decision phase reviewed and accepted, with one substantive
correction made during review (Knowledge approval authority corrected from
EXPERT-or-ADMIN to EXPERT-only, to stay consistent with the Issue
verification precedent and Product Invariant 9). Corrected consistently
across `ADR-0004-knowledge-lifecycle.md`, `domain-model.md`, and
`decision-register.md`; verified with a full cross-document consistency
check afterward.

D-3a is the sole remaining open domain dependency. It is intentionally
unresolved, not overlooked — closing it requires a Project/Act
authorization design this project doesn't have yet, and inventing an
answer now would be exactly the premature-abstraction failure mode this
project has been deliberately avoiding.

Persistence Design (ADR-0005, ADR-0006) and Phase D (service
implementation) both closed since the last review pass and are not yet
reviewed by ChatGPT — flagged for review before Authentication work
begins, per this project's standard cycle.

Phase D closure is backed by real test execution (`npm test` against
live MongoDB via `TEST_MONGO_URI`), not just code existing — including
all three concurrency tests. Two fixes were required during verification
(CastError translation, env-loading anchored in `db.js` instead of
`server.js`) — both are recorded in `decision-register.md` so they don't
get silently reverted later.

Authentication's architecture went through four full review rounds
(deployment/cookie/security posture → scope boundary → session storage
→ consolidated decision report), each with corrections actually applied,
not rubber-stamped — see `decision-register.md`'s "Locked —
Authentication" section for the final, corrected form. Implementation
Phases A–D then went through their own focused review pass, which
caught two real bugs (a registration partial-failure ordering issue and
an unguarded `verifyPassword` crash path on a malformed stored hash) —
both fixed and covered by new tests before this phase was accepted as
done, not after. Verification after Phases A–D, run against real
MongoDB on the developer's own machine after two secrets were missing
from local `.env` on the first attempt: **88/88 tests, 44/44 model
checks, 44/44 validation checks** — all actually green, not assumed.

Phase E (middleware) reviewed separately: approved with no required
changes — one style suggestion explicitly marked optional (a
try/catch-based restructure of the branch logic) and one architectural
observation explicitly marked non-blocking (database failures during
role lookup currently look identical to "not authenticated"; flagged
for a future milestone, not this one). Confirmed non-blocking: the
middleware is unit-tested but not yet wired into the real Express
pipeline (no `cookie-parser`, `app.js` untouched) — explicitly called
out by the reviewer as an intentional Phase F dependency, not a Phase E
defect. Verified for real after review: **96/96 tests** (88 + 8 new
middleware tests) against real MongoDB.

Phase F (routes + `app.js` wiring) reviewed with one required fix
(error-message leakage for unmapped/unexpected errors — could have
exposed raw Mongoose/library detail to a client; fixed to log
server-side and always return a fixed generic body for anything not a
known `DomainErrorCode`) plus two cleanup items (a misleading cookie-
path comment, and explicit CORS regression tests). Two genuine
service-contract gaps were also found and fixed *before* wiring, not
patched around: `refresh()`'s missing `user` in its response, and
`logout()` expecting a `sid` a route can never actually have. All
corrections applied and verified standalone (a real non-string-password
request confirmed to produce a sanitized 500, not a leaked error; CORS
allow/deny behavior confirmed against a live server). The developer's
first real local run after the required fix caught **two bugs in the
new tests themselves** (an `/me` test asserting a field `actorContext`
never carries, and a scope-boundary test whose naive substring search
false-positived on the router's own documentation comment) — both
fixed and re-verified standalone. Final local re-run: **113/113,
0 failures** — confirmed against real MongoDB.

Note on test-count bookkeeping: Claude's own sandbox (no `mongod`
available there) had reported "114 tests discovered" from a
connection-failure run, which turned out to be a red herring — when a
suite's setup hook throws before any of its children can run, Node's
test runner counts that suite's own failure as one aggregate entry
distinct from how it tallies `cancelled` children in later suites,
producing an off-by-one artifact specific to a broken-DB environment.
Both environments report the same `suites: 28` (identical file/test
structure), confirming nothing was actually missing — 113 is the real,
correct total, verified by an actual successful run rather than by
counting discovered-but-unexecuted tests in a broken environment.

Phase G (Zod validation) reviewed: approved, no architectural violation
or blocking bug found. Three minor cleanup items required (a stale
Phase-F-era comment in `auth.routes.js`, stale "Phase C" labeling in
`verify-validation.js`, and one route-level test that didn't actually
prove what its name claimed) — all applied. `npm run verify:validation`
confirmed **63/63** offline after cleanup, and the full local suite
confirmed **126/126** against real MongoDB — Phase G is fully closed.

Next: Phase H (cookie configuration), building on this now-fully-
verified Phase A–G foundation.
