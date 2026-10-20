# AquaVeda Server

The Express API service for AquaVeda v2. Lives alongside the Next.js web
app in the same repository (`apps/web` + `apps/server` in a future workspace
layout; flat `web/` + `server/` siblings today).

See `docs/adr/ADR-0002-backend-architecture.md` for why the backend is a
separate Express service rather than Next.js Route Handlers.

## Status

The v2 Express service includes the domain models, service layer,
authentication, authorization primitives, HTTP routes, and request
validation needed by the current milestones.

The v1 Express service (`AquaVeda2-main/server/`, now archived as a legacy
reference) is the starting point for the business logic. It is not copied
here — it is rebuilt milestone by milestone, using the v1 service as a
specification, not as code to port.

## What arrives at each milestone

### Domain Model milestone

- `src/config/db.js` — Mongoose connection singleton with graceful shutdown
- `src/models/` — User, Issue, Knowledge, Comment, Project schemas
  - Corrects v1 bugs: `password select:false` always present, consistent
    Zod validation on all routes (not just Issues/Comments), auth middleware
    does a DB lookup instead of trusting the JWT payload directly
- `src/app.js` — Express app with Helmet, rate limiting, CORS for the
  Next.js dev and production origins

### Authentication and boundary implementation

- `src/services/auth.service.js` — register, login, logout, refresh
- `src/middleware/auth.js` — advisory cookie-to-`actorContext` resolution
- `src/routes/auth.routes.js` — register, login, logout, me, refresh
- `src/models/Session.js` — dedicated refresh-session persistence
- JWT via `jsonwebtoken`, with HttpOnly access and refresh cookies
- Zod validation on register/login request bodies
- `requireActor()` and existing operation-specific service authorization remain the backend contribution boundary

The current domain HTTP surface contains nine state-changing routes and no
Issue, Knowledge, Comment, or Project GET/list routes yet. Public domain
exploration data therefore remains a future read-surface milestone.

### Explore milestone

- `src/modules/issues/` — full CRUD, geo queries, status lifecycle
- `src/modules/ai/` — rule-based recommendation engine

### Learn milestone

- `src/modules/wiki/` — moderation lifecycle

### Act milestone

- `src/modules/projects/`

### Community milestone

- `src/modules/comments/` — Issue + Knowledge ref types

### Dashboard milestone

- `src/modules/dashboard/`

## Environment variables

The server runtime environment configuration is defined in `server/.env` (git-ignored; see `server/.env.example` for the full reference template).

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_dev
TEST_MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_test   # optional: real MongoDB for `npm test`; if unset, in-memory MongoDB auto-starts
ALLOWED_ORIGINS=http://localhost:3000                        # exact origins trusted for CORS and state-changing requests
JWT_ACCESS_SECRET=    # required; generate: openssl rand -base64 32
JWT_REFRESH_SECRET=   # required; distinct from JWT_ACCESS_SECRET; generate: openssl rand -base64 32
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
COOKIE_SAME_SITE=none  # locked: frontend/backend are different registrable
                        # domains (genuine cross-site). "none" is mandatory —
                        # "lax"/"strict" would silently drop auth cookies on
                        # cross-site requests. Forces Secure regardless of
                        # NODE_ENV (browser requirement for SameSite=None).
COOKIE_DOMAIN=          # leave unset. No cross-registrable-domain use case
                        # exists for the Domain attribute in this topology.
```

`ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist. For
state-changing requests (`POST`, `PUT`, `PATCH`, and `DELETE`), the CSRF
provenance guard requires an allowed `Origin` or a `Referer` whose parsed
origin is allowed. Requests with neither header are rejected; they are not
treated as trusted server-to-server traffic. If `ALLOWED_ORIGINS` is empty,
no browser provenance is trusted and every state-changing request is rejected
until an explicit allowlist is configured. This fail-closed behavior does
not disable CSRF protection.

### Configuration hygiene & startup validation

Environment variables are loaded and validated by `src/config/env.js`.
`server.js` calls `validateStartupConfig()` at boot time, failing fast with
descriptive errors before opening database connections or listening on ports:

- **Missing configuration fails clearly:** `MONGO_URI`, `JWT_ACCESS_SECRET`,
  and `JWT_REFRESH_SECRET` are required. Missing variables throw a startup
  error naming the exact missing variable.
- **Cryptographic key separation:** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
  must never be identical strings. Reusing the same secret for both tokens is
  blocked at startup and point-of-use to prevent token confusion attacks.
- **Production security constraints (`NODE_ENV=production`):**
  - Secrets must be at least 32 characters in length (256-bit entropy).
  - Secrets must not contain predictable placeholder patterns (e.g. `test-`, `secret`, `changeme`).
  - `ALLOWED_ORIGINS` must be explicitly configured and must never contain the wildcard `*`.
- **Token lifetimes:** `JWT_ACCESS_EXPIRES` and `JWT_REFRESH_EXPIRES` must be
  valid durations (e.g. `15m`, `7d`), and the access token lifetime must be
  strictly shorter than the refresh token lifetime (`JWT_ACCESS_EXPIRES < JWT_REFRESH_EXPIRES`).
- **Database separation guards:** `connectDB()` defaults to `MONGO_URI`. The test
  helper explicitly passes `{ envVar: "TEST_MONGO_URI" }` and validates separation
  via `assertTestDatabaseSeparation()` — refusing to run tests if `TEST_MONGO_URI`
  matches `MONGO_URI` (including normalized loopback host/port/query variants) or
  targets a database ending in `_dev`. If `TEST_MONGO_URI` is omitted, tests
  transparently start an isolated in-process `mongodb-memory-server`.

### Local ADMIN provisioning (development only)

There is no other way to obtain an `ADMIN` (registration always creates a
`USER`; `EXPERT` comes only from an ADMIN-approved Expert application).
To exercise governance locally:

```bash
# server/.env (git-ignored) — never commit these values
ALLOW_DEV_ADMIN_PROVISIONING=true
MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_dev   # must be loopback AND end in _dev
ADMIN_BOOTSTRAP_EMAIL=admin@example.test
ADMIN_BOOTSTRAP_PASSWORD=<choose a local password, min 8 chars>
ADMIN_BOOTSTRAP_NAME=Local Admin                      # optional

npm run provision:admin
```

- **One database variable:** `MONGO_URI` is the only database setting this tool reads. The exact string it validates is the exact string it connects to (there is no second, separately configured URI).
- **Safety (fails closed, checked before any DB connection):** refuses if
  `NODE_ENV=production`, if `ALLOW_DEV_ADMIN_PROVISIONING` is not exactly
  `true`, or if `MONGO_URI` is not a loopback host (`127.0.0.1`, `localhost`,
  `::1`) with a database name ending `_dev`. There is no override. The
  previously documented `aquaveda_v2` development database must be renamed
  `aquaveda_v2_dev` to use this tool.
- **Idempotent:** the first run creates the ADMIN; later runs change nothing
  (a warning is printed if the stored password differs from the configured
  one — it is never overwritten).
- **No escalation:** if the email already belongs to a `USER` or `EXPERT`,
  the tool refuses and modifies nothing. It provisions only the one
  configured identity and has no HTTP surface.
- **Secret-safe:** output never contains the password, its hash, or tokens.
- **Use:** sign in through the normal `/auth/login` with those credentials.
  ADMIN governs (e.g. approves/rejects Expert applications); it does **not**
  review Knowledge — that stays EXPERT-only. To get an EXPERT locally,
  register a user, `POST /api/v1/expert-application`, then approve it as the
  ADMIN.

Run backend tests from this directory with `npm test`. The suite uses the
real MongoDB instance named by `TEST_MONGO_URI`; the database must be
available before the command starts. The frontend has a separate root
`npm test` command for its dependency-free session-state tests.

## Known v1 bugs that do NOT carry forward

- `server.js` named import against default export — will crash at module load
- `dashboard.service.js` calls `Comment.countDocuments()` without importing Comment
- Auth middleware trusts JWT payload as `req.user` without a DB lookup
- Two error-handling middlewares, only one wired
- Wiki routes have no Zod validation (Issues/Comments did, Wiki didn't)
