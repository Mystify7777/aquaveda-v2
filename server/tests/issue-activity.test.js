import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  projectPublicActivityLog,
  projectPublicAssignee,
  projectWorkflowView,
  visibleRemediationEvents,
} from "../src/domain/issue-activity.js";

const T = (n) => new Date(Date.UTC(2026, 10, 1, 12, 0, n));
const REPORTER = "r000000000000000000000001";
const EXPERT_A = "a000000000000000000000001";
const EXPERT_B = "b000000000000000000000001";
const GRANTEE = "c000000000000000000000001";
const OTHER = "d000000000000000000000001";
const ADMIN = "e000000000000000000000001";
const G1 = "f000000000000000000000001";

const actors = new Map([
  [REPORTER, { name: "Rita Reporter", role: "USER" }],
  [EXPERT_A, { name: "Asha Expert", role: "EXPERT" }],
  [EXPERT_B, { name: "Bala Expert", role: "EXPERT" }],
  [GRANTEE, { name: "Gita Grantee", role: "USER" }],
  [ADMIN, { name: "Ada Admin", role: "ADMIN" }],
]);

function fullIssue() {
  return {
    statusHistory: [
      { fromStatus: null, toStatus: "open", actor: REPORTER, timestamp: T(0) },
      { fromStatus: "open", toStatus: "acknowledged", actor: EXPERT_A, timestamp: T(10), note: "Looks genuine." },
      { fromStatus: "acknowledged", toStatus: "in_progress", actor: GRANTEE, timestamp: T(40) },
      { fromStatus: "in_progress", toStatus: "resolved", actor: GRANTEE, timestamp: T(50), note: "Replaced the pump seal; flow restored." },
      { fromStatus: "resolved", toStatus: "verified", actor: EXPERT_B, timestamp: T(60), note: "Tested on site." },
    ],
    remediation: { grantId: G1, actor: GRANTEE, grantedBy: EXPERT_A, grantedAt: T(20), acceptedAt: T(30) },
    remediationHistory: [
      { type: "granted", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(20), note: "private grant note", selfGrant: true, expertCount: 2, threshold: 5 },
      { type: "accepted", grantId: G1, actor: GRANTEE, grantee: GRANTEE, timestamp: T(30), note: "private accept note" },
    ],
  };
}

describe("projectPublicActivityLog", () => {
  it("has exactly one entry per successful mutation, in order, with stable ids", () => {
    const log = projectPublicActivityLog(fullIssue(), actors);
    assert.deepEqual(
      log.map((e) => [e.id, e.type]),
      [
        ["h:0", "report_submitted"],
        ["h:1", "status_changed"],
        ["r:0", "responsibility_offered"],
        ["r:1", "responsibility_accepted"],
        ["h:2", "status_changed"],
        ["h:3", "status_changed"],
        ["h:4", "status_changed"],
      ],
    );
  });

  it("is deterministic: repeated projection is deeply equal", () => {
    assert.deepEqual(projectPublicActivityLog(fullIssue(), actors), projectPublicActivityLog(fullIssue(), actors));
  });

  it("orders equal timestamps by source (statusHistory first) then index", () => {
    const issue = {
      statusHistory: [{ fromStatus: null, toStatus: "open", actor: REPORTER, timestamp: T(5) }],
      remediationHistory: [
        { type: "granted", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(5) },
        { type: "withdrawn", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(5), note: "x" },
      ],
    };
    assert.deepEqual(projectPublicActivityLog(issue, actors).map((e) => e.id), ["h:0", "r:0", "r:1"]);
  });

  it("shows status notes and performers publicly (PublicActor: id, name, role only)", () => {
    const log = projectPublicActivityLog(fullIssue(), actors);
    const ack = log.find((e) => e.id === "h:1");
    assert.equal(ack.note, "Looks genuine.");
    assert.deepEqual(ack.actor, { _id: EXPERT_A, name: "Asha Expert", role: "EXPERT" });
    assert.equal(ack.fromStatus, "open");
    assert.equal(ack.toStatus, "acknowledged");
    assert.equal(log[0].actor.name, "Rita Reporter");
  });

  it("redacts: no grantee before acceptance, no responsibility notes, no grantId, no policy metadata", () => {
    const log = projectPublicActivityLog(fullIssue(), actors);
    const offered = log.find((e) => e.id === "r:0");
    assert.equal(offered.actor, null);
    assert.equal(offered.note, null);
    const text = JSON.stringify(log);
    for (const secret of ["private grant note", "private accept note", G1, "selfGrant", "expertCount", "threshold", "grantId", "selfAssigned"]) {
      assert.ok(!text.includes(secret), `public log must not contain ${secret}`);
    }
    assert.equal(log.find((e) => e.id === "r:1").actor.name, "Gita Grantee");
  });

  it("every non-acceptance responsibility event is neutral (no actor, no note)", () => {
    const types = ["declined", "released", "withdrawn", "revoked"];
    const issue = {
      statusHistory: [{ fromStatus: null, toStatus: "open", actor: REPORTER, timestamp: T(0) }],
      remediationHistory: types.map((type, i) => ({ type, grantId: G1, actor: ADMIN, grantee: GRANTEE, timestamp: T(i + 1), note: "governance reason" })),
    };
    const log = projectPublicActivityLog(issue, actors).slice(1);
    assert.deepEqual(log.map((e) => e.type), types.map((t) => `responsibility_${t}`));
    for (const e of log) {
      assert.equal(e.actor, null);
      assert.equal(e.note, null);
    }
  });

  it("tolerates legacy issues (no remediation fields, no notes) and unknown actors", () => {
    const legacy = { statusHistory: [{ fromStatus: null, toStatus: "open", actor: OTHER, timestamp: T(0) }] };
    const log = projectPublicActivityLog(legacy, actors);
    assert.equal(log.length, 1);
    assert.equal(log[0].actor, null); // unknown actor id => null, never a crash
    assert.equal(log[0].note, null);
    assert.deepEqual(projectPublicActivityLog({}, actors), []);
  });

  it("never publishes an unknown future remediation event type", () => {
    const issue = { statusHistory: [], remediationHistory: [{ type: "something_new", timestamp: T(1), note: "secret" }] };
    assert.deepEqual(projectPublicActivityLog(issue, actors), []);
  });

  it("accepts a plain-object actor lookup as well as a Map", () => {
    const obj = { [REPORTER]: { name: "Rita Reporter", role: "USER" } };
    assert.equal(projectPublicActivityLog(fullIssue(), obj)[0].actor.name, "Rita Reporter");
  });

  it("projects populated ObjectId-like values by id", () => {
    const issue = { statusHistory: [{ fromStatus: null, toStatus: "open", actor: { _id: REPORTER }, timestamp: T(0) }] };
    assert.equal(projectPublicActivityLog(issue, actors)[0].actor.name, "Rita Reporter");
  });
});

describe("projectPublicAssignee", () => {
  it("returns the assignee only once the grant is accepted", () => {
    const issue = fullIssue();
    assert.equal(projectPublicAssignee(issue, actors).actor.name, "Gita Grantee");
    issue.remediation.acceptedAt = null;
    assert.equal(projectPublicAssignee(issue, actors), null);
    assert.equal(projectPublicAssignee({}, actors), null);
  });
});

describe("workflow visibility (role-based vs participation-based)", () => {
  function issueWithAllEvents() {
    const issue = fullIssue();
    issue.remediation = { grantId: "f000000000000000000000002", actor: OTHER, grantedBy: EXPERT_B, grantedAt: T(70), acceptedAt: null };
    issue.remediationHistory = [
      { type: "granted", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(20), note: "grant note A" },
      { type: "accepted", grantId: G1, actor: GRANTEE, grantee: GRANTEE, timestamp: T(30), note: "accept note" },
      { type: "withdrawn", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(35), note: "withdraw reason" },
      { type: "granted", grantId: "f000000000000000000000002", actor: EXPERT_B, grantee: OTHER, timestamp: T(70), note: "grant note B" },
    ];
    return issue;
  }

  it("anonymous and unrelated users see no raw events", () => {
    const issue = issueWithAllEvents();
    assert.deepEqual(visibleRemediationEvents(issue, null), []);
    assert.deepEqual(visibleRemediationEvents(issue, undefined), []);
    assert.deepEqual(visibleRemediationEvents(issue, { id: "z000000000000000000000009", role: "USER" }), []);
  });

  it("role-based: a current EXPERT or ADMIN sees every event and every note", () => {
    for (const role of ["EXPERT", "ADMIN"]) {
      const events = visibleRemediationEvents(issueWithAllEvents(), { id: "z000000000000000000000009", role });
      assert.equal(events.length, 4);
      assert.ok(events.some((e) => e.note === "withdraw reason"));
    }
  });

  it("participation: a user sees only events where they are performer or grantee", () => {
    const events = visibleRemediationEvents(issueWithAllEvents(), { id: GRANTEE, role: "USER" });
    assert.deepEqual(events.map((e) => e.type), ["granted", "accepted", "withdrawn"]);
    assert.ok(!JSON.stringify(events).includes("grant note B"));
  });

  it("participation never reveals withdrawn/revoked notes or the performer's identity; shows performer ROLE and time", () => {
    const events = visibleRemediationEvents(issueWithAllEvents(), { id: GRANTEE, role: "USER" });
    const withdrawn = events.find((e) => e.type === "withdrawn");
    assert.deepEqual(withdrawn, { type: "withdrawn", performerRole: "EXPERT", timestamp: T(35) });
    assert.ok(!JSON.stringify(events).includes("withdraw reason"));

    const revoked = { remediationHistory: [{ type: "revoked", grantId: G1, actor: ADMIN, grantee: GRANTEE, timestamp: T(1), note: "abuse" }] };
    assert.deepEqual(visibleRemediationEvents(revoked, { id: GRANTEE, role: "USER" }), [{ type: "revoked", performerRole: "ADMIN", timestamp: T(1) }]);
  });

  it("participation also applies to a performer who was DEMOTED: own events yes, withdrawn note no", () => {
    const events = visibleRemediationEvents(issueWithAllEvents(), { id: EXPERT_A, role: "USER" });
    assert.deepEqual(events.map((e) => e.type), ["granted", "withdrawn"]);
    assert.ok(!JSON.stringify(events).includes("withdraw reason"));
    assert.ok(JSON.stringify(events).includes("grant note A"));
  });

  it("promotion: the same user id gains role-based access to events it never took part in", () => {
    const issue = issueWithAllEvents();
    const before = visibleRemediationEvents(issue, { id: OTHER, role: "USER" });
    const after = visibleRemediationEvents(issue, { id: OTHER, role: "EXPERT" });
    assert.deepEqual(before.map((e) => e.type), ["granted"]);
    assert.equal(after.length, 4);
  });

  it("demotion: losing EXPERT removes role-based access but keeps participation access", () => {
    const issue = issueWithAllEvents();
    const asExpert = visibleRemediationEvents(issue, { id: EXPERT_B, role: "EXPERT" });
    const asUser = visibleRemediationEvents(issue, { id: EXPERT_B, role: "USER" });
    assert.equal(asExpert.length, 4);
    assert.deepEqual(asUser.map((e) => e.note), ["grant note B"]);
  });

  it("returns copies: mutating a result never touches the source issue", () => {
    const issue = issueWithAllEvents();
    const events = visibleRemediationEvents(issue, { id: "z", role: "ADMIN" });
    events[0].note = "tampered";
    assert.equal(issue.remediationHistory[0].note, "grant note A");
  });

  it("projectWorkflowView: pending grant visible to role-based viewers, the grantee and the grantor only", () => {
    const issue = issueWithAllEvents(); // pending grant: OTHER, grantedBy EXPERT_B
    const view = (v) => projectWorkflowView(issue, v, actors).pending;
    assert.ok(view({ id: "z", role: "EXPERT" }));
    assert.ok(view({ id: "z", role: "ADMIN" }));
    assert.ok(view({ id: OTHER, role: "USER" }));
    assert.ok(view({ id: EXPERT_B, role: "USER" }));
    assert.equal(view({ id: GRANTEE, role: "USER" }), null);
    assert.equal(view(null), null);
    assert.equal(projectWorkflowView(issue, null, actors).assignee, null);
  });

  it("projectWorkflowView never exposes the current grantId or a raw array", () => {
    const view = projectWorkflowView(issueWithAllEvents(), { id: "z", role: "ADMIN" }, actors);
    assert.ok(!("grantId" in view.pending));
    assert.ok(!("remediation" in view));
    assert.ok(!("remediationHistory" in view));
  });

  it("legacy issues (no fields) produce an unassigned, empty view", () => {
    const view = projectWorkflowView({ statusHistory: [] }, { id: "z", role: "EXPERT" }, actors);
    assert.deepEqual(view, { state: "unassigned", assignee: null, pending: null, events: [] });
  });
});

describe("pending-grant EXISTENCE is as private as its details (ADR-0007 §7)", () => {
  function pendingIssue() {
    return {
      statusHistory: [],
      remediation: { grantId: G1, actor: GRANTEE, grantedBy: EXPERT_A, grantedAt: T(5), acceptedAt: null },
      remediationHistory: [
        { type: "granted", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(5) },
      ],
    };
  }
  const stateFor = (issue, viewer) => projectWorkflowView(issue, viewer, actors).state;

  it("an unrelated authenticated user, a different USER and anonymous see 'unassigned', same as an issue with no grant", () => {
    const pending = pendingIssue();
    const none = { statusHistory: [], remediationHistory: [] };
    for (const viewer of [{ id: OTHER, role: "USER" }, { id: REPORTER, role: "USER" }, null, undefined, { role: "USER" }]) {
      assert.equal(stateFor(pending, viewer), "unassigned");
      assert.deepEqual(projectWorkflowView(pending, viewer, actors).pending, null);
      // whole view is indistinguishable from the no-grant case
      assert.deepEqual(
        { ...projectWorkflowView(pending, viewer, actors), events: [] },
        { ...projectWorkflowView(none, viewer, actors), events: [] },
      );
    }
  });

  it("the grantee, the grantor, and current EXPERT/ADMIN see 'pending'", () => {
    const pending = pendingIssue();
    assert.equal(stateFor(pending, { id: GRANTEE, role: "USER" }), "pending");
    assert.equal(stateFor(pending, { id: EXPERT_A, role: "USER" }), "pending"); // grantor, even if demoted
    assert.equal(stateFor(pending, { id: OTHER, role: "EXPERT" }), "pending");
    assert.equal(stateFor(pending, { id: OTHER, role: "ADMIN" }), "pending");
  });

  it("promotion/demotion changes who sees 'pending' immediately", () => {
    const pending = pendingIssue();
    assert.equal(stateFor(pending, { id: OTHER, role: "USER" }), "unassigned");
    assert.equal(stateFor(pending, { id: OTHER, role: "EXPERT" }), "pending");
    assert.equal(stateFor(pending, { id: OTHER, role: "USER" }), "unassigned");
  });

  it("an ACCEPTED grant is public: every viewer sees 'accepted' and the assignee", () => {
    const accepted = pendingIssue();
    accepted.remediation.acceptedAt = T(8);
    for (const viewer of [null, { id: OTHER, role: "USER" }, { id: GRANTEE, role: "USER" }, { id: OTHER, role: "ADMIN" }]) {
      const view = projectWorkflowView(accepted, viewer, actors);
      assert.equal(view.state, "accepted");
      assert.equal(view.assignee.actor.name, "Gita Grantee");
    }
  });

  it("an issue with no grant is 'unassigned' for everyone", () => {
    for (const viewer of [null, { id: OTHER, role: "USER" }, { id: OTHER, role: "EXPERT" }]) {
      assert.equal(stateFor({ statusHistory: [] }, viewer), "unassigned");
    }
  });
});

describe("raw remediation events are built from explicit allowlists", () => {
  const PRIVATE = ["grantId", "selfGrant", "expertCount", "threshold"];

  function selfGrantIssue() {
    return {
      statusHistory: [],
      remediationHistory: [
        {
          type: "granted", grantId: G1, actor: EXPERT_A, grantee: EXPERT_A, timestamp: T(1), note: "Taking this on.",
          selfGrant: true, expertCount: 2, threshold: 5, internalFlag: "never-ship", _id: "stored-id",
        },
        { type: "accepted", grantId: G1, actor: EXPERT_A, grantee: EXPERT_A, timestamp: T(2) },
        { type: "granted", grantId: "f000000000000000000000009", actor: EXPERT_B, grantee: GRANTEE, timestamp: T(3), note: "Please help." },
      ],
    };
  }

  it("participants (grantee AND grantor) never receive grantId or the self-grant policy basis", () => {
    const issue = selfGrantIssue();
    for (const viewer of [{ id: GRANTEE, role: "USER" }, { id: EXPERT_B, role: "USER" }, { id: EXPERT_A, role: "USER" }]) {
      const events = visibleRemediationEvents(issue, viewer);
      assert.ok(events.length > 0);
      for (const e of events) {
        for (const field of PRIVATE) assert.ok(!(field in e), `participant event must not contain ${field}`);
      }
    }
  });

  it("participants keep what they are entitled to: type, actor, grantee, timestamp, note", () => {
    const [granted] = visibleRemediationEvents(selfGrantIssue(), { id: EXPERT_A, role: "USER" });
    assert.deepEqual(granted, { type: "granted", actor: EXPERT_A, grantee: EXPERT_A, timestamp: T(1), note: "Taking this on." });
    const events = visibleRemediationEvents(selfGrantIssue(), { id: GRANTEE, role: "USER" });
    assert.deepEqual(events, [{ type: "granted", actor: EXPERT_B, grantee: GRANTEE, timestamp: T(3), note: "Please help." }]);
  });

  it("fields not on an allowlist are never copied through (default-private), for participants and role-based viewers alike", () => {
    for (const viewer of [{ id: EXPERT_A, role: "USER" }, { id: OTHER, role: "ADMIN" }]) {
      const text = JSON.stringify(visibleRemediationEvents(selfGrantIssue(), viewer));
      assert.ok(!text.includes("never-ship"), "unknown field must not leak");
      assert.ok(!text.includes("stored-id"), "storage _id must not leak");
    }
  });

  it("role-based viewers retain exactly what ADR-0007 §7 permits: grantId and the self-grant basis", () => {
    const [granted] = visibleRemediationEvents(selfGrantIssue(), { id: OTHER, role: "EXPERT" });
    assert.deepEqual(granted, {
      type: "granted", grantId: G1, actor: EXPERT_A, grantee: EXPERT_A, timestamp: T(1), note: "Taking this on.",
      selfGrant: true, expertCount: 2, threshold: 5,
    });
  });

  it("projectWorkflowView passes the same allowlisted events through", () => {
    const view = projectWorkflowView(selfGrantIssue(), { id: GRANTEE, role: "USER" }, actors);
    const text = JSON.stringify(view);
    for (const field of PRIVATE) assert.ok(!text.includes(`"${field}"`), `${field} must not appear`);
  });

  it("withdrawn/revoked events stay minimal for participants (no note, no identities, no grant fields)", () => {
    const issue = {
      remediationHistory: [
        { type: "withdrawn", grantId: G1, actor: EXPERT_A, grantee: GRANTEE, timestamp: T(1), note: "secret reason", selfGrant: true, expertCount: 1, threshold: 5 },
      ],
    };
    assert.deepEqual(visibleRemediationEvents(issue, { id: GRANTEE, role: "USER" }), [
      { type: "withdrawn", performerRole: "EXPERT", timestamp: T(1) },
    ]);
  });
});
