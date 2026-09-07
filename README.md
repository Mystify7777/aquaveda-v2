# AquaVeda v2

A civic intelligence platform: communities, experts, and organizations collaboratively identify, understand, prioritize, and resolve environmental challenges through geospatial reporting, verified knowledge, AI-assisted guidance, and coordinated action.

**Water is the flagship domain, not the ceiling.**

This is a reconstruction, not a migration, of the original AquaVeda (React + Vite + Express, SIH 2024). See [`docs/adr/ADR-0001-new-repository.md`](docs/adr/ADR-0001-new-repository.md).

---

## Current status

**Authentication milestone — Phases A–G complete and verified.**

The project now has a working Express authentication foundation with:

- `User` and `Session` persistence
- Password hashing with Node.js `crypto.scrypt`
- Separate access and refresh JWTs
- Single-use refresh-token rotation with atomic session consumption
- HttpOnly access and refresh cookies
- Fresh database-backed role resolution through `req.actorContext`
- Five auth endpoints: register, login, logout, me, refresh
- Explicit credentialed CORS allowlisting
- Zod validation and email canonicalization for registration/login
- Local auth-route error mapping with generic handling for unexpected errors

The backend test suite currently passes **126/126** locally against MongoDB. Validation verification passes **63/63**, and model verification passes **44/44**.

The broader domain/application surface is intentionally still under construction. Issue, Knowledge, Comment, Project, and recommendation behavior will be implemented milestone by milestone rather than being pulled into the authentication work prematurely.

**Next:** Phase H, resolving the deployment-dependent cookie settings (`SameSite` and `Domain`) against the actual hosting topology.

---

## What is already built

### Web foundation

The Next.js application has the initial product shell and design foundation in place:

- Next.js App Router application shell
- Design tokens and light/dark themes
- Responsive navigation and footer
- Reusable UI primitives
- Loading, error, and not-found states
- Hydration-safe theme switching
- A validated Server → Client data loop through the system-status API

### Backend foundation

The Express service now includes the persistence, service, and authentication layers needed to build the domain surface safely:

- Mongoose persistence for the domain model foundations
- Service-layer actor-context boundary
- Conditional atomic lifecycle update patterns for domain services
- Authentication configuration and session persistence
- Access/refresh token utilities
- Authentication services and middleware
- Auth API routes, cookies, CORS, and request validation
- Automated model, validation, service, middleware, and route tests

The remaining domain work is deliberately sequenced behind the architecture decisions in `docs/architecture/decision-register.md`.

---

## Repository layout

```text
aquaveda-v2/
  src/          Next.js web application (App Router)
  server/       Express API service
  docs/         Architecture, ADRs, engineering standards, vision
```

Frontend and backend share one repository: one roadmap, one documentation set, and one release cadence. A future `apps/web` + `apps/server` workspace layout remains an evolution path if additional surfaces justify it.

---

## Getting started

### Web app

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

### Server

```bash
cd server
npm install
npm run dev
```

For the full backend verification workflow, see [`server/README.md`](server/README.md).

The backend expects MongoDB and the environment variables documented in that file. Tests require a dedicated `TEST_MONGO_URI` that is different from `MONGO_URI`.

---

## Tech stack

**Web (`src/`)**

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Radix UI · `class-variance-authority` · `clsx` · `tailwind-merge` · `lucide-react` · `next-themes`

**Server (`server/`)**

Node.js 20+ · Express 4 · Mongoose 8 · Zod 3 · `jsonwebtoken` · `cookie-parser` · `cors`

Authentication uses Node's built-in `crypto.scrypt` for password hashing and SHA-256 for refresh-token-at-rest hashing.

Dependencies are introduced when the milestone that needs them is implemented rather than being preinstalled for hypothetical future features.

---

## Authentication API

The current authentication surface is intentionally minimal:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create an account and establish an authenticated session |
| `POST` | `/api/v1/auth/login` | Authenticate and establish an authenticated session |
| `POST` | `/api/v1/auth/logout` | Clear auth cookies and invalidate the refresh session |
| `GET` | `/api/v1/auth/me` | Return the current request actor context, or `null` when anonymous |
| `POST` | `/api/v1/auth/refresh` | Rotate the refresh token and issue a new access token |

Browser authentication is cookie-only. Access and refresh tokens are not returned in response bodies or stored in browser storage.

Authentication is intentionally separated from domain authorization. The unresolved D-3a policy for authorized Issue remediation actors remains a domain/application decision and is not encoded into authentication.

---

## Documentation

```text
docs/
  vision/        Product vision, principles, and invariants
  engineering/   Engineering standards and testing guidance
  adr/           Architecture decision records
  domain/        Domain model and lifecycle decisions
  architecture/ Decision register, persistence/auth architecture, implementation plans
  future/        Deferred ideas and parking-lot material
```

Start with [`docs/vision/vision.md`](docs/vision/vision.md).

Read [`docs/vision/product-invariants.md`](docs/vision/product-invariants.md) for the non-negotiable product rules.

Read [`docs/architecture/decision-register.md`](docs/architecture/decision-register.md) for the canonical record of locked, deferred, and implementation decisions.

Read [`CLAUDE.md`](CLAUDE.md) for the current engineering progress log and milestone verification state.

---

## Development approach

AquaVeda v2 is being rebuilt as a sequence of explicit architectural milestones rather than as a direct port of v1 code.

The working order is intentionally bottom-up:

```text
Architecture
    ↓
Persistence
    ↓
Domain/services
    ↓
Authentication
    ↓
Validation + HTTP integration
    ↓
Domain/application routes
    ↓
Frontend integration
    ↓
Feature milestones
```

The repository treats architecture decisions, implementation scope, and verification results as first-class project artifacts. Changes that affect those decisions are recorded before implementation rather than being smuggled in through whichever file happened to be open at 2 a.m.
