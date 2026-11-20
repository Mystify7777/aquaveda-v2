# Frontend Contributor Guide

This is the short path through AquaVeda v2's frontend decisions. It is a navigation document, not a second architecture specification.

## Before taking a frontend issue

Read these in order:

1. **[Product vision](../vision/vision.md)** — what the product is trying to do.
2. **[Product invariants](../vision/product-invariants.md)** — rules that are not negotiable just because a frontend implementation would be easier.
3. **[Decision register](../architecture/decision-register.md)** — the canonical record of locked, deferred, and implementation decisions.
4. **[Next.js patterns](../architecture/nextjs-patterns.md)** — Server/Client boundaries, data fetching, API-client usage, and route topology.
5. **[Engineering standards](./standards.md)** — coding conventions and Definition of Done.
6. **[Testing strategy](./testing.md)** — what to test and which command owns each verification layer.

Then read the GitHub issue itself and inspect the existing route, component, API client, and tests before changing anything.

## Frontend contribution workflow

Use the smallest change that closes the issue:

1. Start from main and create a focused branch.
2. Read the issue acceptance criteria and identify the existing contract it depends on.
3. Reuse existing primitives, API clients, and domain types before creating new abstractions.
4. Keep unrelated cleanup out of the PR.
5. Add or update tests for behavior that can regress.
6. Run the focused tests while iterating, then the repository verification required by the issue.
7. Review the diff for scope, accessibility, responsive behavior, and accidental contract changes.
8. Open a PR that explains the behavior changed, verification performed, and any deliberate non-goals.

Separate PRs are preferred when changes have different failure domains, rollback characteristics, or review concerns.

## Server Component / Client Component boundary

Server Components are the default.

Use a Client Component only when the code actually needs browser APIs, React state, or event handlers. Push the boundary to the smallest useful leaf.

For data-heavy screens:

- Server Components call the shared API/lib functions directly.
- Client Components use the shared API client for browser-side refetches or interactions.
- Do not fetch the application's own API route from a Server Component just to create an unnecessary HTTP hop.
- Do not move an entire page to the client merely because one control is interactive.

The detailed rules and existing exceptions live in [Next.js Architecture Patterns](../architecture/nextjs-patterns.md).

## Tests and verification

Use the layer that matches the behavior:

- Pure frontend logic: unit tests.
- Interactive Client Components: Vitest + React Testing Library.
- Full browser flows: Playwright where an established e2e flow exists.
- Type safety: npm run typecheck.
- Static quality: npm run lint.
- Production build: npx next build --webpack.
- Repository-wide verification: npm run verify.

Do not add tests that merely duplicate framework behavior. Test AquaVeda contracts, user-visible behavior, and failure paths.

The route/link contract in docs/engineering/testing.md should be used when adding or changing internal links.

## When the issue exposes an unresolved domain/backend question

Do **not** invent a frontend answer.

If the issue depends on an unresolved authorization rule, lifecycle decision, API shape, ownership model, or other backend/domain policy:

1. Identify the exact unresolved decision.
2. Check the decision register and relevant ADR/domain document.
3. If the decision is still deferred, stop short of encoding a new policy in the frontend.
4. Raise the question in the issue or create the appropriate architecture/backend follow-up.
5. Once the contract is settled, implement the frontend against that contract.

Frontend authorization is UX guidance only. Backend authorization remains authoritative.

## Documentation ownership

Keep one source of truth:

- Product rules → docs/vision/
- Domain decisions → docs/domain/ and the canonical docs/architecture/decision-register.md
- Architecture decisions → docs/adr/ and architecture documents
- Engineering conventions → docs/engineering/
- Current implementation progress → CLAUDE.md
- Issue-specific acceptance criteria → GitHub issues

Do not copy an ADR or decision register section into this guide. Link to it.

## What not to do

- Do not change a locked product/domain decision inside a frontend PR.
- Do not add speculative backend behavior to make a UI easier to implement.
- Do not introduce a generic abstraction for one concrete use case.
- Do not add dependencies for hypothetical future work.
- Do not turn a focused issue into a repository-wide refactor.
- Do not describe deferred behavior as implemented behavior.

The goal is simple: a contributor should be able to find the rule that matters without needing the original author to explain the repository from memory.