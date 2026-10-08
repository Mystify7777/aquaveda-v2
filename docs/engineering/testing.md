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
`ALLOWED_ORIGINS` is deliberately not set: `app.js` reads it optionally (empty =
no-Origin requests only), and the two suites that exercise CORS assign it themselves.

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
  the domain services. Only the two User docs (reporter, EXPERT) are written directly, because
  EXPERT has no provisioning path yet (#89/#91); they never sign in.
- **Flows:** home + primary nav (Explore/Learn/Act); Explore -> issue detail; Learn ->
  knowledge detail; Act -> project detail; anonymous gating of `/learn/new` and `/learn/mine`;
  `/protected/*` and `/(protected)/*` return 404; `/auth/login` and `/auth/register` render;
  register -> protected pages render -> sign out -> gated again -> login -> access restored.
- **Out of scope:** Community/Dashboard (deferred routes), moderation, rich-text, visual regression.
- Vitest excludes `e2e/`; Playwright owns `*.spec.ts`.
