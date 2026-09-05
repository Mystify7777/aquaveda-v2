import type { SystemSnapshot } from "@/lib/system";

import { apiRequest } from "./client";

export function getSystemSnapshot() {
  return apiRequest<SystemSnapshot>("/api/system", {
    cache: "no-store",
  });
}