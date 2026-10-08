import { execFileSync } from "node:child_process";
import path from "node:path";

import { BACKEND_ENV } from "./env";

/** Deterministic fixture data, created through the backend's own domain services. */
export default function globalSetup(): void {
  execFileSync(process.execPath, [path.join("server", "scripts", "seed-e2e.js")], {
    env: { ...process.env, ...BACKEND_ENV },
    stdio: "inherit",
  });
}
