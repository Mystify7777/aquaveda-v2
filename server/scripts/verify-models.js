/**
 * Phase B model verification script.
 *
 * Verifies the five Phase B/D persistence models (User, Issue,
 * Knowledge, Comment, Project) against the locked architectural
 * decisions (persistence-design.md, ADR-0003 through ADR-0006), plus
 * the Session model added for the Authentication milestone
 * (decision-register.md's "Locked — Authentication" section, L8/L9/
 * L12/L13) — all at the schema level. Deliberately does NOT require a
 * MongoDB connection — every check here is schema introspection or
 * `validateSync()` on an unsaved document, both of which Mongoose
 * supports offline.
 *
 * This is a manual diagnostic script, not part of the formal test suite
 * (that's Phase F, per the implementation plan §21). Run with:
 *
 *   npm run verify:models
 *
 * or directly:
 *
 *   node scripts/verify-models.js
 */

import assert from "node:assert/strict";
import mongoose from "mongoose";

import { User } from "../src/models/User.js";
import { Issue } from "../src/models/Issue.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { Comment } from "../src/models/Comment.js";
import { Project } from "../src/models/Project.js";
import { Session } from "../src/models/Session.js";

const results = [];
let failures = 0;

function check(label, fn) {
  try {
    fn();
    results.push({ label, ok: true });
  } catch (err) {
    failures += 1;
    results.push({ label, ok: false, error: err.message });
  }
}

const fakeId = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------
// 1. All five models compile
// ---------------------------------------------------------------------
check("1a. User model compiles", () => {
  assert.equal(User.modelName, "User");
});
check("1b. Issue model compiles", () => {
  assert.equal(Issue.modelName, "Issue");
});
check("1c. Knowledge model compiles", () => {
  assert.equal(Knowledge.modelName, "Knowledge");
});
check("1d. Comment model compiles", () => {
  assert.equal(Comment.modelName, "Comment");
});
check("1e. Project model compiles", () => {
  assert.equal(Project.modelName, "Project");
});
check("1f. Session model compiles (Authentication milestone)", () => {
  assert.equal(Session.modelName, "Session");
});

// ---------------------------------------------------------------------
// 2. Expected indexes are registered (and only those — see #8)
// ---------------------------------------------------------------------

check("2a. User has unique email index", () => {
  const emailPath = User.schema.path("email");
  assert.equal(emailPath.options.unique, true, "email should be unique: true");
});

check("2b. Issue has 2dsphere/status/reportedBy indexes", () => {
  const idx = Issue.schema.indexes();
  const has2dsphere = idx.some(
    ([fields]) => fields.location === "2dsphere"
  );
  const hasStatus = idx.some(([fields]) => fields.status === 1);
  const hasReportedBy = idx.some(([fields]) => fields.reportedBy === 1);
  assert.ok(has2dsphere, "missing 2dsphere index on location");
  assert.ok(hasStatus, "missing index on status");
  assert.ok(hasReportedBy, "missing index on reportedBy");
});

check("2c. Knowledge has status/author indexes", () => {
  const idx = Knowledge.schema.indexes();
  assert.ok(idx.some(([f]) => f.status === 1), "missing index on status");
  assert.ok(idx.some(([f]) => f.author === 1), "missing index on author");
});

check("2d. Comment has compound (refType, refId) index", () => {
  const idx = Comment.schema.indexes();
  assert.ok(
    idx.some(([f]) => f.refType === 1 && f.refId === 1),
    "missing compound index on (refType, refId)"
  );
});

check("2e. Project has originIssue/contributors indexes", () => {
  const idx = Project.schema.indexes();
  assert.ok(
    idx.some(([f]) => f.originIssue === 1),
    "missing index on originIssue"
  );
  assert.ok(
    idx.some(([f]) => f.contributors === 1),
    "missing index on contributors"
  );
});

check("2f. Session has userId index", () => {
  const idx = Session.schema.indexes();
  assert.ok(
    idx.some(([f]) => f.userId === 1),
    "missing index on userId"
  );
});

check("2g. Session has a real MongoDB TTL index on expiresAt (expireAfterSeconds: 0), not merely an ordinary index", () => {
  const idx = Session.schema.indexes();
  const expiresEntry = idx.find(([f]) => f.expiresAt === 1);
  assert.ok(expiresEntry, "missing index on expiresAt");
  const [, options] = expiresEntry;
  assert.equal(
    options.expireAfterSeconds,
    0,
    "expiresAt index must be a TTL index with expireAfterSeconds: 0 " +
      "(deletes at the stored absolute timestamp itself), not just a " +
      "regular lookup index"
  );
});

// ---------------------------------------------------------------------
// 3. Issue coordinates: reject structural invalidity, accept valid pair
// ---------------------------------------------------------------------
function issueDoc(overrides = {}) {
  return new Issue({
    title: "Test issue",
    description: "Test description",
    location: { type: "Point", coordinates: [77.5, 12.9] },
    reportedBy: fakeId(),
    ...overrides,
  });
}

check("3a. Issue rejects coordinates with wrong length", () => {
  const doc = issueDoc({
    location: { type: "Point", coordinates: [77.5] },
  });
  const err = doc.validateSync();
  assert.ok(err, "expected validation error for 1-element coordinates");
  assert.ok(err.errors["location.coordinates"], "error should target coordinates");
});

check("3b. Issue rejects genuinely non-numeric coordinates", () => {
  // NOTE: an earlier version of this check used ["77.5", 12.9] and
  // incorrectly expected it to fail. It doesn't: Mongoose's [Number]
  // array type casts each element via Number(value) BEFORE the custom
  // structural validator runs. Number("77.5") succeeds (-> 77.5), so a
  // numeric-looking string is not actually a non-numeric input by the
  // time validation happens — see 3b-alt below, which documents this
  // explicitly instead of leaving it as a silent surprise.
  //
  // "abc" is genuinely non-castable: Number("abc") is NaN, which
  // Mongoose's Number caster treats as a cast failure.
  const doc = issueDoc({
    location: { type: "Point", coordinates: ["abc", 12.9] },
  });
  const err = doc.validateSync();
  assert.ok(err, "expected validation error for a non-castable coordinate value");
});

check("3b-alt. Numeric-looking strings ARE cast to numbers by Mongoose (documented, not a gap)", () => {
  // This is NOT a validation failure to fix — it's confirming and
  // recording actual Mongoose behavior so it isn't mistaken for a schema
  // defect again. "77.5" casts successfully to 77.5, so this Issue is
  // valid, even though the raw input contained a string.
  const doc = issueDoc({
    location: { type: "Point", coordinates: ["77.5", 12.9] },
  });
  const err = doc.validateSync();
  assert.equal(
    err,
    undefined,
    "numeric string coordinates should be cast successfully, not rejected"
  );
});

check("3c. Issue accepts a structurally valid coordinate pair", () => {
  const doc = issueDoc();
  const err = doc.validateSync();
  // Mongoose's documented contract: validateSync() returns `undefined`
  // on success, an Error (ValidationError) on failure. It does NOT
  // return `null`. Comparing to `null` here was a verifier bug, not a
  // schema defect — fixed after Phase B review confirmed the actual
  // return value.
  assert.equal(err, undefined, "structurally valid Issue should have no validation error");
});

check("3d. Issue does NOT reject out-of-range-but-structurally-valid coordinates", () => {
  // Confirms geographic range checking was deliberately left OUT of the
  // schema, per the Phase B review — this is a structural check only.
  const doc = issueDoc({
    location: { type: "Point", coordinates: [500, 500] },
  });
  const err = doc.validateSync();
  assert.equal(
    err,
    undefined,
    "out-of-range coordinates should NOT be rejected at schema level"
  );
});

// ---------------------------------------------------------------------
// 4. Knowledge rejection requires non-empty feedback
// ---------------------------------------------------------------------
function knowledgeDoc(overrides = {}) {
  return new Knowledge({
    title: "Test article",
    body: "Test body",
    author: fakeId(),
    ...overrides,
  });
}

check("4a. Rejected reviewHistory entry with empty feedback fails validation", () => {
  const doc = knowledgeDoc({
    reviewHistory: [{ decision: "rejected", reviewer: fakeId(), feedback: "" }],
  });
  const err = doc.validateSync();
  assert.ok(err, "expected validation error for empty rejection feedback");
});

check("4b. Rejected reviewHistory entry with whitespace-only feedback fails validation", () => {
  const doc = knowledgeDoc({
    reviewHistory: [{ decision: "rejected", reviewer: fakeId(), feedback: "   " }],
  });
  const err = doc.validateSync();
  assert.ok(err, "expected validation error for whitespace-only rejection feedback");
});

check("4c. Rejected reviewHistory entry with real feedback passes validation", () => {
  const doc = knowledgeDoc({
    reviewHistory: [
      { decision: "rejected", reviewer: fakeId(), feedback: "needs more sourcing" },
    ],
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "non-empty rejection feedback should pass");
});

check("4d. Approved reviewHistory entry does not require feedback", () => {
  const doc = knowledgeDoc({
    reviewHistory: [{ decision: "approved", reviewer: fakeId() }],
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "approval should not require feedback");
});

// ---------------------------------------------------------------------
// 5. passwordHash excluded from default queries/serialization
// ---------------------------------------------------------------------
check("5a. passwordHash path has select: false", () => {
  const path = User.schema.path("passwordHash");
  assert.equal(path.options.select, false);
});

check("5b. passwordHash stripped from toJSON output even when present in memory", () => {
  const doc = new User({
    name: "Test User",
    email: "test@example.com",
    passwordHash: "some-hash-value",
  });
  const json = doc.toJSON();
  assert.equal(
    Object.prototype.hasOwnProperty.call(json, "passwordHash"),
    false,
    "toJSON output should not contain passwordHash"
  );
});

check("5c. Session.tokenHash path has select: false (Authentication milestone, L12)", () => {
  const path = Session.schema.path("tokenHash");
  assert.equal(path.options.select, false);
});

check("5d. Session has no plaintext refresh-token field anywhere (only a hash is ever stored)", () => {
  // Guards against a future edit accidentally adding a raw `token` /
  // `refreshToken` field alongside `tokenHash` — the locked architecture
  // (decision-register.md L12) requires ONLY the hash to be persisted,
  // never the raw credential.
  const forbiddenNames = ["token", "refreshToken", "rawToken", "secret"];
  const actualFields = Object.keys(Session.schema.paths);
  for (const forbidden of forbiddenNames) {
    assert.ok(
      !actualFields.includes(forbidden),
      `Session must not have a plaintext-token-shaped field named "${forbidden}"`
    );
  }
});

// ---------------------------------------------------------------------
// 6. Immutable reference configuration is present
// ---------------------------------------------------------------------
check("6a. Issue.reportedBy is immutable: true", () => {
  assert.equal(Issue.schema.path("reportedBy").options.immutable, true);
});
check("6b. Knowledge.author is immutable: true", () => {
  assert.equal(Knowledge.schema.path("author").options.immutable, true);
});
check("6c. Project.originIssue is immutable: true", () => {
  assert.equal(Project.schema.path("originIssue").options.immutable, true);
});

// ---------------------------------------------------------------------
// 7. Embedded history schemas have the expected fields
// ---------------------------------------------------------------------
check("7a. Issue.statusHistory subdocument has exactly the expected fields", () => {
  const subSchema = Issue.schema.path("statusHistory").schema;
  const expected = ["_id", "fromStatus", "toStatus", "actor", "timestamp"].sort();
  const actual = Object.keys(subSchema.paths).sort();
  assert.deepEqual(actual, expected, `got fields: ${actual.join(", ")}`);
});

check("7b. Knowledge.reviewHistory subdocument has exactly the expected fields", () => {
  const subSchema = Knowledge.schema.path("reviewHistory").schema;
  const expected = ["_id", "decision", "reviewer", "feedback", "timestamp"].sort();
  const actual = Object.keys(subSchema.paths).sort();
  assert.deepEqual(actual, expected, `got fields: ${actual.join(", ")}`);
});

check("7c. Issue.statusHistory has NO resolvedBy/verifiedBy fields anywhere", () => {
  const subSchema = Issue.schema.path("statusHistory").schema;
  assert.equal(subSchema.path("resolvedBy"), undefined);
  assert.equal(subSchema.path("verifiedBy"), undefined);
});

check("7d. Knowledge schema has NO top-level reviewer field", () => {
  assert.equal(Knowledge.schema.path("reviewer"), undefined);
});

// ---------------------------------------------------------------------
// 8. No unexpected indexes or fields
// ---------------------------------------------------------------------
const IGNORED_TOP_LEVEL_FIELDS = new Set(["_id", "__v", "createdAt", "updatedAt"]);

function topLevelFields(schema) {
  return Object.keys(schema.paths)
    .filter((p) => !IGNORED_TOP_LEVEL_FIELDS.has(p))
    .sort();
}

check("8a. User has exactly the expected top-level fields", () => {
  const expected = [
    "name",
    "email",
    "passwordHash",
    "role",
    "bio",
    "expertApplication",
  ].sort();
  assert.deepEqual(topLevelFields(User.schema), expected);
});

check("8a-2. User.expertApplication: absent by default; status enum; history entry shape", () => {
  const u = new User({ name: "A", email: "a@example.test", passwordHash: "x" });
  assert.equal(u.expertApplication, undefined, "absence === never applied");
  const bad = new User({
    name: "A",
    email: "a@example.test",
    passwordHash: "x",
    expertApplication: { status: "verified", history: [] },
  });
  assert.ok(bad.validateSync()?.errors["expertApplication.status"], "unknown status rejected");
  const ok = new User({
    name: "A",
    email: "a@example.test",
    passwordHash: "x",
    expertApplication: {
      status: "pending",
      history: [{ fromStatus: null, toStatus: "pending", actor: "507f1f77bcf86cd799439011" }],
    },
  });
  assert.equal(ok.validateSync(), undefined);
  assert.equal(ok.expertApplication.history[0].fromStatus, null);
  const flat = ["reviewer", "verifiedBy", "approvedBy", "resolvedBy"];
  for (const f of flat) assert.equal(User.schema.path(f), undefined, `no flat ${f}`);
});

check("8b. Issue has exactly the expected top-level fields", () => {
  const expected = [
    "title",
    "description",
    "location",
    "severity",
    "category",
    "domain",
    "status",
    "reportedBy",
    "statusHistory",
  ].sort();
  assert.deepEqual(topLevelFields(Issue.schema), expected);
});

check("8c. Knowledge has exactly the expected top-level fields", () => {
  const expected = [
    "title",
    "body",
    "region",
    "status",
    "author",
    "reviewHistory",
  ].sort();
  assert.deepEqual(topLevelFields(Knowledge.schema), expected);
});

check("8d. Comment has exactly the expected top-level fields", () => {
  const expected = ["refType", "refId", "author", "body", "parentComment"].sort();
  assert.deepEqual(topLevelFields(Comment.schema), expected);
});

check("8e. Project has exactly the expected top-level fields", () => {
  const expected = [
    "title",
    "description",
    "originIssue",
    "creator",
    "contributors",
    "progress",
  ].sort();
  assert.deepEqual(topLevelFields(Project.schema), expected);
});

check("8f. Comment has no parentComment index (not proposed)", () => {
  const idx = Comment.schema.indexes();
  const hasParentCommentIndex = idx.some(
    ([fields]) => Object.keys(fields).length === 1 && "parentComment" in fields
  );
  assert.equal(hasParentCommentIndex, false, "parentComment should not be indexed");
});

check("8g. Project has no creator index (not proposed)", () => {
  const idx = Project.schema.indexes();
  const hasCreatorIndex = idx.some(
    ([fields]) => Object.keys(fields).length === 1 && "creator" in fields
  );
  assert.equal(hasCreatorIndex, false, "creator should not be indexed");
});

check("8h. Project has no status field (deferred per decision register)", () => {
  assert.equal(Project.schema.path("status"), undefined);
});

check("8i. Issue has no resolvedBy/verifiedBy top-level fields", () => {
  assert.equal(Issue.schema.path("resolvedBy"), undefined);
  assert.equal(Issue.schema.path("verifiedBy"), undefined);
});

check("8j. Exactly the expected six models are registered (five domain models plus Session; Recommendation is never persisted)", () => {
  const names = mongoose.modelNames();
  assert.ok(
    !names.includes("Recommendation"),
    "Recommendation should never be a persisted model"
  );
  assert.deepEqual(
    [...names].sort(),
    ["Comment", "Issue", "Knowledge", "Project", "Session", "User"].sort()
  );
});

check("8k. Session has exactly the expected top-level fields (Authentication milestone)", () => {
  const expected = ["userId", "tokenHash", "expiresAt"].sort();
  assert.deepEqual(topLevelFields(Session.schema), expected);
});

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
console.log("\nPhase B model verification\n" + "=".repeat(40));
for (const r of results) {
  console.log(`${r.ok ? "✔" : "✘"} ${r.label}${r.ok ? "" : `\n    ${r.error}`}`);
}
console.log("=".repeat(40));
console.log(`${results.length - failures}/${results.length} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
