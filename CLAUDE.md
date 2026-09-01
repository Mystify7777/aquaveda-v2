@AGENTS.md

# AquaVeda Progress

## Current Milestone

Authentication — implementation in progress. Architecture fully locked
(`docs/architecture/decision-register.md` §"Locked — Authentication").
Implementation plan Phases A–D **complete and verified for real**, not
just written: `npm run verify:models` **44/44**, `npm run
verify:validation` **44/44**, `npm test` **88/88** — full suite green
against real MongoDB, including every concurrency test (Issue, Knowledge,
and the new refresh-token single-use race). Phases E–H (middleware,
routes, validation, cookies) not started.

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

### Authentication — Architecture (locked) and Implementation Phases A–D

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

**Implementation, Phases A–D of `authentication-implementation-plan.md`**:
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
- No auth routes/middleware/cookies exist yet either (Phases E–H of the
  implementation plan) — `auth.service.js` is currently only reachable
  from tests, same as the domain services.

## Next Milestone

Authentication implementation, continuing with the plan's Phase E
(middleware — producing `actorContext` from a request), then Phase F
(the five auth routes), then Phase G (Zod validation for register/login
payloads). Phase H (cookie configuration) has two items already locked
(`HttpOnly`, `Secure` in production) and two genuinely deployment-
dependent items (`SameSite`, `Domain`) that can't be finalized until
real hosting targets are chosen.

D-3a remains explicitly **not** in scope for any of Phases E–H — they
produce/consume identity, not remediation authority.

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
done, not after. Final verification, run against real MongoDB on the
developer's own machine after two secrets were missing from local
`.env` on the first attempt: **88/88 tests, 44/44 model checks, 44/44
validation checks** — all actually green, not assumed.

Next: Phase E (middleware), building on this now-verified Phase A–D
foundation.
