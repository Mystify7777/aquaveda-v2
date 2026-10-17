import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TargetValidationError,
  denyReasonForDatabaseName,
  parseMongoUri,
  validateBootstrapTarget,
} from "../scripts/bootstrap-target.js";

/**
 * Pure tests (no MongoDB, no network). Every host below is a reserved
 * `.example.invalid` name and every credential is an obvious fixture; nothing
 * here refers to a real deployment, and "bootstrap_fixture" is NOT a claim about
 * the real production database name (the repository does not establish one).
 */
const DB = "bootstrap_fixture";
const SRV = `mongodb+srv://fixture_user:fixture_pass@cluster.example.invalid/${DB}?retryWrites=true`;
const STD = `mongodb://fixture_user:fixture_pass@db0.example.invalid:27017/${DB}?tls=true`;
const MULTI =
  "mongodb://fixture_user:fixture_pass@db0.example.invalid:27017,db1.example.invalid:27017,db2.example.invalid:27017/" +
  `${DB}?tls=true&replicaSet=rs0&authSource=admin`;

const refusal = (pattern) => (err) => {
  assert.ok(err instanceof TargetValidationError, `expected TargetValidationError, got ${err}`);
  assert.match(err.message, pattern);
  // Refusals never echo the URI, its hosts, or its credentials.
  assert.ok(!/fixture_pass|fixture_user|example\.invalid/.test(err.message), "message leaked URI content");
  return true;
};

describe("validateBootstrapTarget: accepted targets", () => {
  for (const [label, uri] of [
    ["mongodb+srv with default TLS", SRV],
    ["single-host mongodb:// with tls=true", STD],
    ["multi-host replica-set seed list with tls=true", MULTI],
    ["ssl=true alias", `mongodb://u:p@db0.example.invalid:27017/${DB}?ssl=true`],
    ["option names are case-insensitive", `mongodb://u:p@db0.example.invalid/${DB}?TLS=TRUE`],
    ["explicit tls=true on mongodb+srv", `mongodb+srv://u:p@cluster.example.invalid/${DB}?tls=true`],
    ["no credentials in the URI", `mongodb+srv://cluster.example.invalid/${DB}`],
    ["explicit weakening options set to false", `mongodb://u:p@db0.example.invalid/${DB}?tls=true&tlsInsecure=false`],
  ]) {
    it(`accepts ${label} and returns the URI unchanged`, () => {
      const target = validateBootstrapTarget({ uri, expectedDb: DB });
      assert.equal(target.uri, uri, "the validated string must be the exact string returned");
      assert.equal(target.database, DB);
    });
  }

  it("preserves every host of a multi-host seed list", () => {
    assert.equal(parseMongoUri(MULTI).hosts.length, 3);
    assert.equal(validateBootstrapTarget({ uri: MULTI, expectedDb: DB }).hostCount, 3);
  });

  it("matches a percent-encoded database name by its decoded value", () => {
    const target = validateBootstrapTarget({
      uri: "mongodb+srv://cluster.example.invalid/bootstrap%5Ffixture",
      expectedDb: DB,
    });
    assert.equal(target.database, DB);
  });
});

describe("validateBootstrapTarget: expected database name (mandatory, independent)", () => {
  for (const [label, expectedDb] of [
    ["missing", undefined],
    ["null", null],
    ["empty string", ""],
    ["boolean (bare --expect-db)", true],
    ["a number", 42],
  ]) {
    it(`refuses when the expected name is ${label}`, () => {
      assert.throws(() => validateBootstrapTarget({ uri: SRV, expectedDb }), refusal(/expected database name is required/));
    });
  }

  for (const [label, expectedDb] of [
    ["a different name", "other_fixture"],
    ["a case variant", "Bootstrap_Fixture"],
    ["a prefix of the real name", "bootstrap"],
    ["the name with a trailing space", `${DB} `],
  ]) {
    it(`refuses a mismatch: ${label}`, () => {
      assert.throws(() => validateBootstrapTarget({ uri: SRV, expectedDb }), (err) => {
        assert.ok(err instanceof TargetValidationError);
        assert.ok(!/fixture_pass|example\.invalid/.test(err.message));
        return true;
      });
    });
  }

  it("states a mismatch in terms of the two database names only", () => {
    assert.throws(
      () => validateBootstrapTarget({ uri: SRV, expectedDb: "other_fixture" }),
      refusal(/does not match the expected database "other_fixture"/),
    );
  });
});

describe("validateBootstrapTarget: URI shape", () => {
  for (const [label, uri, pattern] of [
    ["missing", undefined, /missing or not a string/],
    ["empty", "", /missing or not a string/],
    ["not a string", 123, /missing or not a string/],
    ["leading whitespace", ` ${SRV}`, /whitespace/],
    ["trailing whitespace", `${SRV} `, /whitespace/],
    ["embedded whitespace", `mongodb+srv://cluster.example.invalid/${DB} x`, /whitespace/],
    ["http scheme", `http://cluster.example.invalid/${DB}`, /scheme is not supported/],
    ["no scheme", `cluster.example.invalid/${DB}`, /scheme is not supported/],
    ["mongodb scheme with wrong case", `MONGODB://db.example.invalid/${DB}?tls=true`, /scheme is not supported/],
    ["empty host list", `mongodb://u:p@/${DB}?tls=true`, /no host/],
    ["invalid host characters", `mongodb://db_0.example.invalid/${DB}?tls=true`, /invalid host/],
    ["empty host entry in a list", `mongodb://a.example.invalid,,b.example.invalid/${DB}?tls=true`, /invalid host/],
    ["port out of range", `mongodb://a.example.invalid:70000/${DB}?tls=true`, /invalid port/],
    ["port zero", `mongodb://a.example.invalid:0/${DB}?tls=true`, /invalid port/],
    ["unix domain socket", `mongodb://%2Ftmp%2Fmongodb-27017.sock/${DB}?tls=true`, /invalid host/],
    ["srv with a port", `mongodb+srv://cluster.example.invalid:27017/${DB}`, /exactly one host and no port/],
    ["srv with several hosts", `mongodb+srv://a.example.invalid,b.example.invalid/${DB}`, /exactly one host and no port/],
    ["no path at all", "mongodb+srv://cluster.example.invalid", /no database name/],
    ["slash but empty database", "mongodb+srv://cluster.example.invalid/", /no database name/],
    ["options but no database", "mongodb+srv://cluster.example.invalid/?retryWrites=true", /no database name/],
    ["query without a path", "mongodb+srv://cluster.example.invalid?retryWrites=true", /no database name/],
    ["database with a nested path", `mongodb+srv://cluster.example.invalid/${DB}/extra`, /not a valid MongoDB database name/],
    ["database with a dot", "mongodb+srv://cluster.example.invalid/bootstrap.fixture", /not a valid MongoDB database name/],
    ["database with an encoded space", "mongodb+srv://cluster.example.invalid/bootstrap%20fixture", /not a valid MongoDB database name/],
    ["database with bad percent-encoding", "mongodb+srv://cluster.example.invalid/%E0%A4%A", /percent-encoding/],
    ["options with bad percent-encoding", `mongodb+srv://cluster.example.invalid/${DB}?x=%E0%A4%A`, /percent-encoding/],
  ]) {
    it(`refuses a malformed/unsupported URI: ${label}`, () => {
      assert.throws(() => validateBootstrapTarget({ uri, expectedDb: DB }), refusal(pattern));
    });
  }
});

describe("validateBootstrapTarget: loopback and unspecified hosts", () => {
  for (const host of [
    "localhost",
    "LOCALHOST",
    "db.localhost",
    "127.0.0.1",
    "127.255.0.9",
    "0.0.0.0",
    "[::1]",
    "[::]",
    // Equivalent spellings that resolve to loopback/unspecified (#109 review).
    "[0:0:0:0:0:0:0:1]",
    "[0:0:0:0:0:0:0:0]",
    "[::ffff:127.0.0.1]",
    "[::FFFF:127.0.0.1]",
    "[::ffff:7f00:1]",
    "[::ffff:7f12:3456]",
    "[0:0:0:0:0:ffff:127.0.0.1]",
    "[::ffff:0.0.0.0]",
    "[::ffff:0:0]",
    "[::127.0.0.1]",
    "127.1",
    "127.0.1",
    "0x7f.1",
    "0177.0.0.1",
    "2130706433",
    "0x7f000001",
    "0",
  ]) {
    it(`refuses ${host}`, () => {
      assert.throws(
        () => validateBootstrapTarget({ uri: `mongodb://u:p@${host}:27017/${DB}?tls=true`, expectedDb: DB }),
        refusal(/loopback or unspecified host/),
      );
    });
  }

  it("refuses a seed list when ANY member is loopback", () => {
    assert.throws(
      () =>
        validateBootstrapTarget({
          uri: `mongodb://a.example.invalid:27017,127.0.0.1:27017/${DB}?tls=true`,
          expectedDb: DB,
        }),
      refusal(/loopback or unspecified host/),
    );
  });

  for (const host of ["[2001:db8::1]", "[::ffff:8.8.8.8]", "[::ffff:808:808]", "[fe80::1]", "8.8.8.8", "10.0.0.5", "128.0.0.1", "126.255.255.255"]) {
    it(`still accepts the non-loopback host ${host}`, () => {
      const uri = `mongodb://u:p@${host}:27017/${DB}?tls=true`;
      assert.equal(validateBootstrapTarget({ uri, expectedDb: DB }).uri, uri);
    });
  }

  for (const host of ["[:::]", "[1:2:3]", "[1::2::3]", "[::ffff:999.1.1.1]", "[12345::1]", "[::g]"]) {
    it(`refuses the invalid IPv6 literal ${host}`, () => {
      assert.throws(
        () => validateBootstrapTarget({ uri: `mongodb://u:p@${host}:27017/${DB}?tls=true`, expectedDb: DB }),
        refusal(/invalid (IPv6 host literal|host entry)/),
      );
    });
  }

  it("does not mistake look-alike remote names for loopback", () => {
    for (const host of ["127.example.invalid", "0x7f.example.invalid", "localhost.example.invalid", "1.example.invalid"]) {
      const uri = `mongodb://${host}:27017/${DB}?tls=true`;
      assert.equal(validateBootstrapTarget({ uri, expectedDb: DB }).uri, uri);
    }
  });
});

describe("validateBootstrapTarget: TLS posture (fail closed)", () => {
  for (const [label, uri, pattern] of [
    ["mongodb:// without tls", `mongodb://u:p@db0.example.invalid:27017/${DB}`, /without "tls=true"/],
    ["mongodb:// with other options but no tls", `mongodb://u:p@db0.example.invalid/${DB}?replicaSet=rs0`, /without "tls=true"/],
    ["mongodb:// with tls=false", `mongodb://u:p@db0.example.invalid/${DB}?tls=false`, /disables TLS/],
    ["mongodb:// with ssl=false", `mongodb://u:p@db0.example.invalid/${DB}?ssl=false`, /disables TLS/],
    ["mongodb+srv with tls=false", `mongodb+srv://cluster.example.invalid/${DB}?tls=false`, /disables TLS/],
    ["mongodb+srv with ssl=false", `mongodb+srv://cluster.example.invalid/${DB}?ssl=false`, /disables TLS/],
    ["non-boolean tls value", `mongodb://u:p@db0.example.invalid/${DB}?tls=yes`, /must be "true" or "false"/],
    ["empty tls value", `mongodb://u:p@db0.example.invalid/${DB}?tls=`, /must be "true" or "false"/],
    ["tls and ssl disagree", `mongodb://u:p@db0.example.invalid/${DB}?tls=true&ssl=false`, /conflict/],
    ["duplicate tls with conflicting values", `mongodb://u:p@db0.example.invalid/${DB}?tls=true&tls=false`, /conflicting values/],
    ["tlsInsecure=true", `mongodb+srv://cluster.example.invalid/${DB}?tlsInsecure=true`, /weakens TLS/],
    ["tlsAllowInvalidCertificates=true", `mongodb://u:p@db0.example.invalid/${DB}?tls=true&tlsAllowInvalidCertificates=true`, /weakens TLS/],
    ["tlsAllowInvalidHostnames=true", `mongodb://u:p@db0.example.invalid/${DB}?tls=true&tlsAllowInvalidHostnames=true`, /weakens TLS/],
    ["a weakening option with an unrecognised value", `mongodb+srv://cluster.example.invalid/${DB}?tlsInsecure=maybe`, /must be "true" or "false"/],
  ]) {
    it(`refuses ${label}`, () => {
      assert.throws(() => validateBootstrapTarget({ uri, expectedDb: DB }), refusal(pattern));
    });
  }
});

describe("validateBootstrapTarget: development/test/E2E/system denylist", () => {
  for (const name of [
    "aquaveda_v2",
    "AquaVeda_V2",
    "aquaveda_v2_dev",
    "aquaveda_v2_test",
    "aquaveda_v2_e2e",
    "app_dev",
    "app-dev",
    "dev",
    "development",
    "app_development_data",
    "testing_db",
    "my_tests",
    "local_data",
    "E2E",
    "test",
    "admin",
    "local",
    "config",
  ]) {
    it(`refuses the database name "${name}" even when URI and expected name agree`, () => {
      assert.throws(
        () =>
          validateBootstrapTarget({
            uri: `mongodb+srv://u:p@cluster.example.invalid/${name}`,
            expectedDb: name,
          }),
        refusal(/development|test|system/),
      );
    });
  }

  it("refuses when only the expected name is on the denylist (and the URI differs)", () => {
    assert.throws(
      () => validateBootstrapTarget({ uri: SRV, expectedDb: "aquaveda_v2_test" }),
      refusal(/expected database "aquaveda_v2_test"/),
    );
  });

  it("refuses when only the URI database is on the denylist", () => {
    assert.throws(
      () => validateBootstrapTarget({ uri: `mongodb+srv://cluster.example.invalid/app_dev`, expectedDb: DB }),
      refusal(/MONGO_URI database "app_dev"/),
    );
  });

  for (const name of ["bootstrap_fixture", "primary", "contest", "latest", "attestation", "device", "protest_log"]) {
    it(`does not over-block the ordinary name "${name}" (token match, not substring)`, () => {
      assert.equal(denyReasonForDatabaseName(name), null);
    });
  }
});

describe("validateBootstrapTarget: nothing is derived from the URI or hard-coded", () => {
  it("never infers the expected name from the URI", () => {
    assert.throws(() => validateBootstrapTarget({ uri: SRV }), refusal(/expected database name is required/));
  });

  it("does not special-case any production database name", () => {
    // Any ordinary, consistent, TLS-capable, non-denied name is accepted; the
    // validator holds no notion of "the" production database.
    for (const name of ["alpha", "beta_service", "x1"]) {
      const uri = `mongodb+srv://cluster.example.invalid/${name}`;
      assert.equal(validateBootstrapTarget({ uri, expectedDb: name }).database, name);
    }
  });
});
