# Next.js Architecture Patterns

## Server/Client boundary

Default: Server Component. Add `"use client"` only where code actually
needs browser APIs, React state, or event handlers. Then push that boundary
as deep in the tree as possible, not at the page level.

**Reference pattern — the Foundation Slice status card:**

- `page.tsx` (Server Component): calls `getSystemSnapshot()` directly —
  no fetch, no useEffect, no loading state. Runs on the server.
- `FoundationStatusCard` (Client Component): owns the interactive refresh,
  seeded with the server-rendered initial snapshot. It is a Client
  Component because every value it renders is the state that a refresh
  replaces; there is no static shell to leave on the server.
- `FoundationRefreshButton` (Client Component): the single interactive
  element, isolating the fetch / pending / error logic from the card.

Every later data-heavy screen follows the same split.

## Data fetching

- **Server Components:** call shared lib functions directly. Never fetch
  the app's own API route over HTTP — that's an unnecessary network hop
  for data already available in process.
- **Client Components:** plain `fetch` + `useTransition` for one-shot
  refetches with no caching need (the refresh button). TanStack Query
  once a screen needs real client-side cache/refetch/optimistic updates
  — not before.
- **Mutations:** Server Actions for form-driven mutations. Route Handlers
  for REST-shaped consumers (the typed API client talking to Express,
  the refresh button, any future external consumer).

## Folder conventions

```
src/
  app/              routes only — layout, page, loading, error, not-found,
                    and api/** route handlers
  components/
    ui/             stateless shadcn-style primitives, no domain knowledge
    layout/         app shell: navbar, footer, theme toggle, mobile nav
    providers/      "use client" context providers
    foundation/     Foundation Slice components (replaced by feature
                    modules as they ship: explore/, wiki/, etc.)
  lib/              framework-agnostic utilities called by Server Components
```

## API client (Authentication milestone)

A typed fetch wrapper lives in `lib/api-client.ts`. Every request to the
Express backend goes through it — never a raw `fetch` with a string URL
scattered across components. It handles:

- Base URL from environment variable
- Authorization header injection
- Response envelope unwrapping (`{ success, data, message }`)
- JSON request bodies: stringified bodies receive `Content-Type: application/json` unless the caller explicitly supplies a content type
- Error normalization using the `code` field on error responses

### Request lifetime: timeout and cancellation (#128)

Every `apiRequest` is time-bounded and cancellable; the underlying request is genuinely aborted, never just abandoned.

- **Default limit:** `DEFAULT_API_TIMEOUT_MS` = 15 s, covering connection, headers **and reading the body**. Override per call with `timeoutMs`, which must be a finite number from `MIN_API_TIMEOUT_MS` (1 ms) to `MAX_API_TIMEOUT_MS` (2^31 - 1 ms, the largest delay a timer can represent); anything else (0, negative, NaN, Infinity, a non-number, sub-millisecond, too large) rejects with a `TypeError` before anything is sent and is never coerced. There are no automatic retries.
- **Caller cancellation:** pass a standard `signal`. One internal `AbortController` is composed from the time limit and the caller's signal (a listener, not `AbortSignal.any`/`timeout`, so it works in every supported browser and under fake timers).
- **What callers receive** (all `ApiError`):

  | Outcome | `kind` | extra | Guard |
  |---|---|---|---|
  | Time limit exceeded | `network` | `reason: "timeout"` | `isApiTimeout(e)` |
  | Caller aborted | `aborted` | | `isApiAbort(e)` |
  | Other transport failure | `network` | | (existing) |
  | API answered with failure / unusable body | `http` / `response` | | (existing) |

  A timeout is `network`-kind on purpose: every existing "service unreachable" presentation applies unchanged, and `reason` makes it distinguishable. A cancellation is **not a failure**: whoever aborts on purpose ignores it. A non-abort failure while reading the body still propagates unchanged.
- **`useApiResource`:** the fetcher receives an `AbortSignal` (`useApiResource((signal) => getX({ signal }), key)`). It is aborted on unmount, key change and reload, and an aborted request never becomes a visible error. Forwarding the signal is what makes the request really cancel; the stale-result guard stays as a second line of defense for fetchers that don't.
- API functions used by the hook accept a trailing `{ signal }`.

## Client boundary audit (Issue #6)

Audited against `main` at the time of Issue #6: 29 of 110 `src/` modules
carry a real `"use client"` directive (the only route file is the
framework-required `app/error.tsx`); every other page, layout, `Navbar`,
`Footer`, list/detail view and presentational component is a Server
Component. **No unnecessary Client Component boundary was found**, so no
code was changed. Each boundary is one of:

- **Hooks, context or events** — forms, dialogs, `AuthProvider`,
  `RequireAuth`, `AuthControls`, `ThemeToggle`, `MobileNav` (pathname +
  open state), `WorkflowArticle` / lists (client-fetched, session
  cookie), comment composers.
- **Browser APIs / client-only libraries** — `IssueReportForm`
  (`navigator.geolocation`), `IssueMap` (Leaflet), and `IssueMapLoader`
  (`next/dynamic` with `ssr: false` is only permitted in a Client
  Component).
- **Framework requirement** — `error.tsx`.
- **Documented decision** — `providers/` are the `"use client"` context
  boundary (`ThemeProvider` wraps `next-themes`; the library also ships
  its own directive, so the wrapper is removable in principle but is the
  documented, isolated boundary and is kept).

Interactive code is already pushed to the leaves: the `Navbar` is a Server
Component with `MobileNav` / `AuthControls` / `ThemeToggle` islands; the
protected layout passes server-rendered pages as `children` through
`RequireAuth` (they stay server-rendered); `CommentThread` renders on the
server and only mounts `ReplyToggle`.

Left as-is deliberately (changing them would only move or reshape a
boundary, not shrink the client surface, or would change a component API):

- `AuthSubmitButton`, `use-api-resource.ts`: carry a directive but are
  imported only by Client Components, so they create no boundary and ship
  no extra client JS; the directive is harmless.
- `MyKnowledgeList` filter links and `MobileNav`'s static drawer header are
  server-renderable markup inside a client component; extracting them saves
  negligible JS and means changing the component APIs.
- `ui/avatar.tsx` has no importers; if it is used later its directive is
  needed (Radix Avatar + `forwardRef`/`displayName` on client references).

Concern noted, out of scope for Issue #6: `IssueMapLoader` receives whole
`Issue[]` documents as props from Server Components, so they are serialized
into the RSC payload a second time. Passing only the already-derived
`{ id, title, position }` list (what `toMappableIssues` produces) would
shrink that payload; it is a props-shape change, not a boundary change.

## Route topology: `(protected)` is a route group (#83)

Authenticated workflow pages live in `src/app/(protected)/` and are gated by
`(protected)/layout.tsx` (`RequireAuth`). The group name is implementation-only:
it never appears in a URL. Canonical URLs: `/learn/new`, `/learn/mine`,
`/learn/review`, `/learn/review/[id]`, `/act/new`. `/protected/*` is not a route
(no redirects, no compatibility tree). Public Explore/Learn/Act surfaces stay
outside the group and anonymous. New authenticated pages go in the group; the
route/link contract (`src/test-utils/app-routes.ts`) treats groups as transparent.
