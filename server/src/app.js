import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { authMiddleware } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";

/**
 * Express application boundary.
 *
 * This module defines the app only — it does not call listen() and does
 * not connect to the database. That separation is what server.js exists
 * for, and is deliberately preserved to avoid the v1 startup import
 * mismatch (server.js/app.js export shape disagreement) documented in
 * server/README.md.
 *
 * createApp() is a factory rather than a shared singleton instance so
 * tests can construct an isolated app per test run without import-order
 * side effects.
 */

/**
 * CORS origin-checking function, per Phase F review: NEVER a wildcard
 * combined with credentials — `origin: "*"` plus `credentials: true` is
 * both meaningless (browsers reject it) and a common credentialed-CORS
 * misconfiguration this project explicitly avoids. `ALLOWED_ORIGINS` is
 * a comma-separated allowlist (already reserved in server/README.md's
 * env block); requests with no Origin header at all (server-to-server,
 * curl, same-origin requests in some browser contexts) are allowed
 * through, since credentialed-cookie CORS restrictions only meaningfully
 * apply to cross-origin browser requests that DO send an Origin header.
 */
function buildCorsOptions() {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin(requestOrigin, callback) {
      if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }
      // `callback(null, false)`, not `callback(new Error(...))`: the
      // `cors` package's own documented pattern for "reject this
      // origin" is to pass `false`, which simply omits the CORS
      // headers (leaving the browser's own same-origin policy to block
      // the response) rather than throwing an error that would
      // otherwise surface as a noisy, misleading 500 from this app's
      // generic error handler for what is really just an expected,
      // well-understood rejection.
      callback(null, false);
    },
    credentials: true,
  };
}

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors(buildCorsOptions()));

  // Global actor resolution (Phase E/L6): every route, present and
  // future, receives req.actorContext (populated or null) before it
  // runs. This is the ONLY place actorContext is produced — routes
  // never resolve it themselves. Advisory only: a missing/invalid
  // token never rejects the request here, preserving Product
  // Invariant 5 (anonymous browsing).
  app.use(authMiddleware);

  // Minimal health check — no business logic, no DB dependency check yet.
  app.get("/api/v1/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // The five-endpoint minimal auth API (decision-register.md L4). This
  // router is self-contained — it never calls issue/knowledge/comment/
  // project.service.js. General domain routes remain a separate, future
  // Routes milestone, deliberately not started here.
  app.use("/api/v1/auth", authRouter);

  // No route matched.
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: "Not found",
    });
  });

  // Centralized error-handling boundary. Deliberately minimal at this
  // milestone: it exists so thrown/forwarded errors have one place to
  // land, not to encode the full API error contract (see ADR-0006's
  // note that the exact error representation belongs to that contract,
  // not to persistence-layer ADRs).
  //
  // `next` is required and must stay fourth: Express only recognizes a
  // middleware function as an error handler when it has arity 4, and
  // detects that by literal parameter count, not by whether the
  // function body references `next`. Removing it (or making it a rest
  // param) would silently turn this into a normal middleware that never
  // fires on errors.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[app] Unhandled error:", err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  });

  return app;
}

export default createApp;
