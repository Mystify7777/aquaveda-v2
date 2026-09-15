# Testing Strategy

Scoped for a solo build — enough coverage to catch real regressions,
not enough process to become a second job.

## Tools

| Layer | Tool | Current status |
| --- | --- | --- |
| Backend unit/integration | Node.js built-in test runner | Active under `server/tests/` |
| Frontend pure logic | Node.js built-in test runner | Active for `src/**/*.test.js` |
| Component | React Testing Library | Not installed; no component suite yet |
| End-to-end | Playwright | Not installed; deferred until a real user flow exists |

## What gets tested at each level

- **Pure functions in `lib/`** — unit tests. Fast, cheap, catches the most
  regressions per line of test code.
- **Client Components with real interaction logic** — component tests with
  RTL once that dependency is introduced. Current AuthProvider session-state
  classification is kept in a pure JavaScript module and tested directly;
  React rendering and browser interaction are not currently component-tested.
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
npm test                 # frontend session-state tests
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
