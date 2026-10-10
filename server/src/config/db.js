import mongoose from "mongoose";
import { getRequiredEnv } from "./env.js";

/**
 * Mongoose connection boundary.
 *
 * Responsibilities:
 * - one connection per process (no per-request connection creation)
 * - fail clearly if the required env var is missing, rather than
 *   connecting to a silent default
 * - surface connection errors instead of swallowing them
 * - expose a clean disconnect path for graceful shutdown
 *
 * This module does not know about Express, routes, or business logic.
 *
 * Environment loading itself lives in `./env.js`, not here — this
 * module used to own the `dotenv/config` import directly (see git
 * history / decision-register.md's Phase D section for why that was
 * originally the case), but that made env loading an accidental side
 * effect of importing the database module specifically. `env.js` is now
 * the one intentional configuration entry point; this module imports it
 * like any other config consumer would, and reuses its
 * `getRequiredEnv()` helper rather than defining its own copy. This is
 * a mechanical refactor — `connectDB()`'s connection logic and its
 * `{ envVar }` mechanism are unchanged below.
 */

// Tracks an in-flight connection attempt so concurrent calls to connectDB()
// (e.g. during startup) reuse the same attempt instead of racing to open a
// second connection.
let connectionPromise = null;

/**
 * Connect to MongoDB. Safe to call multiple times — returns the existing
 * connection if already connected, or the in-flight promise if a
 * connection attempt is already underway.
 *
 * @param {{ envVar?: string, uri?: string }} [options] - envVar selects
 *   which env var holds the connection string. Defaults to MONGO_URI
 *   (application runtime). Test code must pass `{ envVar: "TEST_MONGO_URI" }`
 *   explicitly — there is no implicit fallback to MONGO_URI, so a test
 *   run can never silently point at the development database.
 *   `uri` connects to exactly that string and bypasses the environment
 *   lookup: for scripts that have ALREADY validated a target (admin
 *   provisioning, #89) and must connect to precisely what they validated.
 */
export async function connectDB({ envVar = "MONGO_URI", uri: explicitUri } = {}) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = explicitUri ?? getRequiredEnv(envVar);

  mongoose.connection.on("error", (err) => {
    console.error("[db] MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB disconnected");
  });

  connectionPromise = mongoose
    .connect(uri)
    .then((conn) => {
      console.log("[db] MongoDB connected");
      return conn.connection;
    })
    .catch((err) => {
      // Allow a subsequent call to retry rather than being stuck on a
      // rejected promise forever.
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

/**
 * Disconnect cleanly. Intended for graceful shutdown (SIGINT/SIGTERM) and
 * for test teardown. Safe to call when not connected.
 */
export async function disconnectDB() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
  connectionPromise = null;
  console.log("[db] MongoDB disconnected cleanly");
}
