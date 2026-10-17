/**
 * Production ADMIN bootstrap target validation (#109).
 *
 * Pure and dependency-free: no I/O, no environment access, no connection. It
 * decides whether a (URI, expected database name) pair is acceptable BEFORE the
 * CLI is allowed to open a database connection.
 *
 * What this proves, and what it does not
 *   - It proves CONSISTENCY: the operator supplied the target database name
 *     twice, independently (inside the URI, and as `--expect-db` /
 *     `BOOTSTRAP_EXPECTED_DB`), the two agree exactly, and the name is not a
 *     known development/test/E2E/system database.
 *   - It does NOT prove IDENTITY: the repository contains no source of truth
 *     for the real production database name, so nothing here can tell whether
 *     two consistent values are the *right* ones. See the runbook.
 *
 * Supported URI formats are exactly those documented in
 * docs/ops/production-admin-bootstrap.md: `mongodb+srv://` and `mongodb://`
 * (including multi-host replica-set seed lists), over TLS. Anything else is
 * refused (fail closed). Error messages never contain the URI, hosts, or
 * credentials.
 */

export class TargetValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetValidationError";
  }
}

/** Documented development default (server/README.md) plus MongoDB system/default databases. */
export const DENIED_EXACT_DATABASE_NAMES = Object.freeze(["aquaveda_v2", "test", "admin", "local", "config"]);

/** Any `_`/`-`-delimited token marking a dev, test, E2E or local database. */
export const DENIED_DATABASE_NAME_TOKENS = Object.freeze([
  "dev",
  "development",
  "test",
  "tests",
  "testing",
  "e2e",
  "local",
  "localhost",
]);

/** TLS-weakening options; refused unless explicitly `false`. */
const TLS_WEAKENING_OPTIONS = ["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"];

const HOST_PATTERN = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/;
const FORBIDDEN_DATABASE_CHARS = /[/\\. "$*<>:|?\0]/;

function refuse(message) {
  return new TargetValidationError(message);
}

/**
 * Parses an IPv6 literal (without brackets) into 16 bytes, or null when it is
 * not a valid IPv6 address. Handles `::` compression and a trailing dotted
 * IPv4 part (e.g. `::ffff:127.0.0.1`).
 */
export function parseIpv6(text) {
  let s = text;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((o) => o > 255)) return null;
    const hex = (a, b) => ((a << 8) | b).toString(16);
    s = `${dotted[1]}${hex(octets[0], octets[1])}:${hex(octets[2], octets[3])}`;
  }
  if (!/^[0-9a-fA-F:]+$/.test(s) || s.includes(":::")) return null;

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const total = head.length + tail.length;
  if (halves.length === 1 ? total !== 8 : total > 7) return null;

  const groups = [...head, ...Array(8 - total).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const value = parseInt(g, 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  });
  return bytes;
}

/**
 * Parses every IPv4 form the platform resolver (inet_aton) accepts: 1-4 parts,
 * each decimal, octal (leading 0) or hex (0x), the last part filling the
 * remaining bytes. So `127.1`, `0x7f.1`, `0177.0.0.1` and `2130706433` are all
 * 127.0.0.1. Returns the 32-bit value, or null when `host` is not such a
 * literal (i.e. it is an ordinary host name).
 */
export function parseIpv4Literal(host) {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const values = [];
  for (const part of parts) {
    let value;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part, 16);
    else if (/^0[0-7]*$/.test(part)) value = parseInt(part, 8);
    else if (/^[1-9][0-9]*$/.test(part)) value = parseInt(part, 10);
    else return null;
    values.push(value);
  }
  const last = values[values.length - 1];
  const leading = values.slice(0, -1);
  if (leading.some((v) => v > 255) || last >= 256 ** (4 - leading.length)) return null;
  return leading.reduce((acc, v, i) => acc + v * 256 ** (3 - i), 0) + last;
}

function isLoopbackOrUnspecifiedIpv4(value) {
  const firstOctet = Math.floor(value / 2 ** 24);
  return firstOctet === 127 || firstOctet === 0;
}

function isLoopbackOrUnspecified(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;

  if (h.startsWith("[")) {
    const bytes = parseIpv6(h.slice(1, -1));
    if (bytes === null) return false; // rejected earlier as an invalid host
    const zeros = (from, to) => bytes.slice(from, to).every((b) => b === 0);
    if (zeros(0, 16)) return true; // ::  (unspecified)
    if (zeros(0, 15) && bytes[15] === 1) return true; // ::1
    const embedded = bytes[12] * 2 ** 24 + bytes[13] * 2 ** 16 + bytes[14] * 2 ** 8 + bytes[15];
    const mapped = zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff; // ::ffff:a.b.c.d
    const compatible = zeros(0, 12); // deprecated ::a.b.c.d
    return (mapped || compatible) && isLoopbackOrUnspecifiedIpv4(embedded);
  }

  const v4 = parseIpv4Literal(h);
  return v4 !== null && isLoopbackOrUnspecifiedIpv4(v4);
}

/**
 * Parses only the documented MongoDB URI shapes. Throws on anything else.
 * Never echoes input in its errors.
 *
 * @param {unknown} uri
 */
export function parseMongoUri(uri) {
  if (typeof uri !== "string" || uri === "") {
    throw refuse("MONGO_URI is missing or not a string.");
  }
  if (/\s/.test(uri)) {
    throw refuse("MONGO_URI is not a valid MongoDB URI (whitespace is not allowed).");
  }

  const schemeMatch = /^(mongodb\+srv|mongodb):\/\/(.*)$/s.exec(uri);
  if (!schemeMatch) {
    throw refuse('MONGO_URI scheme is not supported; only "mongodb+srv://" and "mongodb://" are allowed.');
  }
  const scheme = schemeMatch[1];
  const rest = schemeMatch[2];

  const authorityEnd = rest.search(/[/?]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const tail = authorityEnd === -1 ? "" : rest.slice(authorityEnd);

  const at = authority.lastIndexOf("@");
  const hostList = at === -1 ? authority : authority.slice(at + 1);
  if (hostList === "") {
    throw refuse("MONGO_URI has no host.");
  }

  const hosts = hostList.split(",").map((entry) => {
    const m = HOST_PATTERN.exec(entry);
    if (!m) throw refuse("MONGO_URI contains an invalid host entry.");
    if (m[1].startsWith("[") && parseIpv6(m[1].slice(1, -1)) === null) {
      throw refuse("MONGO_URI contains an invalid IPv6 host literal.");
    }
    const port = m[2] === undefined ? null : Number(m[2]);
    if (port !== null && (port < 1 || port > 65535)) {
      throw refuse("MONGO_URI contains an invalid port.");
    }
    return { host: m[1], port };
  });

  if (scheme === "mongodb+srv" && (hosts.length !== 1 || hosts[0].port !== null)) {
    throw refuse('"mongodb+srv://" requires exactly one host and no port.');
  }

  // Path (database) and query (options).
  let pathPart = "";
  let query = "";
  if (tail.startsWith("/")) {
    const q = tail.indexOf("?");
    pathPart = q === -1 ? tail.slice(1) : tail.slice(1, q);
    query = q === -1 ? "" : tail.slice(q + 1);
  } else if (tail.startsWith("?")) {
    query = tail.slice(1);
  }

  if (pathPart === "") {
    throw refuse("MONGO_URI has no database name.");
  }
  let database;
  try {
    database = decodeURIComponent(pathPart);
  } catch {
    throw refuse("MONGO_URI database name is not valid percent-encoding.");
  }

  /** @type {Map<string, string[]>} option names are case-insensitive */
  const options = new Map();
  if (query !== "") {
    for (const pair of query.split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      let key;
      let value;
      try {
        key = decodeURIComponent(rawKey).toLowerCase();
        value = decodeURIComponent(rawValue);
      } catch {
        throw refuse("MONGO_URI options are not valid percent-encoding.");
      }
      options.set(key, [...(options.get(key) ?? []), value]);
    }
  }

  return { scheme, hosts, database, options };
}

/** Reads a boolean-valued option; throws on anything but a single, consistent true/false. */
function readBooleanOption(options, key) {
  const values = options.get(key);
  if (values === undefined) return undefined;
  const normalized = values.map((v) => v.toLowerCase());
  if (!normalized.every((v) => v === "true" || v === "false")) {
    throw refuse(`MONGO_URI option "${key}" must be "true" or "false".`);
  }
  if (new Set(normalized).size !== 1) {
    throw refuse(`MONGO_URI option "${key}" is specified with conflicting values.`);
  }
  return normalized[0] === "true";
}

/**
 * Requires a TLS posture that can be established from the URI itself.
 *   - mongodb+srv: TLS is the driver default; only an explicit disable is refused.
 *   - mongodb:     TLS is NOT the default, so `tls=true` (or `ssl=true`) must be explicit.
 * Certificate/hostname-verification bypass options are refused in both cases.
 */
function assertTlsPosture(scheme, options) {
  const tls = readBooleanOption(options, "tls");
  const ssl = readBooleanOption(options, "ssl");
  if (tls !== undefined && ssl !== undefined && tls !== ssl) {
    throw refuse('MONGO_URI options "tls" and "ssl" conflict.');
  }
  const explicit = tls ?? ssl;

  if (explicit === false) {
    throw refuse("MONGO_URI disables TLS; production bootstrap requires TLS.");
  }
  if (scheme === "mongodb" && explicit !== true) {
    throw refuse('MONGO_URI uses "mongodb://" without "tls=true"; the TLS requirement cannot be established.');
  }

  for (const key of TLS_WEAKENING_OPTIONS) {
    if (!options.has(key)) continue;
    const weakening = readBooleanOption(options, key);
    if (weakening !== false) {
      throw refuse("MONGO_URI weakens TLS verification, which is not allowed for production bootstrap.");
    }
  }
}

/** Returns the reason a database name is denied, or null if it is allowed. */
export function denyReasonForDatabaseName(name) {
  const lower = name.toLowerCase();
  if (DENIED_EXACT_DATABASE_NAMES.includes(lower)) {
    return "is a development, test or system database name";
  }
  const tokens = lower.split(/[_\-.]+/).filter(Boolean);
  const hit = tokens.find((t) => DENIED_DATABASE_NAME_TOKENS.includes(t));
  if (hit) {
    return `contains the development/test marker "${hit}"`;
  }
  return null;
}

function assertValidDatabaseName(name, label) {
  if (name === "" || FORBIDDEN_DATABASE_CHARS.test(name) || Buffer.byteLength(name) > 63) {
    throw refuse(`${label} is not a valid MongoDB database name.`);
  }
}

/**
 * Validates the production bootstrap target. Throws TargetValidationError on
 * ANY problem; returns a frozen description only when every rule passes.
 *
 * `uri` is returned unchanged: callers must connect with exactly this string,
 * never a normalised or re-derived copy.
 *
 * @param {{ uri: unknown, expectedDb: unknown }} input
 * @returns {Readonly<{ uri: string, database: string, scheme: string, hostCount: number }>}
 */
export function validateBootstrapTarget({ uri, expectedDb }) {
  if (typeof expectedDb !== "string" || expectedDb === "") {
    throw refuse(
      "the expected database name is required: pass --expect-db or set BOOTSTRAP_EXPECTED_DB, " +
        "supplied independently of MONGO_URI.",
    );
  }

  const parsed = parseMongoUri(uri);

  assertValidDatabaseName(parsed.database, "MONGO_URI database name");
  assertValidDatabaseName(expectedDb, "The expected database name");

  const loopback = parsed.hosts.find((h) => isLoopbackOrUnspecified(h.host));
  if (loopback) {
    throw refuse("MONGO_URI targets a loopback or unspecified host, which is not a documented production topology.");
  }

  assertTlsPosture(parsed.scheme, parsed.options);

  for (const [label, name] of [
    ["MONGO_URI database", parsed.database],
    ["expected database", expectedDb],
  ]) {
    const reason = denyReasonForDatabaseName(name);
    if (reason) {
      throw refuse(`${label} "${name}" ${reason}.`);
    }
  }

  if (parsed.database !== expectedDb) {
    throw refuse(
      `MONGO_URI database "${parsed.database}" does not match the expected database "${expectedDb}" (exact, case-sensitive match required).`,
    );
  }

  return Object.freeze({
    uri,
    database: parsed.database,
    scheme: parsed.scheme,
    hostCount: parsed.hosts.length,
  });
}
