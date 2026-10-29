import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveGeocoderConfig, validateStartupConfig } from "../src/config/env.js";

const PROD = { NODE_ENV: "production" };

describe("resolveGeocoderConfig", () => {
  it("development default is the public OSMF host with an identifying UA and >=1s spacing", () => {
    const c = resolveGeocoderConfig({});
    assert.equal(c.enabled, true);
    assert.equal(c.baseUrl, "https://nominatim.openstreetmap.org");
    assert.match(c.userAgent, /^AquaVeda-v2-dev\//);
    assert.ok(c.minIntervalMs >= 1000);
    assert.equal(c.attribution.text, "© OpenStreetMap contributors");
  });

  it("production without GEOCODER_BASE_URL is disabled, not defaulted to public OSMF", () => {
    const c = resolveGeocoderConfig(PROD);
    assert.equal(c.enabled, false);
    assert.match(c.reason, /GEOCODER_BASE_URL/);
  });

  it("production refuses the public OSMF host (any case/slash form)", () => {
    for (const u of ["https://nominatim.openstreetmap.org", "https://Nominatim.OpenStreetMap.org/"]) {
      assert.throws(
        () => resolveGeocoderConfig({ ...PROD, GEOCODER_BASE_URL: u, GEOCODER_USER_AGENT: "a/1" }),
        /public OSMF/,
      );
    }
  });

  it("production requires an explicit User-Agent when enabled", () => {
    assert.throws(
      () => resolveGeocoderConfig({ ...PROD, GEOCODER_BASE_URL: "https://geo.example/v1" }),
      /GEOCODER_USER_AGENT/,
    );
    const c = resolveGeocoderConfig({ ...PROD, GEOCODER_BASE_URL: "https://geo.example/v1/", GEOCODER_USER_AGENT: "Aqua/1" });
    assert.equal(c.enabled, true);
    assert.equal(c.baseUrl, "https://geo.example/v1");
    assert.equal(c.userAgent, "Aqua/1");
  });

  it("rejects non-https, credentials, query strings and garbage URLs", () => {
    for (const u of ["http://geo.example", "ftp://x", "not a url", "https://u:p@geo.example", "https://geo.example/v1?key=abc"]) {
      assert.throws(() => resolveGeocoderConfig({ GEOCODER_BASE_URL: u }), /GEOCODER_BASE_URL/, u);
    }
  });

  it("allows http only for localhost outside production", () => {
    assert.equal(resolveGeocoderConfig({ GEOCODER_BASE_URL: "http://localhost:8080" }).enabled, true);
    assert.throws(() =>
      resolveGeocoderConfig({ ...PROD, GEOCODER_BASE_URL: "http://localhost:8080", GEOCODER_USER_AGENT: "a/1" }),
    );
  });

  it("validates numeric tunables and the public-host minimum interval", () => {
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_TIMEOUT_MS: "100" }), /GEOCODER_TIMEOUT_MS/);
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_TIMEOUT_MS: "abc" }), /GEOCODER_TIMEOUT_MS/);
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_CACHE_TTL_MS: "10" }), /GEOCODER_CACHE_TTL_MS/);
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_MIN_INTERVAL_MS: "500" }), /GEOCODER_MIN_INTERVAL_MS/);
    const hosted = resolveGeocoderConfig({ GEOCODER_BASE_URL: "https://geo.example", GEOCODER_MIN_INTERVAL_MS: "0" });
    assert.equal(hosted.minIntervalMs, 0);
  });

  it("validates attribution overrides", () => {
    const c = resolveGeocoderConfig({ GEOCODER_ATTRIBUTION_TEXT: "Search by Example", GEOCODER_ATTRIBUTION_URL: "https://example.com/attr" });
    assert.deepEqual(c.attribution, { text: "Search by Example", url: "https://example.com/attr" });
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_ATTRIBUTION_URL: "http://example.com" }), /ATTRIBUTION_URL/);
    assert.throws(() => resolveGeocoderConfig({ GEOCODER_ATTRIBUTION_TEXT: "<b>x</b>" }), /ATTRIBUTION_TEXT/);
  });

  it("keeps the API key out of the base URL contract (key is a separate, optional value)", () => {
    assert.equal(resolveGeocoderConfig({ GEOCODER_API_KEY: "  k  " }).apiKey, "k");
    assert.equal(resolveGeocoderConfig({}).apiKey, undefined);
  });

  it("startup validation fails fast on a malformed geocoder value but not on absence", () => {
    const env = {
      MONGO_URI: "mongodb://127.0.0.1:27017/x",
      JWT_ACCESS_SECRET: "a".repeat(40),
      JWT_REFRESH_SECRET: "b".repeat(40),
    };
    assert.doesNotThrow(() => validateStartupConfig(env));
    assert.throws(() => validateStartupConfig({ ...env, GEOCODER_BASE_URL: "nonsense" }), /GEOCODER_BASE_URL/);
  });
});
