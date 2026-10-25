/**
 * EXP-L9+ / EXP-L10+ — pure contract tests (no database): the shared domain
 * module, Zod/validator agreement, Mongoose casting of the decision filter and
 * the model's enum guard. DB-backed behaviour lives in the service/route tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import mongoose from "mongoose";

import * as domain from "../src/domain/expert-application-submission.js";
import {
  applyExpertApplicationSchema,
  approveExpertApplicationSchema,
  rejectExpertApplicationSchema,
} from "../src/validation/expert-application.validation.js";
import { decisionFilter } from "../src/services/expert-application.service.js";
import { User } from "../src/models/User.js";

const {
  validateSubmission,
  validateDecisionNote,
  normalizeReferenceUrl,
  isValidRevision,
  ACKNOWLEDGEMENT_TEXTS,
  EXPERTISE_VALUES,
} = domain;

const good = () => ({
  expertiseAreas: ["groundwater_wells"],
  experience: "x".repeat(80),
  acknowledgement: { version: 1 },
});

describe("domain module is shareable with the frontend", () => {
  it("has ZERO imports (no node:*, mongoose, express, zod): a backend dependency cannot creep into the frontend bundle", () => {
    const src = readFileSync(new URL("../src/domain/expert-application-submission.js", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /^\s*import\s/m);
    assert.doesNotMatch(code, /\brequire\s*\(/);
    assert.doesNotMatch(code, /\bimport\s*\(/);
    assert.doesNotMatch(code, /\bprocess\b|\bBuffer\b/);
  });

  it("pins the SHA-256 of every shipped acknowledgement text (editing a shipped version fails CI; add a new version instead)", () => {
    const PINNED = { 1: "c017f9f397c9bcd5988697477ae03505ddebbe19fb1f295cf5ba29bb31ced30e" };
    assert.deepEqual(Object.keys(ACKNOWLEDGEMENT_TEXTS).sort(), Object.keys(PINNED).sort(), "a new version must be pinned here");
    for (const [version, digest] of Object.entries(PINNED)) {
      assert.equal(createHash("sha256").update(ACKNOWLEDGEMENT_TEXTS[version], "utf8").digest("hex"), digest);
    }
    assert.ok(Object.isFrozen(ACKNOWLEDGEMENT_TEXTS));
  });

  it("expertise keys are stable, unique, snake_case; labels exist", () => {
    assert.equal(new Set(EXPERTISE_VALUES).size, EXPERTISE_VALUES.length);
    assert.ok(EXPERTISE_VALUES.every((v) => /^[a-z]+(_[a-z]+)*$/.test(v)));
    assert.ok(domain.EXPERTISE_AREAS.every((a) => a.label && a.description));
    assert.ok(EXPERTISE_VALUES.includes("other"));
  });
});

describe("validateSubmission vectors", () => {
  const accept = [
    ["minimal", good()],
    ["3 areas", { ...good(), expertiseAreas: ["other", "policy_governance", "groundwater_wells"] }],
    ["exactly 80 chars", { ...good(), experience: "x".repeat(80) }],
    ["exactly 1000 chars", { ...good(), experience: "x".repeat(1000) }],
    ["120-char affiliation", { ...good(), affiliation: "a".repeat(120) }],
    ["3 references", { ...good(), references: ["https://a.org", "https://b.org", "https://c.org"] }],
    ["whitespace around experience is trimmed to 80", { ...good(), experience: `  ${"x".repeat(80)}  ` }],
  ];
  const reject = [
    ["non-object", "nope"],
    ["array body", []],
    ["unknown key", { ...good(), role: "EXPERT" }],
    ["areas missing", { ...good(), expertiseAreas: undefined }],
    ["areas not array", { ...good(), expertiseAreas: "other" }],
    ["0 areas", { ...good(), expertiseAreas: [] }],
    ["4 areas", { ...good(), expertiseAreas: ["other", "policy_governance", "groundwater_wells", "wastewater_sanitation"] }],
    ["unsupported area", { ...good(), expertiseAreas: ["astrology"] }],
    ["duplicate area", { ...good(), expertiseAreas: ["other", "other"] }],
    ["non-string area", { ...good(), expertiseAreas: [1] }],
    ["experience missing", { ...good(), experience: undefined }],
    ["79 chars", { ...good(), experience: "x".repeat(79) }],
    ["80 chars but 79 after trim", { ...good(), experience: ` ${"x".repeat(79)} ` }],
    ["1001 chars", { ...good(), experience: "x".repeat(1001) }],
    ["empty affiliation", { ...good(), affiliation: "   " }],
    ["121-char affiliation", { ...good(), affiliation: "a".repeat(121) }],
    ["non-string affiliation", { ...good(), affiliation: 5 }],
    ["references not list", { ...good(), references: "https://a.org" }],
    ["4 references", { ...good(), references: ["https://a.org", "https://b.org", "https://c.org", "https://d.org"] }],
    ["http reference", { ...good(), references: ["http://a.org"] }],
    ["acknowledgement missing", { ...good(), acknowledgement: undefined }],
    ["acknowledgement not object", { ...good(), acknowledgement: true }],
    ["stale version", { ...good(), acknowledgement: { version: 0 } }],
    ["future version", { ...good(), acknowledgement: { version: 2 } }],
    ["string version", { ...good(), acknowledgement: { version: "1" } }],
    ["client-supplied acceptedAt", { ...good(), acknowledgement: { version: 1, acceptedAt: "2020-01-01" } }],
    ["client-supplied hash", { ...good(), acknowledgement: { version: 1, textSha256: "abc" } }],
    ["client-supplied text", { ...good(), acknowledgement: { version: 1, text: "I agree" } }],
  ];
  for (const [name, input] of accept) {
    it(`accepts: ${name}`, () => assert.equal(validateSubmission(input).ok, true));
  }
  for (const [name, input] of reject) {
    it(`rejects: ${name}`, () => assert.equal(validateSubmission(input).ok, false));
  }

  it("normalizes: trims text, CRLF to LF, de-duplicates normalized references, omits absent affiliation", () => {
    const r = validateSubmission({
      ...good(),
      experience: `${"a".repeat(40)}\r\n${"b".repeat(40)}  `,
      references: ["https://EXAMPLE.org", "https://example.org/", " https://example.org/x "],
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.experience, `${"a".repeat(40)}\n${"b".repeat(40)}`);
    assert.deepEqual(r.value.references, ["https://example.org/", "https://example.org/x"]);
    assert.equal("affiliation" in r.value, false);
    assert.deepEqual(r.value.acknowledgement, { version: 1 });
  });

  it("is idempotent: the normalized value re-validates to an equal value (so the route can pass parsed.data to the service)", () => {
    for (const [, input] of accept) {
      const first = validateSubmission(input);
      assert.equal(first.ok, true);
      const again = validateSubmission(first.value);
      assert.equal(again.ok, true);
      assert.deepEqual(again.value, first.value);
      // and through the Zod adapter, exactly as the route does it
      const viaRoute = applyExpertApplicationSchema.parse(input);
      assert.deepEqual(validateSubmission(viaRoute).value, viaRoute);
    }
    const messy = validateSubmission({
      ...good(),
      experience: `${"a".repeat(40)}\r\n${"b".repeat(45)}  `,
      affiliation: "  Trust  ",
      references: ["https://EXAMPLE.org", "https://example.org/", " https://example.org/x "],
    });
    assert.deepEqual(validateSubmission(messy.value).value, messy.value);
  });

  it("reports errors per field (keys are field paths)", () => {
    const r = validateSubmission({ ...good(), references: ["https://ok.org", "http://bad.org"], affiliation: "" });
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ["affiliation", "references.1"]);
  });
});

describe("normalizeReferenceUrl", () => {
  for (const bad of [
    "", "   ", 5, null, "not a url", "http://a.org", "ftp://a.org", "javascript:alert(1)", "data:text/html,x",
    "https://user@a.org", "https://user:pw@a.org", "https://", `https://a.org/${"x".repeat(2100)}`,
  ]) {
    it(`rejects ${JSON.stringify(typeof bad === "string" ? bad.slice(0, 30) : bad)}`, () => {
      assert.equal(normalizeReferenceUrl(bad).ok, false);
    });
  }
  it("accepts https and returns the parsed href", () => {
    assert.deepEqual(normalizeReferenceUrl(" https://Example.org/a b "), { ok: true, value: "https://example.org/a%20b" });
  });
});

describe("decision notes and revision", () => {
  const reject = (n) => validateDecisionNote(n, { required: true });
  const approve = (n) => validateDecisionNote(n, { required: false });
  it("reject: required; trim-then-validate; boundaries 9/10/500/501; whitespace-only", () => {
    assert.equal(reject(undefined).ok, false);
    assert.equal(reject("          ").ok, false);
    assert.equal(reject("123456789").ok, false);
    assert.equal(reject("  123456789  ").ok, false);
    assert.deepEqual(reject("  0123456789  "), { ok: true, value: "0123456789" });
    assert.equal(reject("x".repeat(500)).ok, true);
    assert.equal(reject("x".repeat(501)).ok, false);
    assert.equal(reject(5).ok, false);
  });
  it("approve: optional; when present trimmed 1..500; whitespace-only is an error", () => {
    assert.deepEqual(approve(undefined), { ok: true, value: undefined });
    assert.equal(approve("   ").ok, false);
    assert.equal(approve("").ok, false);
    assert.deepEqual(approve(" Welcome "), { ok: true, value: "Welcome" });
    assert.equal(approve("x".repeat(500)).ok, true);
    assert.equal(approve("x".repeat(501)).ok, false);
  });
  it("revision: integer 1..10000 only", () => {
    for (const ok of [1, 2, 9999, 10_000]) assert.equal(isValidRevision(ok), true);
    for (const bad of [0, -1, 1.5, 10_001, "1", null, undefined, NaN, Infinity, {}]) assert.equal(isValidRevision(bad), false);
  });
});

describe("Zod schemas agree with the shared validator (single implementation)", () => {
  const vectors = [
    good(),
    { ...good(), role: "EXPERT" },
    { ...good(), expertiseAreas: [] },
    { ...good(), experience: "short" },
    { ...good(), references: ["http://a.org"] },
    { ...good(), acknowledgement: { version: 1, textSha256: "x" } },
    {},
    "nope",
  ];
  for (const [i, v] of vectors.entries()) {
    it(`apply vector ${i}`, () => {
      const direct = validateSubmission(v);
      const viaZod = applyExpertApplicationSchema.safeParse(v);
      assert.equal(viaZod.success, direct.ok);
      if (direct.ok) assert.deepEqual(viaZod.data, direct.value);
    });
  }

  it("reject schema: strict keys, revision required, note rules", () => {
    const s = rejectExpertApplicationSchema;
    assert.equal(s.safeParse({ revision: 1, note: "a long enough note" }).success, true);
    assert.deepEqual(s.safeParse({ revision: 1, note: "  a long enough note  " }).data, { revision: 1, note: "a long enough note" });
    for (const bad of [{}, { revision: 1 }, { note: "a long enough note" }, { revision: 1, note: "short" },
      { revision: 1, note: "a long enough note", role: "EXPERT" }, { revision: 1.5, note: "a long enough note" },
      { revision: "1", note: "a long enough note" }, null, undefined]) {
      assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });

  it("approve schema: strict keys, revision required, note optional", () => {
    const s = approveExpertApplicationSchema;
    assert.equal(s.safeParse({ revision: 3 }).success, true);
    assert.equal(s.safeParse({ revision: 3, note: " hi " }).data.note, "hi");
    for (const bad of [{}, { note: "hi" }, { revision: 3, note: "  " }, { revision: 3, role: "ADMIN" }, { revision: 0 }]) {
      assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

describe("decision filter: shape as cast by Mongoose (shape only; execution is a real-MongoDB merge gate)", () => {
  it("keeps status, role, id and the integer $size revision in ONE predicate", () => {
    const id = new mongoose.Types.ObjectId();
    const q = User.findOneAndUpdate(decisionFilter(String(id), 3), { $set: { role: "EXPERT" } });
    q._castConditions();
    const f = q.getFilter();
    assert.ok(f._id instanceof mongoose.Types.ObjectId && f._id.equals(id));
    assert.equal(f.role, "USER");
    assert.equal(f["expertApplication.status"], "pending");
    assert.deepEqual(f["expertApplication.history"], { $size: 3 });
    assert.equal(Object.keys(f).length, 4, "all guards in a single predicate, nothing dropped");
  });
});

describe("User model: submission guard (validation only, no DB)", () => {
  const user = (submission) =>
    new User({
      name: "T",
      email: "t@example.com",
      passwordHash: "x".repeat(12),
      expertApplication: {
        status: "pending",
        history: [{ fromStatus: null, toStatus: "pending", actor: new mongoose.Types.ObjectId(), submission }],
      },
    });
  const sub = (over = {}) => ({
    expertiseAreas: ["groundwater_wells"],
    experience: "x".repeat(80),
    references: [],
    acknowledgement: { version: 1, textSha256: "a".repeat(64), acceptedAt: new Date() },
    ...over,
  });

  it("accepts a valid submission and a legacy entry without one", () => {
    assert.equal(user(sub()).validateSync(), undefined);
    assert.equal(user(undefined).validateSync(), undefined);
    assert.equal(user(undefined).expertApplication.history[0].submission, undefined, "legacy stays absent, not defaulted");
  });
  it("rejects an area outside the canonical vocabulary and an over-long experience", () => {
    assert.ok(user(sub({ expertiseAreas: ["astrology"] })).validateSync());
    assert.ok(user(sub({ experience: "x".repeat(1001) })).validateSync());
  });
  it("an acknowledgement, when present, needs version, hash and time", () => {
    assert.ok(user(sub({ acknowledgement: { version: 1 } })).validateSync());
  });
});
