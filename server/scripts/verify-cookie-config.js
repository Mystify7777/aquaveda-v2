/**
 * Phase H cookie-config verification script.
 *
 * Verifies resolveCookieSameSite()/resolveCookieDomain() in isolation —
 * pure env-var parsing, no Mongoose, no MongoDB, no network. Mirrors the
 * style/discipline of scripts/verify-validation.js.
 *
 * Run with:
 *   npm run verify:cookie-config
 * or directly:
 *   node scripts/verify-cookie-config.js
 */

import assert from "node:assert/strict";

import { resolveCookieSameSite, resolveCookieDomain } from "../src/config/env.js";

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${label}`);
    console.error(`         ${err.message}`);
  }
}

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

console.log("resolveCookieSameSite()");

check("defaults to \"none\" when unset (this deployment's locked cross-site value)", () => {
  withEnv({ COOKIE_SAME_SITE: undefined }, () => {
    assert.equal(resolveCookieSameSite(), "none");
  });
});

check("accepts \"none\" (this deployment's locked value)", () => {
  withEnv({ COOKIE_SAME_SITE: "none" }, () => {
    assert.equal(resolveCookieSameSite(), "none");
  });
});

check("accepts \"strict\"", () => {
  withEnv({ COOKIE_SAME_SITE: "strict" }, () => {
    assert.equal(resolveCookieSameSite(), "strict");
  });
});

check("is case-insensitive", () => {
  withEnv({ COOKIE_SAME_SITE: "None" }, () => {
    assert.equal(resolveCookieSameSite(), "none");
  });
});

check("throws on an unrecognized value instead of passing it through", () => {
  withEnv({ COOKIE_SAME_SITE: "yolo" }, () => {
    assert.throws(() => resolveCookieSameSite(), /Invalid COOKIE_SAME_SITE/);
  });
});

console.log("resolveCookieDomain()");

check("returns undefined when unset (host-only cookie, correct for cross-site topology)", () => {
  withEnv({ COOKIE_DOMAIN: undefined }, () => {
    assert.equal(resolveCookieDomain(), undefined);
  });
});

check("returns undefined for empty string", () => {
  withEnv({ COOKIE_DOMAIN: "" }, () => {
    assert.equal(resolveCookieDomain(), undefined);
  });
});

check("accepts a bare domain", () => {
  withEnv({ COOKIE_DOMAIN: "aquaveda.com" }, () => {
    assert.equal(resolveCookieDomain(), "aquaveda.com");
  });
});

check("throws on a value containing whitespace", () => {
  withEnv({ COOKIE_DOMAIN: "aqua veda.com" }, () => {
    assert.throws(() => resolveCookieDomain(), /Invalid COOKIE_DOMAIN/);
  });
});

check("throws on a value with no dot (not a domain)", () => {
  withEnv({ COOKIE_DOMAIN: "localhost" }, () => {
    assert.throws(() => resolveCookieDomain(), /Invalid COOKIE_DOMAIN/);
  });
});

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exitCode = 1;
