# Frontend Product Implementation Phase — plan

**Status: roadmap document.** The F1 authentication-integration slice is
implemented by Issue #36; this document continues to describe the broader
frontend sequence and the work that remains future or backend-dependent.

Issue #36 added the root `AuthProvider`, `/login` and `/register` pages,
`RequireAuth` for contribution entry points, session-aware navigation, the
credentialed API base URL, and focused pure session-state tests. See
`docs/architecture/auth-boundaries.md` for the current contract.

---

## 0. Current repository state (inspected directly, not assumed)

### Frontend

```
src/
├── app/
│   ├── api/system/route.ts     Next.js-local route (Foundation slice)
│   ├── error.tsx / loading.tsx / not-found.tsx
│   ├── layout.tsx               root layout, fonts, ThemeProvider, Navbar/Footer
│   └── page.tsx                 home page (Foundation status card)
├── components/
│   ├── foundation/               FoundationStatusCard, FoundationRefreshButton
│   ├── layout/                   Navbar, Footer, MobileNav, ThemeToggle, AuthControls
│   ├── providers/                ThemeProvider (next-themes), AuthProvider
│   ├── auth/                     LoginForm, RegisterForm, RequireAuth
│   └── ui/                       Button, Card, Badge, Input, Textarea,
│                                  Separator, Skeleton, Avatar, EmptyState
└── lib/
    ├── api/client.ts             apiRequest<T>() — targets ApiResponse<T> and the configured Express API
    ├── api/auth.ts               auth endpoint client functions
    ├── auth-state.js             pure session-state classification
    ├── api/types.ts              ApiSuccess/ApiFailure/ApiResponse<T>
    ├── api/system.ts             one example consumer (getSystemSnapshot)
    ├── system.ts
    └── utils.ts                  cn()
```

Confirmed by direct inspection, not inferred:

- **`Navbar`/`MobileNav` already link to `/explore`, `/learn`, `/act`,
  `/community`, `/dashboard`** — none of these routes exist under
  `src/app/` yet. These are currently broken links, not placeholders —
  the foundation anticipated the product surfaces before building them.
- **`apiRequest<T>()` unwraps the exact `ApiResponse<T>`
  envelope** the backend's Routes milestone locked (ROUTE-L6) — the
  frontend's own API boundary and the backend's response shape agree. Auth
  calls use the configured `NEXT_PUBLIC_API_URL` base URL, while the system
  snapshot continues to use its Next.js-local route.
- **No data-fetching library, form library, or map library is
  installed** (`package.json` dependencies: Radix avatar/dialog/slot,
  `class-variance-authority`, `clsx`, `lucide-react`, `next-themes`,
  `tailwind-merge` only). TanStack Query, React Hook Form, Zod (client-
  side), and Leaflet — all named in the original dependency policy as
  deferred until a concrete requirement exists — are still absent.
- **No Dialog/Sheet/Select/Tabs/Table generic UI primitive exists.**
  `MobileNav` uses Radix Dialog directly for its own concrete need
  (the mobile drawer); no generic wrapper was built around it,
  consistent with Foundation's stated policy of not building
  abstractions ahead of a second real use case.
- **The existing data-fetching pattern** (`FoundationStatusCard`): a
  Server Component fetches the initial snapshot, passes it to a Client
  Component that holds it in `useState` and re-fetches manually via a
  button. No caching, no background refetch, no shared cache between
  components — adequate for one self-contained card, not a pattern that
  scales to list views, pagination, or cross-component cache
  invalidation (e.g. a new Comment updating a count elsewhere on the
  page).

### Backend (for reference — not modified by this plan, per the issue's
own constraints)

Confirmed via the closed Routes milestone (`decision-register.md`
§"Locked — Routes", ROUTE-L1–L6): **9 domain routes exist, all writes,
zero reads.**

```
POST   /api/v1/issues
PATCH  /api/v1/issues/:issueId/status
POST   /api/v1/knowledge
POST   /api/v1/knowledge/:knowledgeId/submit
POST   /api/v1/knowledge/:knowledgeId/approve
POST   /api/v1/knowledge/:knowledgeId/reject
POST   /api/v1/knowledge/:knowledgeId/revise
POST   /api/v1/comments
POST   /api/v1/projects
POST/GET /api/v1/auth/{register,login,logout,me,refresh}
```

**There is no GET/list endpoint for Issue, Knowledge, Comment, or
Project anywhere in the backend.** This is not an oversight to route
around on the frontend — it's the actual, current, locked state of the
API. It is the single most important constraint on this plan: **no
frontend phase can display a list or detail view of real domain data
without a backend change that has not happened yet.**

---

## 1. Proposed frontend phase structure

Five phases, ordered by backend-readiness, not by product-area
importance — but **backend readiness determines implementation
timing; product importance determines prioritization within each
unblocked capability.** Concretely: F2's four contribution primitives
are equally unblocked, but Issue reporting should be built first
within F2 because Explore is the product's most prominent public
surface (the navbar already exposes it first) — "the backend has a
POST endpoint" is not by itself a reason to treat two unblocked things
as equally worth building next.

```
Foundation (existing)
   │
   ├──> F1 — Auth integration                       UNBLOCKED
   │      (actual session-bootstrap architecture is issue #8's
   │      call, not this plan's — see the note under §4)
   │
   └──> T1 — Testing foundation                      cross-cutting
          (this plan defers to issue #3 for the actual testing
          vocabulary/tooling decision; flagged as a dependency this
          plan assumes exists before F2 produces much surface area to
          test, not something #1 re-specifies — see caveat below)

F1, T1 ──> F2 — Contribution primitives              UNBLOCKED
              │                                        (narrowed, see below)
              │  runs in parallel with, not strictly after:
              │
              └── Backend: Issue/Knowledge/Comment/Project GET+list
                  endpoints (external, tracked as its own issue)
                            │
                            ▼
F2 + backend GET ──> F3 — Read/product surfaces        BLOCKED on backend
                            │
                            ▼
                      F4 — Dashboard                    BLOCKED on backend aggregation
                            │
                            ▼
                      F5 — AI-assisted UI                BLOCKED on the AI milestone existing
```

**Caveat, stated explicitly rather than assumed:** this plan has not
read issue #3's or #8's actual content (out of reach from this
environment at time of writing). The testing-foundation and
auth-architecture placements above are structural slots this plan
expects those issues to fill — not a claim about what they already
say. Whoever merges this plan should confirm #3/#8's actual scope
lines up with what's assumed here before treating F1/T1 as satisfied.

### Phase F1 — Frontend Authentication Integration

**Status: implemented by Issue #36.** The provider initializes from `/me`,
attempts refresh only after an expected anonymous response, and preserves
separate `initializing`, `authenticated`, `anonymous`, `session-failure`, and
`unavailable` states. Auth uses HttpOnly cookies through the existing API
boundary; tokens are not stored in browser storage.

**Purpose:** connect the existing `src/lib/api/` boundary to the 5
already-verified auth endpoints; establish session-aware layout
behavior (logged-in vs. anonymous nav state); establish the
route-protection pattern every later phase will reuse.

**Bounded scope:**
- Register, login, logout forms/flows.
- Session restoration on load (`GET /me`) and the resulting
  logged-in/anonymous UI split in `Navbar`.
- A reusable "requires auth" route/layout pattern — not a full RBAC UI
  system, just enough to redirect an anonymous user attempting a
  protected action.
- **Not in scope:** password reset, email verification, OAuth, MFA —
  none of these exist on the backend (Authentication's own
  `decision-register.md` entry explicitly lists them as premature, not
  merely unbuilt).
- **The actual session-bootstrap architecture (client-only vs. partial
  server-side) is explicitly not prescribed by this plan** — that
  belongs to issue #8. This plan only states the dependency direction:
  #1 defines auth's *role in the product roadmap* (what depends on a
  logged-in actor, and when); #8 defines the actual implementation. §4
  restates this at the point it would otherwise be tempting to
  prescribe a specific pattern.

### Phase F2 — Contribution Primitives

**Purpose:** prove authenticated contribution against the 4 genuinely
write-primitive endpoints — not every backend mutation that happens to
exist. **Narrowed from an earlier draft of this plan**, which included
Knowledge's approve/reject/revise actions here; those require a
meaningful browsing/review context to mean anything as a UI, and
building that context without GET endpoints would produce an
artificial reviewer interface detached from the actual product. They
now belong to F3, alongside the read surfaces they're meaningless
without.

**Bounded scope:**
- An Issue-report form (title/description/location/severity/category)
  that calls `POST /api/v1/issues` for real and shows a success/error
  state. Built as a **reusable contribution surface from the start**
  (a component, not a throwaway route — see §3's correction), so its
  eventual home inside Explore isn't a migration, just a mount point
  change.
- A Knowledge **draft-authoring form only** (`POST
  /api/v1/knowledge`) — proving an author can create a draft. Submit/
  approve/reject/revise are explicitly F3 (see above).
- A Comment composer component, built once, generic over
  `refType`/`refId` (mirrors the backend's own Comment design — a
  shared primitive, not reinvented per mount point). Developed and
  tested in isolation via whatever component-testing setup T1/#3
  establishes — not via a standalone product route built solely to
  have somewhere to mount it (an earlier draft of this plan proposed
  exactly that "bare test harness page"; removed — testing
  infrastructure and product routes are different concerns and
  shouldn't blur together).
- A Project-creation form, callable only with a manually-entered
  `originIssue` ID (no Issue picker UI yet — that needs Issue listing,
  F3).

**Explicit product framing for this phase:** these are functional but
deliberately unpolished surfaces — proving the write path end-to-end,
not the final Explore/Learn/Act UX. Each one becomes part of its
eventual full feature once F3 unblocks the read half; only the Issue-
report and Comment-composer components are designed from the outset to
relocate without rebuilding, since those two are the ones with an
obvious, already-known eventual mount point (Explore's map/detail,
Issue/Knowledge detail pages respectively).

### Phase F3 — Read/Product Surfaces

**Purpose:** once backend GET/list endpoints exist (tracked as its own
backend-side issue, proceeding in parallel with F2 — not waited on
serially, per the corrected ordering above), build Explore (Issue map
+ list + detail), Learn (Knowledge list + detail + review workflow +
Comment thread), and Act (Project list + detail), and relocate F2's
Issue-report form and Comment composer into their real homes.

**This phase also introduces the shared data-fetching layer** — see §4
for why this is framed as an evaluation, not a pre-decision.

**Knowledge review workspace (approve/reject/revise UX), deferred from
F2, lives here** — it needs Knowledge's list/detail context to be a
real UI, not an artificial standalone action panel.

### Phase F4 — Dashboard & Aggregation Views

**Purpose:** role/issue/project aggregation views. Explicitly separated
from F3 because aggregation is its own backend capability (V1's
dashboard service used Mongo aggregation pipelines with a documented
bug — `decision-register.md`/legacy findings — that V2's backend has
not yet rebuilt), not a byproduct of F3's list endpoints.

### Phase F5 — AI-Assisted UI

**Purpose:** surface for the eventual recommendation/explanation
feature. Explicitly last: the backend's AI milestone doesn't exist yet
even as a locked architecture decision, and Product Invariant "AI
assists and explains — it does not silently override verified
knowledge or authoritative moderation" has direct, non-trivial UI
consequences (recommendations must be visually distinguished from
verified content) that can't be designed against a backend contract
that hasn't been written.

---

## 2. Implementation order and dependencies

```
F1 (Auth) ─┬─> F2 (Contribution primitives) — needs F1's session state
T1 (#3)   ─┘      for role-aware UI and for POST calls to carry
                   credentials at all; needs T1's testing conventions
                   established before producing much surface to test
      │
      │  runs in parallel with:
      ▼
Backend: Issue/Knowledge/Comment/Project GET+list endpoints (external)
      │
      ▼
F3 (Read/product surfaces) — needs F2's components to relocate into,
      │                       needs the backend GET work above to have
      │                       actually landed (not just "be in
      │                       progress")
      │
      ├──> F4 (Dashboard) — needs F3's data-layer evaluation (§4)
      │      resolved first, needs backend aggregation routes
      │      (external dependency, §7)
      │
      └──> F5 (AI) — needs F3's Knowledge/Issue detail views to attach
             recommendations to, needs the backend AI milestone to
             exist at all (external dependency, §7)
```

The corrected ordering's key change from an earlier draft: backend
GET/list work is **not** something F3 waits to begin after F2
finishes — it should be scoped and started as its own (backend-side)
issue as soon as F2 begins, so F3 isn't sitting idle waiting on a
backend track that only started once someone noticed F2 was done.

---

## 3. Proposed route/layout/component boundaries

### Route groups

```
src/app/
├── (marketing)/              existing home page, no auth requirement
│   └── page.tsx
├── (auth)/                   Phase F1
│   ├── layout.tsx             centered, minimal chrome — no Navbar product links
│   ├── login/page.tsx
│   └── register/page.tsx
├── explore/                  Phase F2 (report form, as a component
│   │                          mounted inline — not its own route) → F3 (full)
│   ├── page.tsx                map/list (F3); hosts the reusable
│   │                           Issue-report contribution component
│   │                           (built in F2, mounted here from the
│   │                           start — not migrated from a temporary
│   │                           route later)
│   └── [issueId]/page.tsx      Issue detail + Comment thread (F3)
├── learn/                    Phase F2 (draft form only) → F3 (full)
│   ├── page.tsx                Knowledge list (F3)
│   ├── new/page.tsx             draft-authoring form (F2) — this one
│   │                           genuinely needs its own route even at
│   │                           F2, since "start a new draft" is a
│   │                           real, permanent product action, unlike
│   │                           Explore's report flow which is better
│   │                           understood as inline-to-a-map from the
│   │                           start
│   └── [knowledgeId]/page.tsx  Knowledge detail, review actions
│                               (F3 — moved from F2, see §1), Comment
│                               thread (F3)
├── act/                      Phase F2 (form only) → F3 (full)
│   ├── page.tsx                Project list (F3)
│   ├── new/page.tsx             Project-creation form (F2)
│   └── [projectId]/page.tsx    Project detail (F3)
├── community/                 NOT started this plan — Comment is
│                               shared infrastructure mounted into
│                               Explore/Learn per the existing product
│                               decision; a standalone cross-content
│                               Community page is explicitly a later
│                               idea, not part of F1–F5
└── dashboard/                 Phase F4
    └── page.tsx
```

Route-group parentheses (`(marketing)`, `(auth)`) don't affect URLs —
used here only to give the auth flow its own layout (no product nav)
without affecting `/login`'s actual path.

**On avoiding the throwaway route**: `explore/page.tsx` is created
once, in F2, as a minimal page hosting only the Issue-report
component; F3 *enhances* that same file into the full map/list view
rather than replacing a temporary route. This is the concrete
resolution to "don't build a route we already know we're going to
kill" — the route exists exactly once, from F2 onward, and only grows.

### Component ownership

- **`src/components/{explore,learn,act,dashboard}/`** — one directory
  per product surface, mirroring the existing `foundation/`/`layout/`
  split. No cross-surface imports except through `src/components/ui/`
  and a new `src/components/domain/` (see below).
- **`src/components/domain/`** (new) — components that represent a
  domain entity's presentation but aren't specific to one route (e.g.
  `IssueStatusBadge`, `KnowledgeStatusBadge`, `CommentThread`,
  `CommentComposer`). `CommentThread`/`CommentComposer` in particular
  must live here, not inside `explore/` or `learn/`, because the
  backend's own Comment design (shared primitive, `refType`/`refId`)
  is exactly mirrored by this being a shared component mounted in two
  places — component ownership should reflect the domain model it's
  built on, not the route it's first used in.
- **UI primitives added as needed, not preemptively**: `Dialog`
  (already available via the existing Radix dependency, just not yet
  wrapped generically) for confirm-style actions (e.g. "reject this
  Knowledge draft?"); `Select` for status filters once F3's list views
  need them; `Tabs` if Knowledge review UI needs a draft/review split.
  Each addition should be justified by the feature that first needs
  it, per the existing dependency policy — this plan does not
  pre-approve building all of them in F1/F2.

---

## 4. Data-fetching and client/server responsibilities

### F1/F2 (no data layer yet — deliberate)

- Forms are Client Components (form state, validation feedback,
  submit-pending state are all inherently client-side).
- Each form calls `apiRequest<T>()` directly, matching the existing
  `FoundationRefreshButton` pattern — no query library yet, because F1/
  F2 have no list/cache/background-refetch requirement, only
  "submit and show the result."
- **Session state**: some mechanism exposing "is there a logged-in
  actor, and what's their role" needs to exist before F2's role-aware
  UI can work. **This plan deliberately does not prescribe its shape**
  (a `SessionProvider` calling `GET /me` on mount is one plausible
  design, not a decision made here) — that belongs to issue #8. The
  dependency direction is: #1 states *that* F2 needs session state and
  *when* (before F2's role-aware forms), not *how* #8 should build it.

### F3+ (data layer introduced here — as an evaluation, not a pre-decision)

- **F3 should evaluate whether a shared client data-fetching/cache
  layer is justified**, once real GET contracts exist, against
  concrete criteria — not adopt one because "F3 sounds like the kind
  of phase that needs one." TanStack Query is a **candidate**, not a
  locked decision. Adopt it (or something else) only if F3's actual
  requirements include, concretely:
  - multiple components consuming the same resource
  - mutations requiring cache invalidation (e.g. a new Comment
    updating a visible count without a full reload)
  - pagination/infinite queries
  - background refetch
  - optimistic/pending mutation states
  - client-side cross-component synchronization
  If F3's actual surface doesn't need most of these, plain
  `apiRequest<T>()` calls (F1/F2's existing pattern) plus Server
  Component data-fetching may simply be sufficient — that's a
  legitimate outcome of the evaluation, not a failure to adopt a
  library. This framing keeps the decision architectural (made once
  F3's real requirements are known) rather than prescriptive (made now,
  from this planning document, against requirements that don't exist
  yet).
- **Server Components remain the default** for initial page data
  (list pages fetch their first page server-side, exactly like
  `page.tsx`'s current `getSystemSnapshot()` pattern); whatever client-
  side layer F3's evaluation lands on hydrates from that initial data
  for subsequent interaction, not as the sole data source.
- **Client Components stay reserved for genuine interactivity**: map
  (Explore), filter controls, comment composer, any optimistic-update
  surface. Detail-page prose/metadata rendering stays a Server
  Component.

### Backend base URL

A `NEXT_PUBLIC_API_URL` (or equivalent) needs to be introduced in F1 —
currently absent entirely. This is a small, concrete, immediately-
necessary addition (F1 cannot call any real auth endpoint without it),
not a speculative config surface.

---

## 5. Testing strategy for the phase

**This plan treats testing as a cross-cutting foundation (T1) that
should be established before F2 produces much surface area to test,
rather than a property added independently inside each phase.** Issue
#3 is assumed to be where the actual tooling/vocabulary decision is
made — this plan doesn't re-specify it, only states the dependency and
what each phase will need from it:

- **F1**: integration-style tests against the real 5 auth endpoints
  (register/login/logout/me/refresh success + failure paths), mirroring
  the backend's own test discipline — form validation errors, session
  restoration, redirect-when-anonymous behavior.
- **F2**: form submission tests against the real 4 contribution
  endpoints — success, validation failure (schema mismatches
  surfaced as field-level errors), and role-aware UI where relevant.
  Since there's no read endpoint yet, "did the Issue actually get
  created" is verified the same way the backend's own route tests
  verify it — by asserting on the POST response's envelope, not by
  navigating to a detail page that doesn't exist yet. The Comment
  composer specifically is developed and tested in isolation using
  whatever component-testing setup T1 establishes.
- **F3+**: component/interaction tests can use mocked list responses
  shaped exactly like the eventual real `ApiResponse<T>` envelope
  (§8 — mocking is allowed at the contract level, not as a way to
  invent the contract itself) once the backend's actual list-response
  shape is locked.
- **Accessibility**: every new interactive component (forms, Comment
  composer, status badges as `role="status"`, role-aware action
  buttons) gets the same treatment already established in `error.tsx`/
  `loading.tsx` (`role="alert"`/`role="status"`, `sr-only` labels) —
  extending an existing pattern, not inventing a new one.

---

## 6. Accessibility and responsive requirements

Carried forward from the existing, already-established Foundation
conventions (`error.tsx`, `loading.tsx`, `not-found.tsx` — all already
demonstrate these patterns) rather than introduced fresh:

- Every async view has all four states: loading (skeleton, `role=
  "status"`, `sr-only` text), empty (`EmptyState` component — already
  built, unused so far outside Foundation — this phase is its first
  real consumer), error (`role="alert"`, human-readable, a retry
  action where retryable), and populated.
- Forms: label association, inline field-level error text tied via
  `aria-describedby`, a single `role="alert"` region for
  submission-level failures (not one alert per field).
- Role-aware UI (EXPERT-only buttons, now living in F3's Knowledge
  review workspace rather than F2 — see §1): hidden/disabled state
  must still be announced correctly to assistive tech (`aria-disabled`,
  not a silently-vanishing element that leaves surrounding layout
  confusing) — the backend is the real authorization boundary either
  way (per AUTH-L2/ROUTE-L3, a hidden button is a UX nicety, not
  security).
- Responsive: mobile-first, matching the existing `MobileNav` pattern
  (a Radix Dialog drawer under `md:`) — any new list view (F3+) needs
  its own mobile layout decision (card list vs. table), not an
  afterthought scaled down from desktop.
- Motion: only where it communicates state (a submit-pending spinner,
  a success-state transition), per the project's existing "motion
  must communicate state, not decorate" principle — no motion
  requirement is introduced by this plan beyond what F1/F2's own
  pending/success/error states need.

---

## 7. Backend dependencies and assumptions

**External to this plan — not planned here, only identified as
blocking F3's *start*, not F2's:**

1. **GET/list endpoints for Issue, Knowledge, Comment, Project.**
   Should be scoped and started as its own backend-side issue as soon
   as F2 begins (§2's corrected ordering), not queued to start only
   once F2 finishes — otherwise F3 sits idle waiting on a backend track
   that only began once someone noticed F2 was done. No shape,
   pagination convention, or filtering contract currently exists to
   build against.
2. **Issue/Knowledge/Project detail-fetch-by-ID endpoints.** Also
   blocks F3 — needed for `[issueId]`, `[knowledgeId]`, `[projectId]`
   detail routes.
3. **Dashboard aggregation endpoints.** Blocks F4 entirely — this is a
   distinct backend capability from simple listing (V1's own
   aggregation-pipeline dashboard service is the reference point, not
   the template — per the original context-transfer document's own
   instruction not to port its known bug).
4. **The AI milestone existing at all** (currently not started, not
   even architecturally locked). Blocks F5 entirely.
5. **Comment listing/threading read endpoint** — `createComment` exists,
   but there is no way to fetch a thread for a given `(refType, refId)`
   yet. Blocks `CommentThread`'s real (as opposed to write-only) use in
   F3.

**No unresolved backend/domain decision is silently converted into a
frontend assumption in this plan** — specifically: D-3a (remediation-
assertion authority) remains unresolved; Issue status-transition UI
(acknowledge/verify — F3's Issue detail view, not F2; F2 only covers
Issue *creation*, see §1) only ever exposes the transitions the
backend actually authorizes today (`open→acknowledged` for EXPERT,
`resolved→verified`/`resolved→in_progress` for EXPERT) — the two
D-3a-gated transitions (`acknowledged→in_progress`,
`in_progress→resolved`) are **not** exposed as UI actions at all in
this plan, for anyone, since the backend cannot authorize them for any
role today. This is not a UI gap to route around with a client-side
guess at who "should" be allowed — it's the correct reflection of a
genuinely unresolved
backend policy.

---

## 8. Explicit exclusions / deferred work

- **No new dependency is added by this planning document itself.**
  A shared data-fetching layer (TanStack Query as one candidate) is
  *evaluated* against concrete criteria starting at F3 (§4), not
  installed or pre-decided here — its actual introduction, if any, is
  F3's own decision, subject to its own review when F3's real
  requirements are known.
- **No mocked data is built speculatively ahead of a concrete phase
  needing it.** F2's forms talk to the real backend directly; F3's
  eventual mocks (for component tests only, per §5) must be shaped
  from the backend's real, locked list-endpoint contract once it
  exists — not invented now as a stand-in contract, which the issue's
  own constraints explicitly forbid ("Do not invent API contracts that
  have not been agreed upon").
- **Community as a standalone page is not part of F1–F5.** Comment
  stays shared infrastructure mounted into Explore/Learn, per the
  existing, already-recorded product decision that Community is a
  future cross-content surface, not where comments originate.
- **Password reset, email verification, OAuth, MFA** — excluded from
  F1 explicitly (§1), matching Authentication's own locked scope.
- **Any Issue/Knowledge/Project edit or delete UI** — excluded, because
  no such backend operation exists (confirmed in the Routes milestone;
  restated here so it isn't silently assumed into a frontend form).
- **Any UI for the two D-3a-gated Issue transitions** — excluded for
  every role (§7).
- **Offline sync, satellite imagery, IoT sensors, gamification,
  temporal map playback** — not evaluated by this plan; already
  recorded in `docs/future/parking-lot.md` and out of scope for the
  same reason they were originally deferred there.

---

## 9. Suggested follow-up issues (not created by this PR)

Per the issue's own instruction, these are named, not opened. Numbers
reflect the corrected ordering (§1/§2) — items 6–7 (backend GET work)
are meant to start alongside item 3–5 (F2), not after them.

1. `Frontend: T1 — Testing foundation` (tracked as issue #3 — this
   plan assumes, not re-specifies, its scope; listed here only to make
   the dependency explicit)
2. `Frontend: Phase F1 — Auth pages + session state` (tracked as issue
   #8 — same caveat: this plan states the dependency, not the
   implementation)
3. `Frontend: Phase F1 — Route protection pattern for authenticated-only actions`
4. `Frontend: Phase F2 — Issue report component (mounted at explore/page.tsx from the start)`
5. `Frontend: Phase F2 — Knowledge draft-authoring form (create only — submit/approve/reject/revise are F3)`
6. `Frontend: Phase F2 — Comment composer (shared component)`
7. `Frontend: Phase F2 — Project creation form`
8. `Backend: Issue/Knowledge/Comment/Project GET + list endpoints`
   (should start alongside items 4–7, not after — §2/§7; backend-side,
   flagged here as a dependency, not proposed for frontend
   implementation)
9. `Frontend: Phase F3 — Data-fetching layer evaluation` (evaluate
   against §4's criteria once backend GET endpoints exist; may or may
   not result in adopting a library)
10. `Frontend: Phase F3 — Explore (map + list + detail)`
11. `Frontend: Phase F3 — Learn (list + detail + Knowledge review workspace + Comment thread mount)`
12. `Frontend: Phase F3 — Act (list + detail)`
13. `Backend: Dashboard aggregation endpoints` (blocking F4)
14. `Frontend: Phase F4 — Dashboard`

Open question for this plan's own review, not resolved here: whether
issues 8/13 (backend work identified as blocking) belong in this
frontend-focused repository's issue tracker at all, or should be
raised as their own backend-side planning issue first — flagged rather
than assumed either way.
