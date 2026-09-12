# Anonymous exploration and contribution boundaries

Issue #36 preserves anonymous exploration and makes authentication a
contribution boundary.

## Public behavior

The frontend does not require a session for public navigation or future read
surfaces such as approved Knowledge, Issues, Projects, maps, search, filters,
or public discussions. The current backend branch has no domain GET/listing
routes yet, so this issue does not invent them.

## Contribution behavior

The currently implemented domain routes are state-changing operations:

| Route group | Anonymous request | Authenticated request |
|---|---|---|
| `POST /api/v1/issues` and issue status changes | `401 UNAUTHORIZED` | `req.actorContext` is passed to the service |
| Knowledge create and lifecycle changes | `401 UNAUTHORIZED` | Existing service authorization applies |
| `POST /api/v1/comments` | `401 UNAUTHORIZED` | Existing comment rules apply |
| `POST /api/v1/projects` | `401 UNAUTHORIZED` | Existing project rules apply |

The global auth middleware is advisory: it resolves the HttpOnly access cookie
to `actorContext = { id, role }`, or `null` for an anonymous request. Each
service remains responsible for enforcing `requireActor()` and its existing
operation-specific authorization. No frontend check replaces that backend
boundary.

## Frontend session states

`AuthProvider` distinguishes `initializing`, `authenticated`, `anonymous`,
`session-failure`, and `unavailable`. An expected unauthenticated `/me` plus
failed refresh resolves to confirmed `anonymous`; a network error or an
unexpected backend response remains an explicit failure state.

`RequireAuth` is a contribution-entry UX primitive. It links anonymous users
to `/login` or `/register`, renders its children for authenticated users, and
does not protect public routes or navigation. Broad authenticated route/layout
protection remains outside this issue.