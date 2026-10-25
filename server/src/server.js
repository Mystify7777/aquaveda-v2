import "dotenv/config";

import { createApp } from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { validateStartupConfig } from "./config/env.js";

/**
 * Process entry point.
 *
 * server.js  → starts the process, owns startup/shutdown lifecycle
 * app.js     → defines the Express application, no process concerns
 *
 * This split exists specifically to avoid the v1 bug documented in
 * server/README.md: a named/default export mismatch between server.js
 * and app.js that crashed at module load. Both modules here use named
 * exports consistently.
 */

const PORT = process.env.PORT || 5000;

let httpServer;

async function start() {
  try {
    validateStartupConfig();
    await connectDB();

    const app = createApp();

    httpServer = app.listen(PORT, () => {
      console.log(`[server] AquaVeda API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("[server] Startup failed:", error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down gracefully...`);

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await disconnectDB();

  console.log("[server] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
