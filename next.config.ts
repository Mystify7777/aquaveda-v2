import type { NextConfig } from "next";

import { WEB_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Do not advertise the framework (information disclosure, no functional use).
  poweredByHeader: false,

  // Baseline security headers (Issue #129). `/:path*` matches every path the
  // Next server answers, including `/` and static assets. Hosting-managed
  // headers (HSTS, CDN-level) are intentionally not set here; see
  // docs/architecture/http-security-headers.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: WEB_SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
