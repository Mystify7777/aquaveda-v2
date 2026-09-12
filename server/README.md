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

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/aquaveda_v2
TEST_MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_test   # required for `npm test`; must differ from MONGO_URI
CLIENT_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
JWT_ACCESS_SECRET=    # generate: openssl rand -base64 32
JWT_REFRESH_SECRET=   # generate: openssl rand -base64 32
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
COOKIE_SAME_SITE=none  # locked: frontend/backend are different registrable
                        # domains (genuine cross-site). "none" is mandatory —
                        # "lax"/"strict" would silently drop auth cookies on
                        # cross-site requests. Forces Secure regardless of
                        # NODE_ENV (browser requirement for SameSite=None).
COOKIE_DOMAIN=          # leave unset. No cross-registrable-domain use case
                        # exists for the Domain attribute in this topology.
```

Env vars are loaded by `src/config/db.js` itself (via `dotenv/config`),
not by `server.js`. Both the app entry point and the test suite import
`db.js` (directly or via `tests/helpers/testDb.js`), so `.env` is loaded
consistently regardless of entry point — no per-file `dotenv.config()`
calls needed elsewhere.

`connectDB()` defaults to `MONGO_URI`. The test helper explicitly passes
`{ envVar: "TEST_MONGO_URI" }` and refuses to run if `TEST_MONGO_URI`
equals `MONGO_URI`, so `npm test` can never silently operate against the
development database.

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
