import { Router } from "express";

import { isDatabaseReady } from "../config/db.js";

/**
 * Liveness and readiness probes (#127). Contract: docs/architecture/health-and-readiness.md.
 *
 * - `GET /api/v1/health` — LIVENESS: "the Node/Express process is alive".
 *   Never touches MongoDB and never depends on it; unchanged response.
 * - `GET /api/v1/ready` — READINESS: "this instance can currently serve
 *   database-backed requests". 200 when the MongoDB connection is usable,
 *   503 otherwise (the standard probe signal for "do not route traffic here").
 *
 * Response bodies are fixed literals. Nothing from the driver, the connection
 * string, the topology or any error is ever included, so a probe learns only
 * ready / not ready.
 *
 * Mounted in `createApp()` BEFORE `authMiddleware`: that middleware resolves
 * the actor from the database when a valid access cookie is present, and a
 * probe must not depend on MongoDB (or on a cookie) in any way.
 */

/**
 * @param {{ isReady?: () => boolean }} [deps] injectable readiness source (tests).
 */
export function createHealthRouter({ isReady = isDatabaseReady } = {}) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/ready", (req, res) => {
    let ready = false;
    try {
      ready = isReady() === true;
    } catch {
      // A failing readiness source means "not ready"; its error is never surfaced.
      ready = false;
    }
    // The answer changes with infrastructure state: never let a proxy/CDN cache it.
    res.set("Cache-Control", "no-store");
    if (ready) {
      res.status(200).json({ status: "ready" });
      return;
    }
    res.status(503).json({ status: "unavailable" });
  });

  return router;
}

export const healthRouter = createHealthRouter();
