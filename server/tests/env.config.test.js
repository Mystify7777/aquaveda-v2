import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getRequiredEnv,
  getAccessSecret,
  getRefreshSecret,
  parseDurationToMs,
  validateAuthConfig,
  validateStartupConfig,
  isSameMongoDatabase,
  assertTestDatabaseSeparation,
  resolveCookieSameSite,
  resolveCookieDomain,
} from "../src/config/env.js";

const VALID_ACCESS_SECRET = "secure-random-access-secret-32-chars-long";
const VALID_REFRESH_SECRET = "secure-random-refresh-secret-32-chars-long";

function baseValidEnv(overrides = {}) {
  return {
    MONGO_URI: "mongodb://127.0.0.1:27017/aquaveda_v2_dev",
    JWT_ACCESS_SECRET: VALID_ACCESS_SECRET,
    JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
    JWT_ACCESS_EXPIRES: "15m",
    JWT_REFRESH_EXPIRES: "7d",
    COOKIE_SAME_SITE: "none",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ...overrides,
  };
}

describe("src/config/env.js — getRequiredEnv", () => {
  it("returns the variable value when present", () => {
    const val = getRequiredEnv("TEST_VAR", { TEST_VAR: "hello" });
    assert.equal(val, "hello");
  });

  it("throws clear startup error when variable is missing or empty", () => {
    assert.throws(
      () => getRequiredEnv("MISSING_VAR", {}),
      /Missing required environment variable: MISSING_VAR/
    );
    assert.throws(
      () => getRequiredEnv("EMPTY_VAR", { EMPTY_VAR: "" }),
      /Missing required environment variable: EMPTY_VAR/
    );
  });
});

describe("src/config/env.js — secret separation", () => {
  it("returns access and refresh secrets when both are set and distinct", () => {
    const env = baseValidEnv();
    assert.equal(getAccessSecret(env), VALID_ACCESS_SECRET);
    assert.equal(getRefreshSecret(env), VALID_REFRESH_SECRET);
  });

  it("throws if access secret is missing", () => {
    const env = baseValidEnv({ JWT_ACCESS_SECRET: undefined });
    assert.throws(
      () => getAccessSecret(env),
      /Missing required environment variable: JWT_ACCESS_SECRET/
    );
  });

  it("throws if refresh secret is missing", () => {
    const env = baseValidEnv({ JWT_REFRESH_SECRET: undefined });
    assert.throws(
      () => getRefreshSecret(env),
      /Missing required environment variable: JWT_REFRESH_SECRET/
    );
  });

  it("strictly refuses identical access and refresh secrets (key separation invariant)", () => {
    const sharedSecret = "shared-identical-secret-value-32-characters";
    const env = baseValidEnv({
      JWT_ACCESS_SECRET: sharedSecret,
      JWT_REFRESH_SECRET: sharedSecret,
    });

    assert.throws(
      () => getAccessSecret(env),
      /Configuration security violation: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets/
    );
    assert.throws(
      () => getRefreshSecret(env),
      /Configuration security violation: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets/
    );
  });
});

describe("src/config/env.js — parseDurationToMs", () => {
  it("parses valid duration units correctly", () => {
    assert.equal(parseDurationToMs("10s"), 10_000);
    assert.equal(parseDurationToMs("15m"), 15 * 60_000);
    assert.equal(parseDurationToMs("2h"), 2 * 3_600_000);
    assert.equal(parseDurationToMs("7d"), 7 * 86_400_000);
  });

  it("rejects non-string inputs", () => {
    assert.throws(() => parseDurationToMs(null), /Unrecognized duration format/);
    assert.throws(() => parseDurationToMs(123), /Unrecognized duration format/);
  });

  it("rejects invalid duration formats", () => {
    assert.throws(() => parseDurationToMs(""), /Unrecognized duration format/);
    assert.throws(() => parseDurationToMs("15"), /Unrecognized duration format/);
    assert.throws(() => parseDurationToMs("15w"), /Unrecognized duration format/);
    assert.throws(() => parseDurationToMs("15 mins"), /Unrecognized duration format/);
    assert.throws(() => parseDurationToMs("-5m"), /Unrecognized duration format/);
  });

  it("rejects zero duration", () => {
    assert.throws(
      () => parseDurationToMs("0s"),
      /Invalid duration: "0s". Duration must be greater than zero/
    );
    assert.throws(
      () => parseDurationToMs("0m"),
      /Invalid duration: "0m". Duration must be greater than zero/
    );
  });
});

describe("src/config/env.js — validateAuthConfig & validateStartupConfig", () => {
  it("accepts a completely valid configuration", () => {
    const env = baseValidEnv();
    assert.equal(validateAuthConfig(env), true);
    assert.equal(validateStartupConfig(env), true);
  });

  it("fails startup validation if MONGO_URI is missing", () => {
    const env = baseValidEnv({ MONGO_URI: "" });
    assert.throws(
      () => validateStartupConfig(env),
      /Missing required environment variable: MONGO_URI/
    );
  });

  it("fails if access token lifetime is greater than or equal to refresh token lifetime", () => {
    // Equal lifetimes
    assert.throws(
      () => validateAuthConfig(baseValidEnv({ JWT_ACCESS_EXPIRES: "7d", JWT_REFRESH_EXPIRES: "7d" })),
      /JWT_ACCESS_EXPIRES \("7d"\) must be strictly shorter than JWT_REFRESH_EXPIRES \("7d"\)/
    );

    // Inverted lifetimes (access longer than refresh)
    assert.throws(
      () => validateAuthConfig(baseValidEnv({ JWT_ACCESS_EXPIRES: "14d", JWT_REFRESH_EXPIRES: "7d" })),
      /JWT_ACCESS_EXPIRES \("14d"\) must be strictly shorter than JWT_REFRESH_EXPIRES \("7d"\)/
    );
  });

  it("validates cookie SameSite and Domain attributes", () => {
    assert.throws(
      () => validateAuthConfig(baseValidEnv({ COOKIE_SAME_SITE: "invalid" })),
      /Invalid COOKIE_SAME_SITE value/
    );
    assert.throws(
      () => validateAuthConfig(baseValidEnv({ COOKIE_DOMAIN: "invalid domain with spaces" })),
      /Invalid COOKIE_DOMAIN value/
    );
  });
});

describe("src/config/env.js — production security requirements", () => {
  const prodBase = (overrides = {}) =>
    baseValidEnv({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "valid-production-access-auth-key-abcdefghijklmn",
      JWT_REFRESH_SECRET: "valid-production-refresh-auth-key-abcdefghijklmn",
      ALLOWED_ORIGINS: "https://app.aquaveda.org",
      ...overrides,
    });

  it("passes when production configuration satisfies all requirements", () => {
    assert.equal(validateAuthConfig(prodBase()), true);
  });

  it("refuses secrets shorter than 32 characters in production", () => {
    assert.throws(
      () => validateAuthConfig(prodBase({ JWT_ACCESS_SECRET: "short-secret" })),
      /Production security violation: JWT_ACCESS_SECRET must be at least 32 characters long/
    );
    assert.throws(
      () => validateAuthConfig(prodBase({ JWT_REFRESH_SECRET: "short-secret" })),
      /Production security violation: JWT_REFRESH_SECRET must be at least 32 characters long/
    );
  });

  it("refuses placeholder or predictable pattern secrets in production", () => {
    assert.throws(
      () =>
        validateAuthConfig(
          prodBase({
            JWT_ACCESS_SECRET: "test-access-secret-placeholder-for-tests-32-chars",
          })
        ),
      /Production security violation: JWT secrets must not contain predictable placeholder pattern "test-"/
    );

    assert.throws(
      () =>
        validateAuthConfig(
          prodBase({
            JWT_REFRESH_SECRET: "my-production-secret-password-longer-than-32-chars",
          })
        ),
      /Production security violation: JWT secrets must not contain predictable placeholder pattern "secret"/
    );
  });

  it("refuses missing or empty ALLOWED_ORIGINS in production", () => {
    assert.throws(
      () => validateAuthConfig(prodBase({ ALLOWED_ORIGINS: "" })),
      /Production configuration error: ALLOWED_ORIGINS must be set in production/
    );
  });

  it("refuses wildcard '*' in ALLOWED_ORIGINS in production", () => {
    assert.throws(
      () => validateAuthConfig(prodBase({ ALLOWED_ORIGINS: "*" })),
      /Production security violation: ALLOWED_ORIGINS must not contain wildcard '\*'/
    );
    assert.throws(
      () => validateAuthConfig(prodBase({ ALLOWED_ORIGINS: "https://app.aquaveda.org, *" })),
      /Production security violation: ALLOWED_ORIGINS must not contain wildcard '\*'/
    );
  });
});

describe("src/config/env.js — database separation guards", () => {
  it("isSameMongoDatabase identifies identical URIs", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://127.0.0.1:27017/aquaveda_v2",
        "mongodb://127.0.0.1:27017/aquaveda_v2"
      ),
      true
    );
  });

  it("isSameMongoDatabase identifies loopback aliases targeting the same database", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://localhost:27017/aquaveda_v2",
        "mongodb://127.0.0.1:27017/aquaveda_v2"
      ),
      true
    );
    assert.equal(
      isSameMongoDatabase(
        "mongodb://[::1]:27017/aquaveda_v2",
        "mongodb://localhost:27017/aquaveda_v2"
      ),
      true
    );
  });

  it("isSameMongoDatabase normalizes default port 27017", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://localhost/aquaveda_v2",
        "mongodb://127.0.0.1:27017/aquaveda_v2"
      ),
      true
    );
  });

  it("isSameMongoDatabase ignores query parameters and trailing slashes", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://localhost:27017/aquaveda_v2?retryWrites=true&w=majority",
        "mongodb://127.0.0.1:27017/aquaveda_v2/"
      ),
      true
    );
  });

  it("isSameMongoDatabase distinguishes different database names on same host", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://127.0.0.1:27017/aquaveda_v2_dev",
        "mongodb://127.0.0.1:27017/aquaveda_v2_test"
      ),
      false
    );
  });

  it("isSameMongoDatabase distinguishes different ports", () => {
    assert.equal(
      isSameMongoDatabase(
        "mongodb://127.0.0.1:27017/aquaveda_v2",
        "mongodb://127.0.0.1:27018/aquaveda_v2"
      ),
      false
    );
  });

  it("assertTestDatabaseSeparation refuses identical verbatim URIs", () => {
    assert.throws(
      () =>
        assertTestDatabaseSeparation(
          "mongodb://127.0.0.1:27017/aquaveda_v2",
          "mongodb://127.0.0.1:27017/aquaveda_v2"
        ),
      /TEST_MONGO_URI must not be the same as MONGO_URI — refusing to run tests against the development database/
    );
  });

  it("assertTestDatabaseSeparation refuses loopback alias reuse (localhost vs 127.0.0.1)", () => {
    assert.throws(
      () =>
        assertTestDatabaseSeparation(
          "mongodb://127.0.0.1:27017/aquaveda_v2",
          "mongodb://localhost:27017/aquaveda_v2"
        ),
      /TEST_MONGO_URI must not target the same database as MONGO_URI/
    );
  });

  it("assertTestDatabaseSeparation refuses databases ending in _dev", () => {
    assert.throws(
      () =>
        assertTestDatabaseSeparation(
          "mongodb://127.0.0.1:27017/aquaveda_v2_dev",
          "mongodb://127.0.0.1:27017/other_db"
        ),
      /TEST_MONGO_URI database "aquaveda_v2_dev" ends with "_dev" — refusing to run tests against a development database/
    );
  });

  it("assertTestDatabaseSeparation accepts distinct test and development databases", () => {
    assert.doesNotThrow(() =>
      assertTestDatabaseSeparation(
        "mongodb://127.0.0.1:27017/aquaveda_v2_test",
        "mongodb://127.0.0.1:27017/aquaveda_v2_dev"
      )
    );
  });
});
