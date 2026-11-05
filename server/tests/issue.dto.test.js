import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  toCreatedIssueDTO,
  toPublicIssueSummaryDTO,
  toPublicIssueDetailDTO,
  toWorkflowDTO,
  toMutationDTO,
} from "../src/services/issue.dto.js";
import {
  projectPublicActivityLog,
  projectPublicAssignee,
  projectWorkflowView,
} from "../src/domain/issue-activity.js";
import { sendError } from "../src/http/respond.js";
import { CLIENT_SAFE_REASONS, isClientSafeReason } from "../src/http/reasons.js";
import { DomainError, DomainErrorCode } from "../src/services/errors.js";

/**
 * Pure DTO tests (#142): explicit allowlists, recursive redaction, actor
 * compatibility, and the failure `reason` allowlist. No database.
 */

const FORBIDDEN = ["remediation", "remediationHistory", "grantId", "grantedBy", "selfGrant", "expertCount", "threshold", "__v"];

function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

function assertNoPrivateKeys(dto, { allow = [] } = {}) {
  const keys = keysDeep(dto);
  for (const k of FORBIDDEN) {
    if (allow.includes(k)) continue;
    assert.ok(!keys.has(k), `DTO must not contain "${k}"`);
  }
}

const REPORTER = "a00000000000000000000001";
const EXPERT = "a00000000000000000000002";
const EXPERT2 = "a00000000000000000000003";
const GRANTEE = "a00000000000000000000004";
const GRANT = "b00000000000000000000001";
const t = (n) => new Date(Date.UTC(2026, 0, 1, 0, n));

const actors = new Map([
  [REPORTER, { name: "Rita", role: "USER" }],
  [EXPERT, { name: "Ed", role: "EXPERT" }],
  [EXPERT2, { name: "Eve", role: "EXPERT" }],
  [GRANTEE, { name: "Gus", role: "USER" }],
]);

function plainIssue(overrides = {}) {
  return {
    _id: "c00000000000000000000001",
    __v: 3,
    title: "Burst pipe",
    description: "Water",
    location: { type: "Point", coordinates: [85.1, 25.6] },
    severity: "",
    category: "",
    domain: "water",
    status: "acknowledged",
    reportedBy: REPORTER,
    statusHistory: [
      { _id: "d00000000000000000000001", fromStatus: null, toStatus: "open", actor: REPORTER, timestamp: t(0) },
      { _id: "d00000000000000000000002", fromStatus: "open", toStatus: "acknowledged", actor: EXPERT, timestamp: t(1), note: "PUBLIC-ack" },
    ],
    remediation: { grantId: GRANT, actor: GRANTEE, grantedBy: EXPERT, grantedAt: t(2), acceptedAt: null },
    remediationHistory: [
      { type: "granted", grantId: GRANT, actor: EXPERT, grantee: GRANTEE, timestamp: t(2), note: "PRIVATE-grant", selfGrant: true, expertCount: 2, threshold: 5 },
    ],
    createdAt: t(0),
    updatedAt: t(2),
    ...overrides,
  };
}

const accepted = (p) => ({
  ...p,
  remediation: { ...p.remediation, acceptedAt: t(3) },
  remediationHistory: [...p.remediationHistory, { type: "accepted", grantId: GRANT, actor: GRANTEE, grantee: GRANTEE, timestamp: t(3) }],
});

function detail(plain) {
  return toPublicIssueDetailDTO(plain, actors, {
    assignee: projectPublicAssignee(plain, actors),
    activity: projectPublicActivityLog(plain, actors),
  });
}

describe("public Issue DTOs: explicit allowlist and redaction", () => {
  it("summary has exactly the documented keys and no private state, in a pending-grant state", () => {
    const dto = toPublicIssueSummaryDTO(plainIssue(), actors);
    assert.deepEqual(Object.keys(dto).sort(), [
      "_id", "category", "createdAt", "description", "domain", "location", "reportedBy",
      "severity", "status", "statusHistory", "title", "updatedAt",
    ]);
    assertNoPrivateKeys(dto);
    assert.ok(!JSON.stringify(dto).includes("PRIVATE-grant"));
    assert.ok(!JSON.stringify(dto).includes(GRANTEE), "a pending grantee's identity is private");
  });

  it("statusHistory keeps `actor` as a string and the subdocument `_id`, and adds actorProfile", () => {
    const [first, second] = toPublicIssueSummaryDTO(plainIssue(), actors).statusHistory;
    assert.equal(typeof first.actor, "string");
    assert.equal(first.actor, REPORTER);
    assert.equal(first._id, "d00000000000000000000001");
    assert.deepEqual(first.actorProfile, { _id: REPORTER, name: "Rita", role: "USER" });
    assert.equal(second.note, "PUBLIC-ack");
    assert.deepEqual(Object.keys(first).sort(), ["_id", "actor", "actorProfile", "fromStatus", "timestamp", "toStatus"]);
  });

  it("an unresolvable actor maps to actorProfile null, never throwing or leaking", () => {
    const p = plainIssue({ statusHistory: [{ fromStatus: null, toStatus: "open", actor: "e00000000000000000000009", timestamp: t(0) }] });
    const [entry] = toPublicIssueSummaryDTO(p, actors).statusHistory;
    assert.equal(entry.actorProfile, null);
    assert.equal(entry.actor, "e00000000000000000000009");
  });

  it("detail: pending grant => assignee null; accepted => public assignee; activity present and redacted", () => {
    const pending = detail(plainIssue());
    assert.equal(pending.assignee, null);
    assert.ok(Array.isArray(pending.activity));
    assertNoPrivateKeys(pending);
    assert.ok(!JSON.stringify(pending).includes(GRANTEE));
    assert.ok(!JSON.stringify(pending).includes("PRIVATE-grant"));

    const acc = detail(accepted(plainIssue()));
    assert.deepEqual(Object.keys(acc.assignee).sort(), ["acceptedAt", "actor"]);
    assert.equal(acc.assignee.actor._id, GRANTEE);
    assertNoPrivateKeys(acc);
    assert.deepEqual(acc.activity.map((e) => e.type), [
      "report_submitted", "status_changed", "responsibility_offered", "responsibility_accepted",
    ]);
  });

  it("mutation DTO omits activity", () => {
    const p = plainIssue();
    const dto = toPublicIssueDetailDTO(p, actors, { assignee: null });
    assert.ok(!("activity" in dto));
  });

  it("never spreads the stored document: unknown stored fields stay private", () => {
    const dto = toPublicIssueSummaryDTO(plainIssue({ futurePrivateField: "x", internalNote: "y" }), actors);
    assert.ok(!("futurePrivateField" in dto) && !("internalNote" in dto) && !("__v" in dto));
  });

  it("a malformed document makes the mapper throw (no raw fallback)", () => {
    assert.throws(() => toPublicIssueSummaryDTO({ _id: "x" }, actors));
  });
});

describe("created-issue DTO preserves the pre-#142 201 contract", () => {
  it("reportedBy stays an id string; history has no actorProfile; no __v and no private state", () => {
    const dto = toCreatedIssueDTO(plainIssue());
    assert.equal(dto.reportedBy, REPORTER);
    assert.equal(typeof dto.reportedBy, "string");
    for (const h of dto.statusHistory) {
      assert.equal(typeof h.actor, "string");
      assert.ok(!("actorProfile" in h));
      assert.equal(typeof h._id, "string");
    }
    assert.ok(!("assignee" in dto) && !("activity" in dto));
    assertNoPrivateKeys(dto);
    assert.deepEqual(Object.keys(dto).sort(), [
      "_id", "category", "createdAt", "description", "domain", "location", "reportedBy",
      "severity", "status", "statusHistory", "title", "updatedAt",
    ]);
  });

  it("every Issue DTO excludes __v (persistence detail)", () => {
    const p = plainIssue();
    const a = accepted(p);
    const all = [
      toCreatedIssueDTO(p),
      toPublicIssueSummaryDTO(p, actors),
      detail(a),
      toWorkflowDTO(projectWorkflowView(a, { id: EXPERT, role: "EXPERT" }, actors)),
    ];
    for (const dto of all) assert.ok(!keysDeep(dto).has("__v"));
  });
});

describe("workflow DTO: viewer-specific, allowlisted", () => {
  const roleView = (p, role = "EXPERT", id = EXPERT2) => toWorkflowDTO(projectWorkflowView(p, { id, role }, actors));

  it("role-based viewer sees the pending grant and events, but never grantId or policy metadata", () => {
    const dto = roleView(plainIssue());
    assert.equal(dto.state, "pending");
    assert.equal(dto.pending.actor._id, GRANTEE);
    assert.equal(dto.pending.grantor._id, EXPERT);
    assert.deepEqual(Object.keys(dto.pending).sort(), ["actor", "grantedAt", "grantor"]);
    assert.equal(dto.events.length, 1);
    assert.equal(dto.events[0].note, "PRIVATE-grant");
    assertNoPrivateKeys(dto);
  });

  it("an outsider sees `unassigned` and nothing private (pending grant indistinguishable from none)", () => {
    const dto = roleView(plainIssue(), "USER", REPORTER);
    assert.equal(dto.state, "unassigned");
    assert.equal(dto.pending, null);
    assert.deepEqual(dto.events, []);
    assertNoPrivateKeys(dto);
  });

  it("participant sees own events with no policy fields; withdrawn notes are never exposed", () => {
    const p = plainIssue({
      remediation: undefined,
      remediationHistory: [
        { type: "granted", grantId: GRANT, actor: EXPERT, grantee: GRANTEE, timestamp: t(2), note: "p-note", selfGrant: true, expertCount: 1, threshold: 5 },
        { type: "withdrawn", grantId: GRANT, actor: EXPERT2, grantee: GRANTEE, timestamp: t(3), note: "PRIVATE-withdraw" },
      ],
    });
    const dto = roleView(p, "USER", GRANTEE);
    assert.equal(dto.events.length, 2);
    assert.equal(dto.events[0].note, "p-note");
    assert.deepEqual(Object.keys(dto.events[1]).sort(), ["performerRole", "timestamp", "type"]);
    assert.ok(!JSON.stringify(dto).includes("PRIVATE-withdraw"));
    assertNoPrivateKeys(dto);
  });

  it("two viewers get independent results (no shared privileged projection)", () => {
    const p = plainIssue();
    const privileged = roleView(p);
    const outsider = roleView(p, "USER", REPORTER);
    assert.equal(privileged.state, "pending");
    assert.equal(outsider.state, "unassigned");
    assert.notStrictEqual(privileged.events, outsider.events);
  });

  it("mutation DTO is exactly { issue, workflow }", () => {
    assert.deepEqual(Object.keys(toMutationDTO({}, {})).sort(), ["issue", "workflow"]);
  });
});

describe("failure envelope `reason` allowlist", () => {
  function capture(err) {
    let out;
    const res = { status(c) { out = { status: c }; return this; }, json(b) { out.body = b; return this; } };
    sendError(res, err);
    return out;
  }

  it("forwards an allowlisted reason and nothing else from details", () => {
    const out = capture(new DomainError(DomainErrorCode.FORBIDDEN, "no", { reason: "SELF_GRANT_NOT_PERMITTED", expertCount: 9, threshold: 5 }));
    assert.equal(out.status, 403);
    assert.equal(out.body.reason, "SELF_GRANT_NOT_PERMITTED");
    assert.deepEqual(Object.keys(out.body).sort(), ["code", "data", "message", "reason", "success"]);
    assert.ok(!JSON.stringify(out.body).includes("expertCount"));
  });

  it("omits an unrecognized reason and an absent reason (envelope unchanged)", () => {
    const unknown = capture(new DomainError(DomainErrorCode.INVALID_STATE, "x", { reason: "SOMETHING_INTERNAL", status: "open" }));
    assert.ok(!("reason" in unknown.body));
    const none = capture(new DomainError(DomainErrorCode.NOT_FOUND, "x"));
    assert.deepEqual(Object.keys(none.body).sort(), ["code", "data", "message", "success"]);
  });

  it("ignores a non-string reason", () => {
    const out = capture(new DomainError(DomainErrorCode.INVALID_STATE, "x", { reason: { a: 1 } }));
    assert.ok(!("reason" in out.body));
  });

  it("the allowlist is exactly the documented set and cannot be mutated", () => {
    assert.deepEqual([...CLIENT_SAFE_REASONS].sort(), [
      "GRANT_ALREADY_ACCEPTED", "GRANT_EXISTS", "GRANT_NOT_ACCEPTED", "NO_GRANT", "SELF_GRANT_NOT_PERMITTED",
    ]);
    assert.ok(Object.isFrozen(CLIENT_SAFE_REASONS));
    assert.throws(() => CLIENT_SAFE_REASONS.push("INJECTED"), TypeError);
    assert.equal(isClientSafeReason("INJECTED"), false);
    assert.equal(isClientSafeReason("NO_GRANT"), true);
    assert.equal(isClientSafeReason(undefined), false);
    assert.equal(isClientSafeReason({ toString: () => "NO_GRANT" }), false);
  });
});
