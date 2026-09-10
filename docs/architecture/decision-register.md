# Decision register

This is the single canonical decision register for AquaVeda v2,
consolidating decisions from the Domain Model, Persistence Design,
Phase D (service implementation), Authentication (architecture), and
Authorization & Ownership Policy milestones. It was previously split
across two files (`docs/domain/decision-register.md` and this file);
that split was accidental, not an intentional two-register
architecture, and the files had begun to drift. This document
supersedes both.

Domain Model milestone: produced through a staged review — full
entity-by-entity analysis → four decision clusters (Issue lifecycle,
Knowledge lifecycle, Issue↔Project, Recommendation), each proposed and
reviewed independently → cross-entity consistency review.

Persistence Design milestone: mapped the settled domain model onto
MongoDB/Mongoose without foreclosing anything left open above, then
underwent its own ADR assessment.

Phase D milestone: implemented and tested the five domain service
operations against the approved persistence schemas. Verified end-to-end
against real MongoDB, not just written — see below.

Authentication milestone: architecture reviewed and locked through four
rounds of proposal → correction (deployment topology, cookie transport,
security posture, scope boundary, session storage, JWT design, rotation
guarantee, logout semantics). Implementation Phases A–H are **complete,
reviewed, and verified for real against real MongoDB: 127/127 tests,
30 suites, 0 failures**. Phase G (Zod validation) added Zod schemas for
`register`/`login`. Phase H (cookie deployment config) resolved the
final deployment-dependent question: this deployment's topology is
genuine cross-site (frontend/backend on different registrable domains)
→ `SameSite=None` as the code default (corrected from an initial `lax`
default during review — see "🔒 Locked — Authentication, Phase H"
below), `Secure` forced whenever `SameSite=None`, `COOKIE_DOMAIN`
unset. Authentication is fully closed.

D-3a remains unresolved (see below) and is unaffected by Persistence
Design's, Phase D's, or Authentication's completion — this register is
not a record of a fully closed project state, only of the decisions
made so far.

## 🔒 Locked — Domain Model (see ADR-0003, ADR-0004, `domain-model.md`)

- Issue lifecycle: 5-state graph, transition authority, `resolverId !==
  verifierId`, EXPERT-only verification, `acknowledged` mandatory,
  failed-verification routes to `in_progress` only, `verified` terminal
  for V2.
- Knowledge lifecycle: `draft → pending_review → approved | rejected →
  draft`, EXPERT-only review authority, `reviewerId !== authorId`,
  mandatory rejection feedback, content locked during `pending_review`, no
  re-review of approved content in V2.
- Issue ↔ Project: `Issue 0..* Project`, immutable required origin
  reference, creation gated to Issue status ∈ `{acknowledged, in_progress,
  resolved, verified}`, independent ownership, independent lifecycles, no
  automatic Issue authority from Project membership.
- Recommendation: derived service output, no persistence, no
  ownership/lifecycle/authority, Invariant 7 as a service-boundary
  authority contract (not conflict detection), reasoning required on every
  response.
- Cross-entity principle: ownership, participation, contribution,
  governance, and domain verification are distinct and never inferred
  from one another without an explicit rule.

## 🔒 Locked — Persistence Design (see ADR-0005, ADR-0006, `persistence-design.md`)

- Five collections: User, Issue, Knowledge, Comment, Project. Recommendation
  is not persisted, confirming the Domain Model conclusion held under
  persistence-level scrutiny.
- `Issue.statusHistory` and `Knowledge.reviewHistory` are embedded
  subdocument arrays on their parent documents — not separate collections,
  not a shared generic history abstraction (consistent with the Domain
  Model milestone's rejection of a generic history primitive, ADR-0005).
- `Issue.statusHistory` includes the initial creation entry —
  `{fromStatus: null, toStatus: "open", actor: reportedBy, timestamp:
  createdAt}` — so it is the complete lifecycle log, not just
  post-creation transitions. `Knowledge.reviewHistory` records review
  decisions only (approve/reject), with no synthetic entry for
  `draft`/`pending_review`.
- Resolver, verifier, and reviewer identity live only inside history
  entries — no flat `resolvedBy`, `verifiedBy`, or `reviewer` field on
  either entity. The `resolved → verified` authorization check derives
  the resolver's identity by reading the most recent `statusHistory`
  entry at verification time, never from a stored field.
- Knowledge review-history embedding rests on a **V2 capacity assumption**
  (not domain-bounded, since revision cycles have no cap) — named
  reconsideration conditions are recorded in ADR-0005, not treated as
  permanent.
- Project↔Issue: reference held on `Project` (`originIssue`), not an array
  on `Issue` — avoids the same unbounded-array pattern already corrected
  once in v1 (`Issue.comments[]`).
- Project `contributors`: embedded `ObjectId` array. Explicitly does not
  grant, resolve, or imply any Issue lifecycle authority, and does not
  resolve D-3a.
- Comment `parentComment`: one-level nesting is a service/domain
  validation rule, not a schema constraint; no `parentComment` index
  proposed, since no established access pattern queries it directly.
- `Comment.refType` uses `"WIKI"` for Knowledge-targeted comments, not
  `"KNOWLEDGE"` — deliberate, carried forward from v1's proven API shape,
  not an inconsistency to "fix."
- Lifecycle transitions on Issue and Knowledge use conditional
  state-conditioned atomic writes (expected-state-gated updates), not a
  generic version field, for the currently identified concurrency class —
  scoped explicitly, not a blanket rejection of optimistic concurrency
  elsewhere.
- No multi-document transactions required under the current model — a
  direct consequence of embedded history and reference-only relationships,
  not an independent policy.
- `resolverId !== verifierId` and `reviewerId !== authorId` are service-
  layer invariants, not schema-enforceable — `immutable: true` on
  `reportedBy`/`author`/`originIssue` is defense-in-depth only, not the
  primary enforcement mechanism.
- Validation boundary split: Mongoose enforces structural GeoJSON shape
  only (`type: "Point"`, 2-tuple `coordinates`); geographic-range
  validation (longitude ∈ [-180, 180], latitude ∈ [-90, 90]) is owned by
  the Zod schema at the API boundary, not the Mongoose schema — see
  `server/src/validation/issue.validation.js`. Consistent with the
  general Zod-vs-Mongoose split in `persistence-design.md`: Zod validates
  input DTOs from the network, Mongoose enforces index-backed constraints
  and BSON-level storage shape, business logic lives in services.

## 🔒 Locked — Phase D (service implementation, verified)

Verified end-to-end against real MongoDB: `npm run verify:models`
(38/38), `npm run verify:validation` (44/44), `npm test` — full service
suite green, including all three concurrency tests (Issue
`open → acknowledged` race, Issue `resolved → verified` race, Knowledge
`approve`/`reject` race).

- **Five service operations implemented and tested**, one file per
  entity under `server/src/services/`:
  - `issue.service.js` — `createIssue`, `changeStatus`
  - `knowledge.service.js` — `createKnowledge`, `submitForReview`,
    `approve`, `reject`, `revise`
  - `comment.service.js` — `createComment`
  - `project.service.js` — `createProject`
- **Error contract**: one `DomainError` class, one `code` field.
  `DomainErrorCode` values: `VALIDATION_FAILED`, `NOT_FOUND`,
  `UNAUTHORIZED` (missing actor identity only), `FORBIDDEN` (identified
  actor, insufficient permission), `INVALID_STATE`, `INVALID_PARENT`,
  `TARGET_NOT_FOUND`, `STATE_RACE`, `AUTHORIZATION_POLICY_UNRESOLVED`
  (D-3a's concrete representation in code — see below).
- **`AUTHORIZATION_POLICY_UNRESOLVED` is D-3a made concrete.**
  `changeStatus()` throws this error, distinct from `FORBIDDEN`, for
  every attempt at `acknowledged → in_progress` or `in_progress →
  resolved`, unconditionally, for every role. No one can move an Issue
  past `acknowledged` through the service layer. This is working-as-
  designed, not a bug — do not close it by inventing a `REMEDIATOR`
  role, Project-membership authority, or any assignment model. D-3a is
  resolved only by a future Project/Act authorization design session.
- **Actor context boundary**: every service function takes
  `actorContext = { id, role }` as an opaque input. Services never
  decode JWTs, read headers, or query session state — authenticating a
  request and producing `actorContext` is Authentication's job, not
  Phase D's.
- **D-COMMENT-1 (locked)**: a reply must target the exact same
  `(refType, refId)` as its parent. Cross-target replies and
  reply-to-reply are both rejected. Implemented and tested.
- **CastError translation**: every service's first read of a
  caller-supplied ID is wrapped in try/catch, translating a malformed-ID
  Mongoose `CastError` into `DomainError(VALIDATION_FAILED)`, via the
  existing `wrapMongooseValidationError` helper already present in each
  file. Necessary because no Zod/route boundary exists yet to guarantee
  valid ID shape before services are called.
- **Env loading is anchored in `server/src/config/db.js`, not
  `server/src/server.js`.** `dotenv/config` is imported inside `db.js`
  itself, and `connectDB()` takes an explicit `{ envVar }` param
  (default `"MONGO_URI"`). Any code path that needs the database —
  `server.js` at app startup, `tests/helpers/testDb.js` at test
  setup, or any future script — gets a populated `process.env`
  automatically, because all of them ultimately import `db.js`.
  - **Problem this fixed:** `dotenv/config` was previously imported
    only in `server.js`. The test suite imports `db.js` directly via
    `testDb.js` and never touches `server.js`, so `process.env` was
    never populated when running `npm test` — failing with `Missing
    required environment variable: MONGO_URI` even though `.env` was
    correct and the app connected fine under `npm start`.
  - **Do not** remove the `dotenv/config` import from `db.js` as
    apparently-unused or redundant with `server.js`'s own import — it
    is the reason tests (and any other non-`server.js` entry point)
    receive environment variables at all.
- **Tests use `TEST_MONGO_URI`, never `MONGO_URI`, with an enforced
  guard, not just a convention.** `setupTestDb()` calls
  `connectDB({ envVar: "TEST_MONGO_URI" })` explicitly and throws
  before connecting if `TEST_MONGO_URI === MONGO_URI`. This is a
  runtime check, not documentation-only, specifically so a
  misconfigured `.env` can't cause a test run to operate on the
  development database.
- **Test discovery convention**: executable test files are named
  `*.test.js` anywhere under `server/tests/`, run via
  `node --test --test-concurrency=1 "tests/**/*.test.js"`. Non-test
  helpers (e.g. `tests/helpers/testDb.js`) are excluded by the glob,
  not by naming discipline alone.

## 🔒 Locked — Authentication (architecture locked; Phases A–H complete, reviewed, and verified for real — 127/127 tests, 30 suites)

Full derivation, options considered, and rejected alternatives:
`docs/architecture/authentication-milestone-review-draft.md`,
`authentication-scope-boundary-analysis.md`,
`authentication-session-storage-design.md`,
`authentication-architecture-decision-report.md`, and the implementation
narrative in `authentication-implementation-plan.md`.

**Implementation status**: `authentication-implementation-plan.md`'s
Phases A (dependency/config foundation), B (Session persistence), C
(auth service layer), D (token/credential utilities), E (middleware),
and F (routes + `app.js` wiring) are complete, reviewed, and verified
against real MongoDB — `npm run verify:models` 44/44, `npm run
verify:validation` 44/44, `npm test` **113/113**, including the strict
single-use-refresh concurrency test (exactly one of two simultaneous
identical-token refresh attempts succeeds) and the middleware's
changed-role-reflected-freshly test (the same, still-valid access token
reflects a role change made after issuance — the concrete proof role is
never trusted from the token). Phase F's own review details, including
its required error-leak fix, are recorded further below.
Two real bugs were found and fixed during a focused post-implementation
review of Phases A–D before they were accepted as done: a registration
partial-failure ordering issue (token signing could fail after the
User/Session were already persisted, risking a permanently-stuck
account) and an unguarded `verifyPassword` crash path on a
malformed/corrupted stored hash (fixed with explicit hex and
scrypt-parameter validation, covered by 12 new tests). Phase E's own
review found no defects requiring correction — one style suggestion and
one architectural observation (database failures during role lookup
currently look identical to "not authenticated") were both explicitly
marked non-blocking, deferred to a future milestone if ever pursued.
`server/src/middleware/auth.js` was unit-tested but not yet wired into
the real Express request pipeline at the end of Phase E — confirmed as
an intentional Phase F dependency, not a Phase E gap.

**Phase F (routes + `app.js` wiring)** is implemented and reviewed.
`server/src/routes/auth.routes.js` provides the five-endpoint auth API,
grep-verified self-contained (a regex matching actual `from "..."`
import specifiers, not naive substring search — the naive version
false-positived on this router's own documentation prose) against
`issue.service.js`/`knowledge.service.js`/`comment.service.js`/
`project.service.js`. `app.js` now wires
`cookie-parser → cors → authMiddleware (global) → routes`. Two new
dependencies added: `cookie-parser`, `cors`.

Two service-contract gaps were found and fixed *before* wiring, not
patched around afterward: `refresh()` returned only tokens but the
route needs `{ user }` in its response (fixed by resolving the user
fresh, consistent with L11); `logout()` took a bare `sid` but a route
only ever has the raw refresh-token cookie (fixed to accept the raw
token and verify internally, staying idempotent for every failure
mode). Duration parsing (JWT lifetimes, `Session.expiresAt`, cookie
`maxAge`) was consolidated into one shared function rather than three
independently-written regexes that could silently drift apart.

Phase F's review required one fix: `sendDomainError()` originally
forwarded `err.message` for ANY error, including unmapped/unexpected
ones — a real risk of leaking raw Mongoose/library/internal detail to
a client. Fixed so only errors with a known, mapped `DomainErrorCode`
have their message forwarded; anything else is logged in full
server-side and always returns a fixed generic body. Verified with a
real, currently-reachable scenario (a non-string password reaching
`crypto.scrypt` with no Zod validation in front of it yet — that's
Phase G). Two smaller cleanup items were also applied: a misleading
cookie-path comment (`Path=/api/v1/auth` scopes the refresh cookie to
the whole auth namespace, not just the two routes that read it — cookie
paths are prefix-based, not a per-route allowlist) and three dedicated
CORS regression tests (allowed origin gets credentialed headers,
disallowed origin gets none, no-Origin requests aren't blocked).

**Verification status, stated precisely rather than assumed**: the
first real local run after the required fix caught two bugs — in the
*newly-added tests themselves*, not the implementation: an `/me` test
asserted a field `actorContext` never carries (by design, only
`{ id, role }` — the test was wrong), and a self-containment test's
naive substring search false-positived on the router's own explanatory
comment (fixed to match only real import statements, re-verified to
still catch a genuine violation). Both fixes verified standalone, then
confirmed with a full local re-run: **113/113, 0 failures, against real
MongoDB.**

(Bookkeeping note: an earlier claim of "114 tests" came from Claude's
own sandbox, which has no `mongod` — a connection-failure run there
counts a suite whose setup hook throws as one aggregate entry, distinct
from how later suites' children are tallied as `cancelled`, producing
an off-by-one artifact specific to that broken environment. Both
environments report identical `suites: 28`, confirming no test was
actually missing — 113 is the correct, real total, established by an
actual successful run.)

**Phase G (Zod validation)** is implemented and reviewed.
`server/src/validation/auth.validation.js` provides `registerSchema`
(name: trimmed, 1–100 chars; email: trimmed, lowercased, valid format;
password: 8–128 chars, no composition rules) and `loginSchema` (same
email canonicalization; password checked only for presence — does NOT
enforce registration password-length rules, since a login attempt must
still reach credential verification regardless of whether the password
satisfies today's registration policy). Wired into `/register` and
`/login` only, via `parsed.data` — not raw `req.body` — which is what
actually delivers the canonicalization forward. No schema added for
`/refresh`, `/logout`, or `/me`.

A real, currently-reachable bug was found and fixed during this phase,
not invented: `login()`'s `User.findOne({ email })` never normalized
casing (Mongoose's `lowercase: true` only fires on save, not on a query
filter), so a user could register with one casing and fail to log in
with another. Fixed with a local `canonicalizeEmail()` helper applied
in **both** `register()` and `login()` directly, not only in Zod —
necessary because every service function in this project is also
callable directly by tests, bypassing Zod/routes entirely.

Reviewed with three minor cleanup items, all applied: a stale
Phase-F-era "No Zod validation yet" comment in `auth.routes.js`, stale
"Phase C" labeling in `verify-validation.js`'s header/output (a
verification script shouldn't permanently encode milestone numbering),
and one route-level test that claimed to prove name-trimming but only
checked that registration succeeded — strengthened to assert the actual
returned (trimmed) name. `npm run verify:validation` confirmed
**63/63** offline after cleanup (44 original + 19 new). **Closed**:
full local `npm test` re-confirmation against real MongoDB came back
clean as part of the Phase H run below (127/127) — no Phase-G-specific
regression found.

Phase H (cookie deployment specifics — `SameSite`, `Domain`) is
implemented, locked, and **verified for real: 127/127 tests, 30 suites,
against real MongoDB**. See "🔒 Locked — Authentication, Phase H" above
for the resolved values.

- **Deployment topology**: Topology B — frontend and backend deploy
  independently; the browser talks to the API over HTTPS as a separate
  deployment unit. Cookie/CORS configuration must be correct for genuine
  cross-origin operation, not tuned loosely for local same-origin
  convenience.
- **Browser token transport**: HttpOnly cookies only, for both access
  and refresh tokens. No `localStorage`, no `sessionStorage`, no
  frontend-managed bearer headers, ever.
- **Cookie attributes**: `HttpOnly: true` (all environments) and
  `Secure: true` (production, and now also whenever `SameSite=None`)
  are locked outright. `Path` is locked (`/` for access, the auth
  namespace for refresh). `SameSite`/`Domain` were deployment-dependent
  and are now resolved (Phase H, above): **`SameSite` does not default
  to "cross-site" merely because Topology B separates the
  deployments** — the relevant fact is *registrable domain*, not
  deployment independence. This deployment's frontend/backend are
  confirmed to be on genuinely different registrable domains, so
  `SameSite=None` (with mandatory `Secure`) applies. Had they instead
  been sibling subdomains of one parent domain, `SameSite=Lax` would
  have applied instead.
- **Security posture**: proportionate to a low-friction community
  platform — correctness, reasonable security, maintainability, low
  friction, operational simplicity, in that order. Not banking-grade
  ceremony; do not add heavyweight security infrastructure (device
  fingerprinting, reuse-detection systems, MFA, etc.) without a concrete
  requirement.
- **Milestone scope**: authentication infrastructure **and** a
  five-endpoint minimal auth API (`POST /auth/register`,
  `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `POST /auth/refresh`). General domain routes (Issue, Knowledge,
  Comment, Project) remain fully deferred to a future Routes milestone.
- **Scope boundary test**: an endpoint belongs to Authentication iff its
  responsibility is establishing, resolving, or terminating an
  authenticated session/identity — not merely because it happens to be
  implemented via a particular file. Today that means it never invokes
  a pre-existing domain service; that file-level fact is a consequence
  of the responsibility boundary, not its definition.
- **`actorContext` contract unchanged**: `{ id, role }`, opaque input to
  every domain service, exactly as Phase D established. Authentication
  middleware is the sole producer. No domain service signature changes.
- **D-3a remains fully unresolved.** `AUTHORIZATION_POLICY_UNRESOLVED`
  stays exactly as Phase D implemented it for
  `acknowledged → in_progress` and `in_progress → resolved`.
  Authentication establishes identity and role; it does not, and must
  not be used to, determine remediation authority. The arrival of real
  roles via Authentication is not itself a resolution mechanism.
- **Refresh-token/session storage**: a dedicated `Session` collection,
  not a `User`-embedded field. Governing rationale is separation of
  responsibility, lifecycle, retention, and invalidation semantics
  between identity and session — independent of rotation strategy or
  write frequency. Collection is named `Session`, not `RefreshToken`,
  since it may eventually carry more than a token hash (revocation
  metadata, last-used timestamps, device metadata if ever justified).
- **JWT payload — identity only, no role.** Role is never trusted from
  a token; always resolved fresh from the database on every request
  that needs `actorContext` (this is the specific V1 defect being
  corrected — V1's JWT middleware trusted the decoded payload's role
  without a DB lookup). Payload composition differs by token:
  - **Access token: `{ sub }` only.** Confirmed against a concrete
    test, not assumed: access-token verification only ever needs a
    `User` lookup by `sub` for role resolution, never a `Session`
    lookup, so `sid` has no consuming code path there. Adding `sid` to
    the access token for hypothetical future revocation-propagation use
    is rejected — no current requirement calls for instant
    access-token revocation, and the proportionate mechanism for
    bounding post-logout/revocation exposure is the token's short
    lifetime (see logout/expiry entry below), not a per-request session
    lookup on the hot path of every authenticated request.
  - **Refresh token: `{ sub, sid }`.** `sid` (the `Session` document's
    own `_id`) is required so refresh can resolve the exact `Session`
    being rotated, rather than resolving by `userId` alone — the latter
    breaks as soon as multiple concurrent sessions exist, which the
    `Session`-collection design deliberately doesn't preclude.
- **Credential storage**: refresh tokens are stored server-side only as
  hashes (`Session.tokenHash`), never as raw tokens — consistent with
  `User.passwordHash`'s existing pattern.
- **Session expiry enforcement**: a MongoDB TTL index on
  `Session.expiresAt` handles eventual physical cleanup but is **not**
  the expiry check itself — the TTL monitor's sweep is periodic, not
  real-time. The service layer must independently verify
  `expiresAt > now` before treating any session as valid, regardless of
  whether MongoDB has physically deleted an expired document yet.
- **Refresh strategy — simple rotation.** Each successful refresh
  invalidates the prior `Session` document and issues a new one. No
  reuse-detection system, no device fingerprinting.
- **Single-use refresh guarantee is a locked architectural requirement,
  not an implementation detail.** Once a refresh token has been used to
  rotate, that exact token must never succeed again — a second attempt
  with the same superseded token must fail, unconditionally, regardless
  of timing. Only the technical mechanism enforcing this under
  concurrent requests is left to implementation planning (recommended:
  reuse the same conditional-atomic-update discipline already proven
  for Issue/Knowledge lifecycle transitions under ADR-0006, rather than
  inventing a new pattern).
- **Logout does not, and cannot, invalidate an already-issued
  unexpired access token — this is intended behavior, not a gap.**
  Logout deletes the current `Session` document, immediately
  invalidating the refresh token. The access token is a stateless JWT
  verified without any DB/session lookup, so it continues to
  authenticate requests until its own short natural expiry
  (`JWT_ACCESS_EXPIRES`). This is the accepted proportionate trade-off
  under the locked security posture, not a bug to be fixed by adding a
  per-request session-validity check to the access-token path — doing
  so would reintroduce exactly the per-request `Session` lookup the JWT
  payload decision above rejected.

## ⏸️ Deferred

| Item | Note |
|---|---|
| User suspension/deactivation | No current requirement; adding a status field now would be speculative |
| Expert role acquisition mechanism | Belongs to the Authentication/Governance milestone — `role: EXPERT` as a fact is established, the assignment *process* is not |
| Comment deletion (soft/hard) | No v1 precedent, no current requirement |
| Project status field | Explicitly decided against for V2; revisit only if the Act milestone proves a need |
| Leaving a project | No v1 precedent, no current requirement |
| Admin governance of already-approved Knowledge | Real future need, not solved by extending approval authority now |
| Re-review of approved Knowledge | Out of scope for V2 |
| Issue recurrence / reopening `verified` | Parked; a future `relatedIssue` reference is the likely shape, not un-terminaling `verified` |

## 🔧 Implementation detail (resolved when the relevant schema is written, no ADR needed)

- Issue `category`: enum vs. freeform representation.

## 🟢 Established (already correct, not reopened)

- One-level comment threading (carried from v1, no pressure to change).
- Dashboard data stays fully derived via aggregation, no persistence.

## 📝 Documentation tasks (not decisions)

- Invariant-7 wording in `domain-model.md` — written as an authority
  contract, not a UI-framing note. Done.
- Plural "Projects originating from an Issue" phrasing enforced throughout
  `domain-model.md` and future docs, to prevent drift back toward an
  implied `0..1` relationship. Done.

## 🟡 The only unresolved domain dependency

**D-3a — Remediation-assertion authority.**

The Issue lifecycle (ADR-0003) requires `acknowledged → in_progress` and
`in_progress → resolved` to be performed by an "authorized remediation
actor." The mechanism by which a user obtains that authority is not
resolved by the Domain Model milestone, and neither Persistence Design's
nor Phase D's completion changes that:

- The `actor` field on relevant history entries (ADR-0005) is a plain
  `ObjectId ref User`, not role-gated or tied to Project membership,
  specifically so this remains a service-layer decision to make later
  rather than a schema decision already made.
- At the service layer, `changeStatus()` represents this as the
  dedicated `AUTHORIZATION_POLICY_UNRESOLVED` error code (distinct from
  `FORBIDDEN`), thrown unconditionally for both gated transitions, for
  every role. This must not be converted into `FORBIDDEN`, a role rule,
  Project-ownership authority, contributor authority, or any other
  invented authorization mechanism as part of unrelated work.

Status:

- Does not block `domain-model.md`, ADR-0003, ADR-0005, or ADR-0006 from
  documenting the rest of the Issue lifecycle and its persistence.
- Does not block Phase D's service implementation — the unresolved
  transitions are simply unreachable through the service layer today,
  which is intentional, working-as-designed behavior, not a bug.
- Does block final closure of the Issue authority matrix.
- To be resolved during Project/Act authorization design, once an actual
  Project membership/authorization model exists to attach an answer to.
- Explicitly not resolved by: inventing a `REMEDIATOR` role, an
  explicit-assignment system, or granting automatic authority from Project
  creator/contributor status. Persistence Design (`persistence-design.md`
  §3) restates this explicitly for the `contributors` array specifically.

Candidate models on record for that future design session (none selected):
automatic-by-creator, automatic-by-contributor, explicit assignment,
EXPERT/ADMIN-only, or a combination.

**Re-confirmed, not reopened, by the Authorization & Ownership Policy
milestone** — see AUTH-L5 below for the concrete evidence (no
membership/join/assignment mechanism exists anywhere in the codebase
today) gathered during that milestone's investigation.

## 🔒 Locked — Authentication, Phase H (cookie deployment config)

**Resolved topology: genuine cross-site.** Frontend and backend are
confirmed to sit on different registrable domains — not sibling
subdomains. This resolves the deployment-dependent question left open
since Phase F/G:

- **`SameSite=None`, mandatory.** `Lax` (the prior silent default)
  never sends the cookie on cross-site requests; this deployment's
  auth would appear to fail only in production. `resolveCookieSameSite()`
  (`server/src/config/env.js`) validates `COOKIE_SAME_SITE` against
  `{strict, lax, none}` at first read and throws on anything else —
  no unvalidated string reaches Express's cookie serializer.
- **`Secure` forced whenever `sameSite === "none"`**, independent of
  `NODE_ENV`. The prior production-only gate is kept as an additional
  OR term (not replaced), so a hypothetical future non-cross-site
  deployment using `lax`/`strict` keeps today's prod-only behavior
  unchanged.
- **`COOKIE_DOMAIN` stays unset (host-only).** The `Domain` attribute
  only enables sharing across subdomains of the *same* registrable
  domain — irrelevant here, since frontend/backend are different
  registrable domains entirely. `resolveCookieDomain()` validates the
  value only if one is explicitly provided (rejects whitespace or a
  domain with no dot); no forced default.
- `baseCookieOptions()` in `auth.routes.js` now calls both resolvers
  directly — no new abstraction added; `setAuthCookies`/
  `clearAuthCookies` already shared this function before Phase H and
  continue to.
- CORS (`ALLOWED_ORIGINS`, `credentials: true`) unchanged — already
  required an exact-origin allowlist (no wildcard) for credentialed
  cross-origin requests to work at all; cross-site topology makes this
  requirement load-bearing rather than incidental, but no code change
  was needed.
- D-3a untouched, as with every prior Authentication phase.

**Review correction applied before closure:** `resolveCookieSameSite()`
originally defaulted a missing `COOKIE_SAME_SITE` to `"lax"` — a
same-site default that would have silently broken production auth on
this deployment's confirmed cross-site topology, directly contradicting
Phase H's own fail-fast intent. Corrected to default to `"none"` (this
deployment's locked value); `verify-cookie-config.js`'s corresponding
check updated to match. This is a hardcoded deployment-specific
default, acceptable because this codebase serves one locked topology,
not a reusable package.

**Verification:** `npm run verify:cookie-config` — **10/10**, offline
(`resolveCookieSameSite`/`resolveCookieDomain` validation logic in
isolation, no DB). `node --check` clean on all touched files. Full
`npm test` re-run against real MongoDB, on the developer's machine,
after the default fix: **127/127 tests, 30 suites, 0 failures** —
closing Phase H and the previously-open Phase G re-confirmation
together in the same run. (An earlier draft cited 128 tests; that was
an arithmetic error against the actual reported run — 126 tests/29
suites before Phase H, +1 test/+1 suite added, 127/30 is correct.)

## 🔒 Locked — Authorization & Ownership Policy (implemented, reviewed, and verified for real — 138/138 tests, 32 suites)

**Status: implementation complete and verified.** Promoted from
`authorization-architecture-decision-report.md`, implementation plan
in `authorization-implementation-plan.md`, both reviewed. Full suite
re-run against real MongoDB after implementation: **138/138 tests, 32
suites, 0 failures** (127 prior + 11 new in `authorization.service.test.js`,
1 new suite). Offline verify scripts unaffected: `verify:models` 44/44,
`verify:validation` 63/63, `verify:cookie-config` 10/10.

Full derivation, inventory table, and rejected alternatives:
`docs/architecture/authorization-architecture-decision-report.md`.
Restated here only as locked conclusions.

- **AUTH-L1 — `requireActor(actorContext)` is a shared primitive.
  Implemented.** Was duplicated byte-for-byte across all four domain
  services (`issue.service.js`, `knowledge.service.js`,
  `comment.service.js`, `project.service.js`). Now extracted into
  `server/src/services/authorization.js`, imported by all four, with
  no behavior change — throws `UNAUTHORIZED` iff `!actorContext?.id`,
  exactly as before. Pure deduplication, no new policy.

- **AUTH-L2 — `requireRole(actorContext, role)` is single-role-only,
  permanently. Implemented.** Signature takes exactly one role string,
  never an array or set. Not an implementation detail deferred for
  later convenience — locked specifically so Product Invariant 9
  ("Experts verify. Admins govern. Neither substitutes for the other.")
  stays structurally impossible to violate at any call site. Now live
  at all 5 call sites (corrected from an initially-missed count of 4 —
  see below): `issue.service.js`'s `authorizeTransition()` at
  `open→acknowledged`, `resolved→verified`, `resolved→in_progress`
  (the first of these was found only during implementation, not in the
  original investigation report's inventory — corrected retroactively
  in both this entry and `authorization-implementation-plan.md`), and
  `knowledge.service.js`'s `approve()`/`reject()`. The thrown message
  is intentionally canonical ("Forbidden: insufficient role
  privileges") rather than the 5 previously-distinct sentences — a
  deliberate, reviewed normalization; the specific role and actor's
  actual role are carried in `details.requiredRole`/`details.actualRole`,
  not in prose. A future request to widen this to accept multiple
  roles (e.g. `["EXPERT", "ADMIN"]`) is a reopening of this decision,
  not an extension of it, and requires its own review.

- **AUTH-L3 — Ownership is operation-specific authority, not a
  universal rule.** Confirmed by direct inspection: only Knowledge's
  `author` field currently grants any right (`submitForReview`,
  `revise` — both author-only, both narrow). Issue's `reportedBy`,
  Project's `creator`, and Comment's `author` grant **zero** rights
  today; no operation reads them for authorization purposes at all.
  "Ownership automatically grants authority" is explicitly **rejected**
  as a general project rule — Issue's own design already contradicts
  it (a reporter has no special status-change authority over their own
  report; that authority is role-based or D-3a-gated, never
  reporter-based). No generic `requireOwner(doc, actorContext, field)`
  is introduced. If `knowledge.service.js` grows a third ownership
  check, a same-file, Knowledge-specific helper may be justified then —
  that is not decided here, and is explicitly not the same thing as a
  cross-entity generic.

- **AUTH-L4 — ADMIN's lack of a concrete capability is an
  acknowledged, open gap — not resolved, not manufactured.** Every
  existing operation that could plausibly be governance-shaped
  (Issue's transitions, Knowledge's `approve`/`reject`) already has a
  settled EXPERT-based or D-3a-gated authority story under ADR-0003/
  ADR-0004; re-purposing any of them to ADMIN would contradict an
  already-locked decision, not extend one. The one deferred item that
  actually matches "governance over something existing" — admin
  governance of already-approved Knowledge — remains in the ⏸️
  Deferred table below, unsolved, pending a concrete shape (unpublish?
  flag? re-review trigger?) that does not exist yet. No ADMIN-only
  operation is added as part of this milestone. Invariant 9's
  governance half remains asserted in product docs and
  unimplemented in code — stated here explicitly so it is not mistaken
  for an oversight.

- **AUTH-L5 — D-3a remains explicitly unresolved.** Re-confirmed by
  this milestone's own investigation, not merely carried forward
  unexamined: `Project.contributors` is written once (empty array, at
  creation) and never read or written by any other service function —
  there is no join operation, no assignment mechanism, no membership
  concept for D-3a's candidate models
  (`automatic-by-creator`/`automatic-by-contributor`/`explicit
  assignment`) to attach to. `AUTHORIZATION_POLICY_UNRESOLVED` in
  `issue.service.js` is untouched by this milestone, exactly as it was
  before. See "🟡 The only unresolved domain dependency" above for the
  full standing decision — this entry does not restate or supersede
  it, only confirms it survived this milestone's review unchanged.

**Explicitly not locked here** (no evidence found to justify locking):
a generic `requireOwner()`, any multi-role/role-set authorization API,
any ADMIN-gated operation, any edit/delete operation on any entity, any
Project membership model. See the decision report's §7 "Out of scope"
for the complete list.

## 🔒 Locked — Routes (implemented, reviewed, and verified for real — 232/232 tests, 54 suites)

**Status: implementation complete.** Full derivation:
`docs/architecture/routes-milestone-discovery-report.md`,
`docs/architecture/routes-implementation-plan.md` (Checkpoints A–F, all
reviewed). Implementation, review, and full regression verification
narrative: `docs/architecture/checkpoint-e-incident-report.md` (6 test
failures surfaced during Checkpoint E's real MongoDB run — 1 genuine
product gap, fixed; 5 defects in a pre-existing test file not authored
as part of this milestone, corrected — full root-cause analysis there).

Final state: exactly 9 domain routes, 1:1 with the 9 existing service
operations (2 Issue, 5 Knowledge, 1 Comment, 1 Project — confirmed by
direct enumeration, no extras), plus `auth.routes.js`'s pre-existing 5
routes migrated onto the shared response infrastructure (ROUTE-L5). No
GET/listing/edit/delete route exists anywhere. Full suite verified for
real against real MongoDB: **232/232 tests, 54 suites, 0 failures**.
Offline verify scripts unaffected: `verify:models` 44/44,
`verify:validation` 71/71, `verify:cookie-config` 10/10.

Restated below only as locked conclusions, resolving
`routes-milestone-discovery-report.md` §8's open decisions.

- **ROUTE-L1 — Route handlers never resolve identity themselves.**
  Every route consumes the existing global `authMiddleware`'s
  `req.actorContext` (populated `{id, role}` or `null`) and passes it
  straight to the relevant service function as that function's first
  argument. No domain router parses cookies, verifies JWTs, or
  duplicates `authMiddleware`'s job — that remains its sole, exclusive
  owner, unchanged from the Authentication milestone.

- **ROUTE-L2 — Exact route inventory: exactly 9 routes, 1:1 with the 9
  existing service operations** (`createIssue`, `changeStatus`,
  `createKnowledge`, `submitForReview`, `approve`, `reject`, `revise`,
  `createComment`, `createProject`). No retrieval/listing route (none
  exist to route to), no edit/delete route (none exist), no route
  invented merely because REST convention suggests one "should" exist.
  `changeStatus` uses `PATCH /api/v1/issues/:issueId/status` (a
  partial-state-update semantic, the one deliberate departure from
  `auth.routes.js`'s all-`POST` precedent, chosen because that router
  has no analogous "transition a resource's state" operation to model
  against). Every other write operation uses `POST`, matching
  `auth.routes.js`'s existing convention.

- **ROUTE-L3 — No route-level "must be authenticated" gate.** Confirmed
  by direct inspection (discovery report §0/§2a): all 9 domain-service
  operations already call `requireActor()` as their first line. A
  route-level check before calling the service would be redundant with
  behavior the service already guarantees, and would reintroduce the
  exact duplication AUTH-L1 consolidated away — at a different layer,
  not eliminated. No route in this milestone performs such a check;
  `UNAUTHORIZED` reaches the client exclusively via the service throwing
  it, translated by ROUTE-L4's shared error mapping.

- **ROUTE-L4 — One shared HTTP/domain-error mapping utility, used by
  every router.** A single `DomainErrorCode → HTTP status` table
  (generalizing `auth.routes.js`'s previously router-local
  `ERROR_STATUS_MAP`) covers every code in the codebase, not just the
  Authentication-specific subset. Within that table:
  `AUTHORIZATION_POLICY_UNRESOLVED` maps to HTTP 409, with
  `code: "AUTHORIZATION_POLICY_UNRESOLVED"` distinguishing it from
  `INVALID_STATE`/`STATE_RACE`, which also use 409 — all three
  represent a state/policy conflict at the same HTTP-semantic level, so
  they share a status; the response body's `code` field — already part
  of the standard failure envelope (ROUTE-L6) — is what an API consumer
  actually branches on to tell them apart, not the status code alone.
  This is never silently folded into `FORBIDDEN`'s 403 — `FORBIDDEN`
  means "this actor specifically lacks permission";
  `AUTHORIZATION_POLICY_UNRESOLVED` means "no policy exists yet to
  evaluate anyone against," a materially different fact that must
  remain visible to callers. D-3a itself remains completely unresolved
  by this decision — this only fixes how its already-unresolved state
  is represented over HTTP. Any error with an unmapped code is logged
  server-side in full and returns a fixed generic 500 body, never
  forwarding `.message` — the same principle `auth.routes.js`'s
  original `sendDomainError` already established, now shared rather
  than router-local.

- **ROUTE-L5 — `auth.routes.js` is migrated onto the shared utility
  (ROUTE-L4), as part of this milestone, not deferred.**
  `auth.routes.js`'s local `ERROR_STATUS_MAP`/`sendDomainError`
  (Authentication milestone) is replaced by the shared version —
  deliberately reopening that file rather than leaving the
  inconsistency in place. Justification: the discovery report's §5
  confirmed `auth.routes.js`'s response envelope does not conform to
  the frontend's `ApiResponse<T>` contract at all (`{success, user}`,
  no `data`/`message`) — a real, already-existing defect, not a
  hypothetical one. Fixing envelope conformance only in the 4 new
  domain routers while leaving `auth.routes.js` non-conforming would
  leave the actual defect in place. `auth.routes.js`'s *authentication
  business logic* (token issuance, cookie handling, refresh rotation,
  all locked under Authentication's L1–L17) is explicitly untouched —
  only its error/response *presentation* layer is migrated.

- **ROUTE-L6 — Every HTTP response, across all routers (including
  `auth.routes.js` and the global 404/error-handler fallbacks in
  `app.js`), conforms exactly to the frontend's existing `ApiResponse<T>`
  contract** (`src/lib/api/types.ts`): success →
  `{success: true, data: <resource>, message: <string>}`; failure →
  `{success: false, data: null, message: <string>, code?: <string>}`.
  No route returns a bespoke shape. This closes the confirmed gap from
  the discovery report's §5 across the entire HTTP surface, not just
  the 4 new domain routers.

**Explicitly not locked here**: any GET/listing route, any edit/delete
route, D-3a resolution in any form (ROUTE-L4 changes only its HTTP
*representation*, not the underlying unresolved policy), any change to
`authMiddleware`'s advisory (non-rejecting) behavior.
