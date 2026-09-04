/**
 * Phase C validation-layer verification script.
 *
 * Verifies the Zod request-shape schemas in isolation — pure input/output
 * checks via `.safeParse()`, no Mongoose, no MongoDB, no network. Mirrors
 * the style/discipline of scripts/verify-models.js.
 *
 * This is a manual diagnostic script, not part of the formal test suite
 * (that's Phase F, per the implementation plan §21). Run with:
 *
 *   npm run verify:validation
 *
 * or directly:
 *
 *   node scripts/verify-validation.js
 */

import assert from "node:assert/strict";

import { createIssueSchema, changeIssueStatusSchema } from "../src/validation/issue.validation.js";
import {
  createKnowledgeSchema,
  reviewKnowledgeSchema,
} from "../src/validation/knowledge.validation.js";
import { createCommentSchema } from "../src/validation/comment.validation.js";
import { createProjectSchema } from "../src/validation/project.validation.js";
import { objectIdString } from "../src/validation/shared/objectId.js";
import { registerSchema, loginSchema } from "../src/validation/auth.validation.js";

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

const VALID_OID = "507f1f77bcf86cd799439011";
const validPoint = (coords) => ({ type: "Point", coordinates: coords });

// ---------------------------------------------------------------------
// 1. Valid / invalid Issue payloads
// ---------------------------------------------------------------------
check("1a. Valid Issue payload passes", () => {
  const result = createIssueSchema.safeParse({
    title: "Broken pipeline",
    description: "Water leaking near the main road",
    location: validPoint([77.5, 12.9]),
  });
  assert.equal(result.success, true);
});

check("1b. Issue payload missing title fails", () => {
  const result = createIssueSchema.safeParse({
    description: "Water leaking near the main road",
    location: validPoint([77.5, 12.9]),
  });
  assert.equal(result.success, false);
});

check("1c. Issue payload with empty title fails", () => {
  const result = createIssueSchema.safeParse({
    title: "   ",
    description: "Water leaking near the main road",
    location: validPoint([77.5, 12.9]),
  });
  assert.equal(result.success, false);
});

check("1d. Issue payload missing location fails", () => {
  const result = createIssueSchema.safeParse({
    title: "Broken pipeline",
    description: "Water leaking near the main road",
  });
  assert.equal(result.success, false);
});

check("1e. Issue payload accepts optional severity/category, and works without them", () => {
  const withOptional = createIssueSchema.safeParse({
    title: "Broken pipeline",
    description: "Water leaking near the main road",
    location: validPoint([77.5, 12.9]),
    severity: "high",
    category: "infrastructure",
  });
  const withoutOptional = createIssueSchema.safeParse({
    title: "Broken pipeline",
    description: "Water leaking near the main road",
    location: validPoint([77.5, 12.9]),
  });
  assert.equal(withOptional.success, true);
  assert.equal(withoutOptional.success, true);
});

// ---------------------------------------------------------------------
// 2. Longitude / latitude boundaries
// ---------------------------------------------------------------------
function issueWithCoords(coords) {
  return createIssueSchema.safeParse({
    title: "t",
    description: "d",
    location: validPoint(coords),
  });
}

check("2a. Longitude exactly -180 is valid (inclusive boundary)", () => {
  assert.equal(issueWithCoords([-180, 0]).success, true);
});
check("2b. Longitude exactly 180 is valid (inclusive boundary)", () => {
  assert.equal(issueWithCoords([180, 0]).success, true);
});
check("2c. Latitude exactly -90 is valid (inclusive boundary)", () => {
  assert.equal(issueWithCoords([0, -90]).success, true);
});
check("2d. Latitude exactly 90 is valid (inclusive boundary)", () => {
  assert.equal(issueWithCoords([0, 90]).success, true);
});
check("2e. Longitude -180.0001 is invalid (just outside boundary)", () => {
  assert.equal(issueWithCoords([-180.0001, 0]).success, false);
});
check("2f. Longitude 180.0001 is invalid (just outside boundary)", () => {
  assert.equal(issueWithCoords([180.0001, 0]).success, false);
});
check("2g. Latitude -90.0001 is invalid (just outside boundary)", () => {
  assert.equal(issueWithCoords([0, -90.0001]).success, false);
});
check("2h. Latitude 90.0001 is invalid (just outside boundary)", () => {
  assert.equal(issueWithCoords([0, 90.0001]).success, false);
});
check("2i. Coordinate tuple with wrong length is invalid (Zod tuple arity)", () => {
  assert.equal(issueWithCoords([77.5]).success, false);
});

// ---------------------------------------------------------------------
// 3. Invalid ObjectIds
// ---------------------------------------------------------------------
check("3a. Valid 24-hex-char ObjectId string passes", () => {
  assert.equal(objectIdString.safeParse(VALID_OID).success, true);
});
check("3b. Too-short ObjectId string fails", () => {
  assert.equal(objectIdString.safeParse("507f1f77bcf86cd79943901").success, false);
});
check("3c. Too-long ObjectId string fails", () => {
  assert.equal(objectIdString.safeParse(VALID_OID + "a").success, false);
});
check("3d. Non-hex ObjectId string fails", () => {
  assert.equal(objectIdString.safeParse("not-an-objectid-string!!").success, false);
});
check("3e. Empty string fails", () => {
  assert.equal(objectIdString.safeParse("").success, false);
});

// ---------------------------------------------------------------------
// 4. Valid / invalid Knowledge review decisions, and 5. rejected requires feedback
// ---------------------------------------------------------------------
check("4a. Valid Knowledge creation payload passes", () => {
  const result = createKnowledgeSchema.safeParse({
    title: "Drip irrigation basics",
    body: "How to set up a low-cost drip irrigation system.",
  });
  assert.equal(result.success, true);
});

check("4b. Knowledge creation payload missing body fails", () => {
  const result = createKnowledgeSchema.safeParse({
    title: "Drip irrigation basics",
  });
  assert.equal(result.success, false);
});

check("4c. Review decision 'approved' without feedback passes", () => {
  const result = reviewKnowledgeSchema.safeParse({ decision: "approved" });
  assert.equal(result.success, true);
});

check("4d. Review decision 'approved' WITH feedback also passes (feedback is optional, not forbidden)", () => {
  const result = reviewKnowledgeSchema.safeParse({
    decision: "approved",
    feedback: "great article, minor style notes",
  });
  assert.equal(result.success, true);
});

check("4e. Review decision with invalid enum value fails", () => {
  const result = reviewKnowledgeSchema.safeParse({ decision: "maybe" });
  assert.equal(result.success, false);
});

// --- 5. rejected review requiring feedback ---
check("5a. Review decision 'rejected' WITH non-empty feedback passes", () => {
  const result = reviewKnowledgeSchema.safeParse({
    decision: "rejected",
    feedback: "needs more sourcing",
  });
  assert.equal(result.success, true);
});

check("5b. Review decision 'rejected' WITHOUT feedback fails", () => {
  const result = reviewKnowledgeSchema.safeParse({ decision: "rejected" });
  assert.equal(result.success, false);
  const feedbackIssue = result.error.issues.find((i) => i.path.includes("feedback"));
  assert.ok(feedbackIssue, "error should be attributed to the feedback field");
});

check("5c. Review decision 'rejected' with empty-string feedback fails", () => {
  const result = reviewKnowledgeSchema.safeParse({ decision: "rejected", feedback: "" });
  assert.equal(result.success, false);
});

check("5d. Review decision 'rejected' with whitespace-only feedback fails", () => {
  // trim() happens inside the schema's own .trim() call on the field
  // before the superRefine check runs, so whitespace-only input is
  // reduced to an empty string by the time the conditional check sees it.
  const result = reviewKnowledgeSchema.safeParse({ decision: "rejected", feedback: "   " });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------
// 6. Comment ISSUE / WIKI
// ---------------------------------------------------------------------
check("6a. Comment with refType 'ISSUE' passes", () => {
  const result = createCommentSchema.safeParse({
    refType: "ISSUE",
    refId: VALID_OID,
    body: "This is affecting my street too.",
  });
  assert.equal(result.success, true);
});

check("6b. Comment with refType 'WIKI' passes", () => {
  const result = createCommentSchema.safeParse({
    refType: "WIKI",
    refId: VALID_OID,
    body: "Great explanation, thanks!",
  });
  assert.equal(result.success, true);
});

check("6c. Comment with an unrecognized refType fails (e.g. 'KNOWLEDGE')", () => {
  // Confirms the discriminator stays "WIKI" per the locked terminology —
  // "KNOWLEDGE" is NOT a valid refType even though the collection is
  // named Knowledge (see comment.validation.js / persistence-design.md §3).
  const result = createCommentSchema.safeParse({
    refType: "KNOWLEDGE",
    refId: VALID_OID,
    body: "test",
  });
  assert.equal(result.success, false);
});

check("6d. Comment with optional parentComment (valid ObjectId) passes", () => {
  const result = createCommentSchema.safeParse({
    refType: "ISSUE",
    refId: VALID_OID,
    body: "Replying to the above.",
    parentComment: VALID_OID,
  });
  assert.equal(result.success, true);
});

check("6e. Comment with invalid parentComment shape fails", () => {
  const result = createCommentSchema.safeParse({
    refType: "ISSUE",
    refId: VALID_OID,
    body: "Replying to the above.",
    parentComment: "not-a-valid-id",
  });
  assert.equal(result.success, false);
});

check("6f. Comment without parentComment (top-level comment) passes", () => {
  const result = createCommentSchema.safeParse({
    refType: "ISSUE",
    refId: VALID_OID,
    body: "A fresh top-level comment.",
  });
  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------
// 7. Project ObjectId shape
// ---------------------------------------------------------------------
check("7a. Valid Project payload with well-shaped originIssue passes", () => {
  const result = createProjectSchema.safeParse({
    title: "Community pipe repair",
    description: "Organizing volunteers to fix the reported leak.",
    originIssue: VALID_OID,
  });
  assert.equal(result.success, true);
});

check("7b. Project payload with malformed originIssue fails", () => {
  const result = createProjectSchema.safeParse({
    title: "Community pipe repair",
    description: "Organizing volunteers to fix the reported leak.",
    originIssue: "12345",
  });
  assert.equal(result.success, false);
});

check("7c. Project payload missing originIssue fails", () => {
  const result = createProjectSchema.safeParse({
    title: "Community pipe repair",
    description: "Organizing volunteers to fix the reported leak.",
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------
// 8. Transition schema: accepts all known status values, enforces no legality
// ---------------------------------------------------------------------
const ALL_ISSUE_STATUSES = ["open", "acknowledged", "in_progress", "resolved", "verified"];

for (const status of ALL_ISSUE_STATUSES) {
  check(`8. changeIssueStatusSchema accepts targetStatus="${status}" (shape only, not legality)`, () => {
    const result = changeIssueStatusSchema.safeParse({ targetStatus: status });
    assert.equal(result.success, true);
  });
}

check("8f. changeIssueStatusSchema rejects an unrecognized status string", () => {
  const result = changeIssueStatusSchema.safeParse({ targetStatus: "closed" });
  assert.equal(result.success, false);
});

check("8g. changeIssueStatusSchema accepting 'open' as a target is deliberate, not an oversight", () => {
  // "open" can never legally be a transition TARGET under ADR-0003's
  // graph (it's a source-only state). This schema does NOT know that —
  // and is not supposed to. Transition legality is the service layer's
  // job (changeStatus()), not Zod's. This check exists so that fact
  // stays documented and testable, not just asserted in a comment.
  const result = changeIssueStatusSchema.safeParse({ targetStatus: "open" });
  assert.equal(
    result.success,
    true,
    "schema should accept 'open' as shape-valid even though it's never a legal transition target"
  );
});

// ---------------------------------------------------------------------
// 9. Auth: registerSchema
// ---------------------------------------------------------------------
const VALID_REGISTER = {
  name: "Test User",
  email: "test@example.com",
  password: "correcthorsebatterystaple",
};

check("9a. Valid register payload passes", () => {
  assert.equal(registerSchema.safeParse(VALID_REGISTER).success, true);
});

check("9b. Empty-string name fails", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, name: "" }).success, false);
});

check("9c. Whitespace-only name fails", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, name: "   " }).success, false);
});

check("9d. Name exactly 100 characters passes (inclusive boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, name: "a".repeat(100) }).success, true);
});

check("9e. Name of 101 characters fails (just outside boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, name: "a".repeat(101) }).success, false);
});

check("9f. Malformed email fails", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, email: "not-an-email" }).success, false);
});

check("9g. Email is trimmed and lowercased in the parsed result", () => {
  const result = registerSchema.safeParse({ ...VALID_REGISTER, email: "  Test@Example.COM  " });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "test@example.com");
});

check("9h. Name is trimmed in the parsed result", () => {
  const result = registerSchema.safeParse({ ...VALID_REGISTER, name: "  Trimmed  " });
  assert.equal(result.success, true);
  assert.equal(result.data.name, "Trimmed");
});

check("9i. Password exactly 8 characters passes (inclusive boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, password: "12345678" }).success, true);
});

check("9j. Password of 7 characters fails (just outside boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, password: "1234567" }).success, false);
});

check("9k. Password exactly 128 characters passes (inclusive boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, password: "a".repeat(128) }).success, true);
});

check("9l. Password of 129 characters fails (just outside boundary)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, password: "a".repeat(129) }).success, false);
});

check("9m. A password with no uppercase/digit/symbol still passes — no composition rules are enforced (locked decision, not an oversight)", () => {
  assert.equal(registerSchema.safeParse({ ...VALID_REGISTER, password: "alllowercaseletters" }).success, true);
});

// ---------------------------------------------------------------------
// 10. Auth: loginSchema
// ---------------------------------------------------------------------
check("10a. Valid login payload passes", () => {
  assert.equal(loginSchema.safeParse({ email: "test@example.com", password: "correcthorsebatterystaple" }).success, true);
});

check("10b. Login email is trimmed and lowercased in the parsed result", () => {
  const result = loginSchema.safeParse({ email: "  Test@Example.COM  ", password: "x" });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "test@example.com");
});

check("10c. Malformed login email fails", () => {
  assert.equal(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success, false);
});

check("10d. loginSchema does NOT enforce registration password-length rules — a 1-character password passes shape validation (must still reach credential verification)", () => {
  const result = loginSchema.safeParse({ email: "test@example.com", password: "x" });
  assert.equal(
    result.success,
    true,
    "a short password must pass shape validation at login — rejecting it here would leak information instead of the generic INVALID_CREDENTIALS the service layer produces"
  );
});

check("10e. loginSchema does NOT enforce the 128-character maximum either — a very long (wrong) password still passes shape validation", () => {
  const result = loginSchema.safeParse({ email: "test@example.com", password: "a".repeat(500) });
  assert.equal(result.success, true);
});

check("10f. Missing password fails (still requires the field to be present and a string)", () => {
  assert.equal(loginSchema.safeParse({ email: "test@example.com" }).success, false);
});

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
console.log("\nPhase C + Phase G validation-layer verification\n" + "=".repeat(40));
for (const r of results) {
  console.log(`${r.ok ? "✔" : "✘"} ${r.label}${r.ok ? "" : `\n    ${r.error}`}`);
}
console.log("=".repeat(40));
console.log(`${results.length - failures}/${results.length} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
