# Liveness and readiness probes (#127)

Two endpoints answer two different questions. Deployment probes should use them for different purposes.

| | Liveness | Readiness |
|---|---|---|
| Endpoint | `GET /api/v1/health` | `GET /api/v1/ready` |
| Question | Is the Node/Express process alive? | Can this instance currently serve database-backed requests? |
| Depends on MongoDB | **No, intentionally.** Never queries it, never reads connection state. | **Yes.** Reflects the current MongoDB connection state. |
| Success | `200` `{"status":"ok","timestamp":"<ISO-8601>"}` | `200` `{"status":"ready"}` |
| Failure | none while the process can answer | `503` `{"status":"unavailable"}` |
| Caching | unchanged | `Cache-Control: no-store` (the answer tracks infrastructure state) |

## Guarantees

- **Liveness keeps answering `200` while MongoDB is down.** A database outage must not make an orchestrator kill a healthy process.
- **Readiness follows the live connection, not the startup result.** It is `503` whenever Mongoose's connection is not `connected` (disconnected, connecting or disconnecting) and returns to `200` by itself once the driver reconnects. Nothing in the application drives recovery.
- **Bodies are fixed literals.** They never contain the connection string, host, port, credentials, a driver error, a stack trace or topology/connection metadata. A readiness source that throws is reported as `503`, and its error is never surfaced.
- Neither probe reads the actor, a cookie or any other request state: both are mounted **before** `authMiddleware` (which looks the user up in MongoDB when a valid access cookie is present). They still pass through the API security headers, CORS and the request logger like every other route.
- Readiness depends on the database connection only: no other application state is consulted.

## Source of truth

`isDatabaseReady()` in `server/src/config/db.js` reads `mongoose.connection.readyState === 1`. It issues no query. Observed against a real `mongod` (Mongoose 8.24): after the process is killed `readyState` becomes `0` almost immediately; after it returns the driver emits `reconnected` and `readyState` is `1` again within about 5–10 s. A silent network partition (no connection reset) is detected on the driver's heartbeat cycle (default 10 s), so readiness can lag such a failure by up to that interval.

## Startup

Unchanged: `server.js` waits for the initial connection before it starts listening, so a freshly started instance that answers at all has had a successful first connect. That ordering is **not** what readiness means afterwards, which is why the endpoints are separate.

## Probe configuration

- Restart/kill decisions: **liveness**.
- Routing/traffic decisions, deployment gates and the browser smoke suite's server wait: **readiness**. Playwright (`playwright.config.ts`) waits on `/api/v1/ready`, because the smoke tests need the database.
- Do **not** use readiness as a restart signal: a database outage would then restart every instance without fixing anything.

## Not in scope

No monitoring infrastructure, no checks for other dependencies (queues, caches, external APIs) and no extra metadata. Add a dependency to readiness only when the API genuinely cannot serve requests without it.
