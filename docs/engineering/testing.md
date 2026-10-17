# Testing Strategy

Scoped for a solo build — enough coverage to catch real regressions,
not enough process to become a second job.

## Tools

| Layer | Tool | Current status |
| --- | --- | --- |
| Backend unit/integration | Node.js built-in test runner | Active under `server/tests/` |
| Frontend pure logic | Node.js built-in test runner | Active for `src/**/*.test.js` (`npm run test:node`) |
| Frontend unit/component | Vitest + React Testing Library (jsdom) | Active for `src/**/*.test.{ts,tsx}` (`npm run test:vitest`) |
| End-to-end | Playwright | Not installed; deferred until a real user flow exists |

## What gets tested at each level

- **Pure functions in `lib/`** — unit tests. Fast, cheap, catches the most
  regressions per line of test code.
- **Client Components with real interaction logic** — Vitest + RTL component
  tests (rendering, interaction, accessibility attributes). Pure session-state
  classification stays in `src/lib/auth-state.js`, tested with `node:test`.
- **Full user flows** — Playwright e2e. The only layer that validates
  Server + Client together across the real network boundary.
- **UI primitives** (`button`, `card`, etc.) — not tested directly.
  They're thin enough that testing them tests React, not AquaVeda.
  Covered indirectly by every e2e spec that renders a page using them.

## What "Tested" means for Definition of Done

Non-trivial pure logic → unit test.
Primary user flow of a feature → at least one e2e spec.
100% line coverage is not a target — it produces tests that assert
implementation details rather than behavior.

## Supported commands

From the repository root:

```text
npm test                 # Vitest (components/units) + node:test
npm run typecheck
npm run lint
npx next build --webpack # Windows-compatible production build command here
git diff --check
```

For the backend:

```text
cd server
npm test
npm run verify:models
npm run verify:validation
npm run verify:cookie-config
```

## Route/link contract (Issue #81)

Prevents `component href -> no App Router page -> runtime 404` (the #80 bug).
Helper: `src/test-utils/app-routes.ts` (test-only). Shared by
`src/app/auth/auth-routes.test.tsx`,
`src/components/layout/navigation-links.test.tsx` (nav + Learn entry points) and
`src/components/product-links.test.tsx` (Explore/Learn/Act cards, map popup,
report/create forms, workflow lists/article, not-found pages); its own rules are tested in
`src/test-utils/app-routes.test.ts` against a temp fixture tree.

**API**

- `resolveAppRoute(href)` -> `"static" | "dynamic" | "catch-all" | "missing"`
- `internalHrefs(container)` -> in-app hrefs found in a rendered tree
- `findBrokenLinks(hrefs, deferred?)` -> problem strings; assert `toEqual([])`

**Verifies:** a link whose path maps to a `page.*` under `src/app`. Handles
static segments, `[param]` (matches any value, never claims the concrete path
exists on disk), `(group)` folders (not URL segments), query/fragment
stripping. Catch-all pages resolve as `catch-all` and count as implemented
(the route shape is served; segment values and data are not checked).

**Does not verify:** middleware/proxy, rewrites, redirects, route handlers,
parallel/intercepting routes, param validity or data existence, auth gating,
or hrefs built at runtime that never render in a test. External, `#frag`,
`?query` and relative hrefs are never resolved. It is an approximation of
Next.js routing on purpose; the real router is covered by e2e (#85).

**Deferred links:** links to not-yet-built routes (currently `/community`,
`/dashboard` in the nav) must be listed in the test's `deferred` array. The
check fails if a deferred route gains a page, so the list cannot go stale.

**Adding coverage:** render the component, then
`expect(findBrokenLinks(internalHrefs(container))).toEqual([])`. Do not add
placeholder pages to satisfy it.

**Related:** #80 (canonical `/auth/*` URLs, uses this helper), #83 (protected
route topology: authenticated pages live in the `(protected)` route group,
which is implementation-only and never a URL segment; `/protected/*` is not
a canonical URL and the contract reports it as missing), #85 (browser e2e, out of scope here).

## Local verification (`npm run verify`, #101)

`npm run verify` runs the **backend** and **frontend** pipelines concurrently via
`scripts/verify.mjs` (a dependency-free Node runner, `scripts/verify/run-pipelines.mjs`).
Each pipeline is the unchanged package-level command, so coverage is identical to the
serial run. Focused commands are unchanged: `verify:backend`, `verify:frontend`, and
`verify:sequential` (the former serial `backend && frontend`, kept for debugging and as the
timing baseline).

```text
npm run verify
├─ [backend]  npm run verify:backend  (cwd server/)        needs MongoDB (TEST_MONGO_URI)
│    npm test (node --test, --test-concurrency=1)
│      → verify:models → verify:validation → verify:cookie-config      (serial, in order)
└─ [frontend] npm run verify:frontend
     vitest → test:node → lint → typecheck → build                     (serial, in order)
```

**Why only the two pipelines run in parallel.** Independence was checked, not assumed:

| Resource | Backend | Frontend | Conflict? |
|---|---|---|---|
| MongoDB (`TEST_MONGO_URI`) | yes, serialised inside the package | none (no Mongo imports under `src/`) | no |
| TCP ports | backend tests bind port `0` (ephemeral) | no server; `next build` binds none | no |
| Temp files | none shared | `app-routes.test.ts` uses `mkdtemp` (unique) | no |
| Build output (`.next/`, `tsconfig.tsbuildinfo`) | not touched | written by `build`; read by `typecheck` | **intra-frontend only** |

Within a pipeline, steps stay serial on purpose. `typecheck` must not overlap `build`:
`tsconfig.json` includes `.next/types/**` and `incremental` writes `tsbuildinfo`, both of
which `next build` also writes. `vitest`, `test:node` and `lint` are read-only and could be
parallelised later, but that was out of scope for #101 and is a candidate follow-up only if
timings justify it. Backend steps are serial because `npm test` owns the test database and
the three `verify:*` scripts are sub-second.

**Behaviour.**
- Output is prefixed per line with `[backend]` / `[frontend]`.
- Both pipelines always run to completion (no fail-fast), so one run reports every
  failing pipeline; a summary with per-pipeline status and duration is printed at the end.
- The root exit code is non-zero if either pipeline fails, is killed, or cannot start.
- `Ctrl+C` / `SIGTERM` signals each pipeline's whole process tree (process group on POSIX,
  `taskkill /T /F` on Windows), then does not report completion until every group is empty.
  The group id is retained after the pipeline's own process exits, so a descendant that
  ignores `SIGTERM` (or outlives its parent) is still `SIGKILL`ed once the 5s grace period
  ends. The runner exits `130` (`143` for `SIGTERM`); invoked through `npm run` on Windows the shell
  instead reports npm's own Ctrl+C status, `-1073741510` (`0xC000013A`, `STATUS_CONTROL_C_EXIT`).
  Either way the status is non-zero, and verified on Windows: the interrupted summary prints and no
  `node.exe` survives. Limits: a hard `SIGKILL` of the runner itself
  cannot be intercepted, and on Windows a descendant orphaned after its parent already exited
  cannot be located by `taskkill /T`.
- Because pipelines now share CPU, per-step interleaved output is expected.
- Runner behaviour (prefixing, failure propagation, concurrency, tree termination) is covered
  by `scripts/verify/run-pipelines.test.js`, executed by `npm run test:node`.

**Timings.** Measured on the maintainer's Windows machine (11 Next.js build workers, MongoDB
local), Oct 2026:

| Command | Wall time | Notes |
|---|---|---|
| `npm run verify:sequential` | 93.2s | one run (`Measure-Command`) |
| `npm run verify` | 63.1s, 67.2s | two passing runs; backend 63.1s / 67.2s, frontend 56.6s / 56.4s |

That is roughly a 28-32% reduction in wall time (about 26-30s), with identical coverage. Wall time
tracks the slower pipeline (backend), as expected. Caveats: the sequential figure is a single
run with no per-pipeline breakdown, and when run concurrently the backend is slower than it is
alone because the pipelines share CPU and disk, so the gain is less than `frontend`'s full
duration. Two earlier `verify` runs were discarded: they showed 22-32 intermittent backend
failures consistent with another process using the same `TEST_MONGO_URI` database
(`clearCollections()` wipes it), and passed once no stray processes remained. Never run two
backend test processes against one test database.

Per-step durations from a 1-vCPU sandbox, for relative sizing only: `verify:models` 0.5s,
`verify:validation` 0.2s, `verify:cookie-config` 0.1s, `test:node` 0.2s, `lint` 16.8s,
`typecheck` 4.9s, `test:vitest` 124.8s.

## CI (#84)

`.github/workflows/ci.yml` runs on pull requests to `main` and on pushes to `main`.
It only invokes existing scripts; the `frontend` and `backend` jobs cover the frontend/backend verification commands invoked by root `npm run verify`, and `e2e` adds browser coverage.

| Job | Runs | Needs |
|---|---|---|
| `frontend` | `npm ci` → `npm run verify:frontend` (vitest, `test:node`, lint, typecheck, build) | network for `next/font/google` at build |
| `backend` | `npm ci --prefix server` → `npm --prefix server run verify` (service/route tests, `verify:models`, `verify:validation`, `verify:cookie-config`) | MongoDB 7 service container |
| `e2e` | root + `server/` `npm ci`, `playwright install --with-deps chromium`, `npm run test:e2e` | MongoDB 7 service container; network for fonts |

Backend tests use a real MongoDB (`TEST_MONGO_URI`, see `server/README.md`); they are
never skipped or mocked in CI. Job env supplies only what the server requires and the
tests do not set themselves: `TEST_MONGO_URI` and throwaway `JWT_ACCESS_SECRET` /
`JWT_REFRESH_SECRET` (read via `getRequiredEnv`; test-only, not real credentials).
`ALLOWED_ORIGINS` is deliberately not set: the app's state-changing CSRF
guard treats an empty allowlist as fail-closed and rejects mutations. The
two suites that exercise CORS/CSRF assign a deterministic allowlist
themselves.

**Why `mongo:7`:** the repo states no MongoDB server version. The only constraint is the
driver (Mongoose 8.x / `mongodb` 6.x), which supports 7.x, and the features the code
relies on (2dsphere, `$near`/`$geoWithin`, conditional `update`/`findOneAndDelete`) are
long-stable and not 8.0-specific. `7` is a supported major line pinned so CI does not
drift; it is not derived from a deployment target. If production (e.g. Atlas) runs a
different major, align the image tag to it.

Node is pinned to major 22 in the workflow (`NODE_VERSION`), matching local development;
the repo declares no root `engines` field (`server` requires `>=20.11.0`).

## Browser smoke suite (#85)

Playwright (`@playwright/test`, Chromium only), `e2e/*.spec.ts`. Run locally with MongoDB
available (`E2E_MONGO_URI`, default `mongodb://127.0.0.1:27017/aquaveda_v2_e2e`) and Chromium
installed (`npx playwright install chromium`): `npm run test:e2e` (Playwright builds and serves the app itself).

- **Processes:** `playwright.config.ts` starts the Express backend and `next start`
  (production build; `NEXT_PUBLIC_API_URL` is set for the build too, since Next inlines it at build time), blocking on `/api/v1/health` and the web origin. No mocks; real auth and DB.
- **Data:** `globalSetup` runs `server/scripts/seed-e2e.js`, which wipes every collection and
  therefore refuses to run unless `MONGO_URI` is a loopback host (`127.0.0.1`, `localhost`, `::1`)
  AND a database ending in `_e2e`, checked before connecting (`server/scripts/e2e-seed-guard.js`,
  tested in `server/tests/e2e-seed-guard.test.js`; no bypass). It builds one Issue, approved Knowledge article and Project via
  the domain services, plus one Knowledge article left in `pending_review` (`pendingKnowledgeTitle`)
  for the governance flow. Direct User writes: the reporter and a fixture EXPERT (they never sign in; used
  only to satisfy EXPERT-only fixture transitions), and a fixture ADMIN (`adminEmail` / `adminPassword`
  in `e2e/fixtures.json`) with a real `hashPassword` hash that signs in through the browser. The ADMIN
  credentials are throwaway test values that only exist behind the `_e2e` loopback guard; they are not a
  provisioning mechanism (see the production bootstrap runbook for that).
- **Flows:** home + primary nav (Explore/Learn/Act); Explore -> issue detail; Learn ->
  knowledge detail; Act -> project detail; anonymous gating of `/learn/new` and `/learn/mine`;
  `/protected/*` and `/(protected)/*` return 404; `/auth/login` and `/auth/register` render;
  register -> protected pages render -> sign out -> gated again -> login -> access restored.
- **Governance lifecycle (#105, `governance-lifecycle.spec.ts`):** two isolated browser contexts
  (USER, ADMIN), one test, `retries: 0` because the flow consumes seeded state (a retry would fail for
  the wrong reason; `globalSetup` reseeds per run). Steps: USER registers and submits an Expert
  application (pending, persists across reload) -> USER gets 403 on the ADMIN list
  (`GET /expert-application`) but 200 on own status (`/me`) -> ADMIN signs in and approves via the UI ->
  persisted state: applicant `/me` is `approved` and the application is absent from the ADMIN pending
  list -> ADMIN gets 403 on `GET /knowledge/review-queue` and the review page shows the denial
  (ADMIN != EXPERT) -> applicant's session now resolves `EXPERT` (role is read from the DB per request)
  -> EXPERT approves the pending article -> it appears as a link on public `/learn`.
- **Out of scope:** Community/Dashboard (deferred routes), rich-text, visual regression. Knowledge
  moderation is covered only through the governance flow above; reject paths and re-application are not.
- Vitest excludes `e2e/`; Playwright owns `*.spec.ts`.
