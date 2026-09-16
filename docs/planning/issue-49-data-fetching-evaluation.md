# Issue #49 — F3 shared data-fetching layer: architecture evaluation

**Status: evaluation only.** No client data-fetching or cache library is
adopted by this evaluation. The concrete gap implemented alongside it is
the typed API-resource boundary needed to call Issue #48's backend reads.

## Conclusion

None of the six criteria in `frontend-phase-plan.md` §4 are concretely
met by the current frontend surface:

- No multiple components consume the same resource.
- No mutation UI requires cache invalidation.
- Pagination exists in the backend contract, but no client consumes it yet.
- No background refetch or live-dashboard requirement exists.
- No optimistic mutation state is required.
- No client-side cross-component synchronization exists.

TanStack Query and other client data-fetching/cache libraries are
therefore not justified yet. Re-evaluate the same criteria when #50/#51/#52
produce concrete consumers.

## Current state

The existing `src/lib/api/client.ts` already provides the correct boundary:
`apiRequest<T>()` sends `credentials: "include"`, distinguishes network,
HTTP, and malformed-response failures through `ApiError`, and unwraps the
shared `ApiResponse<T>` envelope. The existing `lib/api/system.ts` consumer
establishes the project's plain async-function pattern.

Issue #48 added the backend read endpoints for Issues, approved Knowledge,
Projects, and Comment threads. The frontend previously had no way to build
an absolute URL to the separate Express backend. The frontend and backend
are genuinely cross-site, so a same-origin rewrite/proxy is not introduced.

## Options evaluated

### Native fetch and project-local utilities

Use the existing `apiRequest<T>()` with a small URL builder and one typed
fetcher module per backend resource. This matches the existing
`getSystemSnapshot()` shape, requires no runtime dependency, and can be
called from either Server or Client Components.

### Next.js server-side fetch options

Server Components can use the same native boundary with options such as
`cache: "no-store"`. This is a usage detail of the native approach, not a
separate cache architecture.

### TanStack Query or another client cache

A cache library would solve future synchronization, invalidation,
background-refetch, and optimistic-update requirements, but none are
present in the current codebase. Installing one now would design an
abstraction against imagined consumers.

### Hybrid adoption later

A hybrid Server Component plus client-cache approach remains a valid future
shape if an actual F3 surface produces the criteria above. It is not adopted
preemptively as part of #49.

## Decision

Implement the smallest current foundation:

- `getApiBaseUrl()` and `buildApiUrl()` in `src/lib/api/config.ts`.
- Typed plain async fetchers for Issues, Knowledge, Projects, and Comments.
- Shared pagination and public actor contracts matching Issue #48.
- Focused Vitest coverage for URL construction, `apiRequest()`, resource
  fetchers, envelope unwrapping, query serialization, and error propagation.

Do not introduce TanStack Query, a generic query hook, a global state store,
a same-origin proxy, auth/session state, or #50/#51/#52 page code.

## File boundaries

```text
src/lib/api/
  client.ts       unchanged
  types.ts        unchanged
  config.ts       backend URL construction
  system.ts       unchanged
  issues.ts       Issue list/detail fetchers
  knowledge.ts    approved Knowledge list/detail fetchers
  projects.ts     Project list/detail fetchers
  comments.ts     Comment thread fetcher
  types/
    pagination.ts
    actor.ts
    issue.ts
    knowledge.ts
    project.ts
    comment.ts
```

Resource functions remain plain async functions with no classes, hooks, or
cache policy beyond the explicit `cache: "no-store"` request option. URL
pagination is represented by query parameters, leaving future page routes
free to use App Router search params without a new dependency.

## Testing and validation

Each resource has focused tests that mock `fetch` and verify the absolute
URL, query parameters, successful envelope unwrapping, and relevant
`ApiError` behavior. `client.test.ts` additionally covers network, HTTP,
non-JSON, empty-body, malformed-JSON, credentials, and `instanceof` behavior.

The existing frontend plan already records this decision in §4. This
standalone evaluation documents the derivation and the deliberately small
implementation that accompanies it.
