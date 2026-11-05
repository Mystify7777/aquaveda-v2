# Anonymous exploration and contribution boundaries

Issue #36 preserves anonymous exploration and makes authentication a
contribution boundary.

## Public behavior

The frontend does not require a session for public navigation or read surfaces
such as approved Knowledge, Issues, Projects, maps, search, and filters. Domain
read routes now exist; each one's public-read policy is set by its own route
contract (decision register, "Locked — Routes" and the RT-142 entries), not by
the presence of the global auth middleware. For Issues:
`GET /api/v1/issues` and `GET /api/v1/issues/:issueId` are anonymous reads,
while `GET /api/v1/issues/:issueId/workflow` requires an actor and returns a
view built for that actor only.

Auth probes: `GET /api/v1/health` and `GET /api/v1/auth/me` (`200` with
`{ user: null }` for an anonymous request).

## Contribution behavior

The state-changing domain operations require an actor:

| Route group | Anonymous request | Authenticated request |
|---|---|---|
| `POST /api/v1/issues` and the Issue lifecycle/remediation actions | `401 UNAUTHORIZED` | `req.actorContext` is passed to the service |
| Knowledge create and lifecycle changes | `401 UNAUTHORIZED` | Existing service authorization applies |
| `POST /api/v1/comments` | `401 UNAUTHORIZED` | Existing comment rules apply |
| `POST /api/v1/projects` | `401 UNAUTHORIZED` | Existing project rules apply |

The concrete state-changing Issue routes are:

- `POST /api/v1/issues`, plus the explicit Issue lifecycle/remediation actions (#142): `POST /api/v1/issues/:issueId/{acknowledge,start,resolve,verify,fail-verification}` and `POST /api/v1/issues/:issueId/remediation/{grant,accept,decline,release,withdraw,revoke}` (`PATCH .../status` was removed in #142)
- `POST /api/v1/knowledge`
- `POST /api/v1/knowledge/:knowledgeId/{submit,approve,reject,revise}`
- `POST /api/v1/comments`
- `POST /api/v1/projects`

Read routes are documented per route contract (see above). No generic edit or
delete route exists in this boundary.

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
to `/auth/login` or `/auth/register`, renders its children for authenticated users, and
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
resolved by ADR-0007 (issue-scoped remediation grants, exposed in #142); no
service emits `AUTHORIZATION_POLICY_UNRESOLVED` any more.

## Validation and limitations

The supported checks are `cd server && npm test`, root `npm test`,
`npm run typecheck`, `npm run lint`, `npx next build --webpack`, and
`git diff --check`. The backend suite requires a running MongoDB test database
configured through `TEST_MONGO_URI`, distinct from production `MONGO_URI`.
Frontend session-state logic has focused pure tests; there is not yet a React
component or browser end-to-end test suite. Domain public-read routes and
frontend contribution forms remain future work.
