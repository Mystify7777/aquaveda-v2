import { Router } from "express";

import { getDashboard } from "../services/dashboard.service.js";
import { sendSuccess, sendError } from "../http/respond.js";

/**
 * Dashboard routes (Issue #53). Contract: docs/architecture/dashboard-contract.md.
 *
 * One authenticated read. The service enforces the actor requirement (401 for
 * anonymous callers); the route only maps the result onto the shared envelope.
 * The response is per-user, so it must never be cached by a shared cache.
 */

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  try {
    const dashboard = await getDashboard(req.actorContext);
    res.set("Cache-Control", "private, no-store");
    sendSuccess(res, dashboard, "Dashboard retrieved");
  } catch (err) {
    sendError(res, err);
  }
});
