# Anonymous exploration and contribution boundaries

Issue #36 preserves anonymous exploration and makes authentication a
contribution boundary.

## Public behavior

The frontend does not require a session for public navigation or future read
surfaces such as approved Knowledge, Issues, Projects, maps, search, filters,
or public discussions. The current backend branch has no domain GET/listing
routes yet, so this issue does not invent them.

The currently available public HTTP probes are `GET /api/v1/health` and
`GET /api/v1/auth/me`. The latter returns `200` with `{ user: null }` for an
anonymous request. Public visibility and authorization are separate concerns:
when future read routes exist, their public-read policy must be decided by
their route contract rather than by the presence of the global auth middleware.

## Contribution behavior

The currently implemented domain routes are state-changing operations:

| Route group | Anonymous request | Authenticated request |
|---|---|---|
| `POST /api/v1/issues` and issue status changes | `401 UNAUTHORIZED` | `req.actorContext` is passed to the service |
| Knowledge create and lifecycle changes | `401 UNAUTHORIZED` | Existing service authorization applies |
| `POST /api/v1/comments` | `401 UNAUTHORIZED` | Existing comment rules apply |
| `POST /api/v1/projects` | `401 UNAUTHORIZED` | Existing project rules apply |

The concrete routes are:

- `POST /api/v1/issues` and `PATCH /api/v1/issues/:issueId/status`
- `POST /api/v1/knowledge`
- `POST /api/v1/knowledge/:knowledgeId/{submit,approve,reject,revise}`
- `POST /api/v1/comments`
- `POST /api/v1/projects`

These are the currently implemented contribution operations. No domain
listing, detail, edit, or delete route is included in this boundary.

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

## Browser and failure contract

The browser talks to the Express API through `NEXT_PUBLIC_API_URL`, which is
`http://localhost:5000` for local development. Requests use credentialed
HttpOnly cookies. Access and refresh tokens are never stored in
`localStorage`/`sessionStorage`, and no bearer-token header is created by the
frontend.

`GET /api/v1/auth/me` returning an expected unauthenticated response, followed
by an expected refresh rejection, confirms `anonymous`. An unexpected API
response produces `session-failure`; a fetch/network failure produces
`unavailable`. Neither failure state is converted to anonymous. Login,
registration, logout, and refresh use the existing auth routes and canonical
`{ success, data, message }` response envelope.

Existing service authorization remains operation-specific: `requireActor()`
enforces authentication, `requireRole()` handles existing single-role gates,
and the Knowledge author checks and self-review protections remain local to
their operations. No generic ownership rule is introduced. D-3a remains
unresolved; the two Issue transitions guarded by
`AUTHORIZATION_POLICY_UNRESOLVED` are not changed by this boundary.

## Validation and limitations

The supported checks are `cd server && npm test`, root `npm test`,
`npm run typecheck`, `npm run lint`, `npx next build --webpack`, and
`git diff --check`. The backend suite requires a running MongoDB test database
configured through `TEST_MONGO_URI`, distinct from production `MONGO_URI`.
Frontend session-state logic has focused pure tests; there is not yet a React
component or browser end-to-end test suite. Domain public-read routes and
frontend contribution forms remain future work.