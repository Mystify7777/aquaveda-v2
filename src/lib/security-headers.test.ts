import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import {
  WEB_PERMISSIONS_POLICY,
  WEB_REFERRER_POLICY,
  WEB_SECURITY_HEADERS,
} from "@/lib/security-headers";

/**
 * Issue #129 — the headers Next.js is actually configured to emit. Tests the
 * real next.config.ts export, so removing or breaking the wiring fails here.
 * (Verified end to end against `next start` during implementation; see
 * docs/architecture/http-security-headers.md.)
 */

async function configuredHeaders() {
  const rules = await nextConfig.headers!();
  return rules;
}

describe("next.config baseline security headers", () => {
  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("applies exactly one rule, to every path (pages, static assets, 404s)", async () => {
    const rules = await configuredHeaders();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
  });

  it("emits exactly the baseline headers, once each, with the intended values", async () => {
    const [{ headers }] = await configuredHeaders();
    const byKey = new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(headers).toHaveLength(byKey.size); // no duplicate keys
    expect(Object.fromEntries(byKey)).toEqual({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "permissions-policy": WEB_PERMISSIONS_POLICY,
    });
  });

  it("config is derived from the single source of truth", async () => {
    const [{ headers }] = await configuredHeaders();
    expect(headers).toEqual(WEB_SECURITY_HEADERS.map((h) => ({ ...h })));
  });

  it("Referrer-Policy keeps OpenStreetMap tiles working (they 403 without a Referer)", () => {
    // OSM wiki "Referer": must not be no-referrer or same-origin.
    expect(["no-referrer", "same-origin", "", "unsafe-url"]).not.toContain(WEB_REFERRER_POLICY);
    expect([
      "no-referrer-when-downgrade",
      "origin",
      "origin-when-cross-origin",
      "strict-origin",
      "strict-origin-when-cross-origin",
    ]).toContain(WEB_REFERRER_POLICY);
  });

  it("Permissions-Policy keeps geolocation for the report form and denies unused capabilities", () => {
    expect(WEB_PERMISSIONS_POLICY).toContain("geolocation=(self)");
    for (const f of ["camera", "microphone", "payment", "usb", "serial", "midi", "display-capture"]) {
      expect(WEB_PERMISSIONS_POLICY).toContain(`${f}=()`);
    }
    // Clipboard (copy Issue ID) must not be disabled.
    expect(WEB_PERMISSIONS_POLICY).not.toMatch(/clipboard/);
  });

  it("does not set HSTS or CSP at the app layer (hosting-owned / separate decision)", async () => {
    const [{ headers }] = await configuredHeaders();
    const keys = headers.map((h) => h.key.toLowerCase());
    expect(keys).not.toContain("strict-transport-security");
    expect(keys).not.toContain("content-security-policy");
  });
});
