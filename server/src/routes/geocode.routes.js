import { Router } from "express";

import { resolveGeocoderConfig } from "../config/env.js";
import { sendError, sendSuccess, sendValidationError } from "../http/respond.js";
import { createRateLimiter } from "../middleware/rate-limiter.js";
import { requireActor } from "../services/authorization.js";
import { geocoderUnavailable } from "../services/errors.js";
import { createGeocoder } from "../services/geocoder.js";
import { geocodeSearchQuerySchema } from "../validation/geocode.validation.js";

/**
 * Place search (#134): forward geocoding proxy for the issue-report form.
 *
 * Authenticated (reporters only — bounds provider abuse; browsing Explore
 * never needs it), per-IP rate limited, submit-driven. Returns candidate
 * places only; the CLIENT chooses one and submits coordinates (+ optional
 * untrusted label) through the unchanged POST /api/v1/issues contract.
 * Nothing here is persisted.
 */

let defaultGeocoder;
let defaultResolved = false;

function getDefaultGeocoder() {
  if (!defaultResolved) {
    const config = resolveGeocoderConfig();
    defaultGeocoder = config.enabled ? createGeocoder(config) : null;
    defaultResolved = true;
  }
  return defaultGeocoder;
}

export function createGeocodeRouter({
  getGeocoder = getDefaultGeocoder,
  limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, keyPrefix: "geocode:" }),
} = {}) {
  const router = Router();

  router.get("/search", limiter, async (req, res) => {
    try {
      requireActor(req.actorContext);
      const parsed = geocodeSearchQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const geocoder = getGeocoder();
      if (!geocoder) throw geocoderUnavailable("Place search is not available right now.");
      const result = await geocoder.search(parsed.data.q);
      res.set("Cache-Control", "private, no-store");
      sendSuccess(res, result, "Locations retrieved");
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

export const geocodeRouter = createGeocodeRouter();
export default geocodeRouter;
