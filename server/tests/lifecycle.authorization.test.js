import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { changeStatus } from "../src/services/issue.service.js";
import { createProject } from "../src/services/project.service.js";
import { acceptRemediation, grantRemediation, releaseRemediation } from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  asActor,
  acknowledgedIssue,
  expectCode,
  inProgressIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  makeWorld,
  openIssue,
  raw,
  reload,
  resolvedIssue,
  withInterleave,
} from "./helpers/lifecycleFixtures.js";

/**
 * ADR-0007 — lifecycle transition authorization (real MongoDB).
 * Replaces the former D-3a "unresolved policy" tests.
 */

let w;
before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  w = await makeWorld();
});

describe("start (acknowledged -> in_progress) requires the ACCEPTED grantee", () => {
  it("rejects every actor who is not the accepted grantee, of every role, without mutating", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const before = await raw(issue._id);
    const nonGrantees = [
      ["EXPERT without a grant", w.expert1],
      ["the other EXPERT", w.expert2],
      ["ADMIN", w.admin],
      ["the reporter", w.reporter],
      ["a bystander", w.other],
    ];
    for (const [label, actor] of nonGrantees) {
      await assert.rejects(changeStatus(asActor(actor), issue._id, "in_progress"), (e) => e.code === "FORBIDDEN", label);
    }
    assert.deepEqual(await raw(issue._id), before, "no partial mutation");
  });

  it("a Project creator gets no authority from creating a Project for the issue", async () => {
    const issue = await issueWithAcceptedGrant(w);
    await createProject(asActor(w.other), { title: "Fix it", description: "Volunteers", originIssue: issue._id });
    await expectCode(changeStatus(asActor(w.other), issue._id, "in_progress"), "FORBIDDEN");
  });

  it("with no grant at all, even an EXPERT is FORBIDDEN (no role-based authority)", async () => {
    const issue = await acknowledgedIssue(w);
    await expectCode(changeStatus(asActor(w.expert1), issue._id, "in_progress"), "FORBIDDEN");
    await expectCode(changeStatus(asActor(w.admin), issue._id, "in_progress"), "FORBIDDEN");
  });

  it("a PENDING grant confers no authority: the grantee gets INVALID_STATE (GRANT_NOT_ACCEPTED), others FORBIDDEN", async () => {
    const issue = await issueWithPendingGrant(w);
    await expectCode(changeStatus(asActor(w.grantee), issue._id, "in_progress"), "INVALID_STATE", { reason: "GRANT_NOT_ACCEPTED" });
    await expectCode(changeStatus(asActor(w.expert2), issue._id, "in_progress"), "FORBIDDEN");
    assert.equal((await reload(issue._id)).status, "acknowledged");
  });

  it("does not reveal a pending grant to non-grantees: same code and message as an issue with no grant", async () => {
    const withGrant = await issueWithPendingGrant(w);
    const noGrant = await acknowledgedIssue(w);
    const grab = (id) => changeStatus(asActor(w.other), id, "in_progress").then(() => null, (e) => e);
    const a = await grab(withGrant._id);
    const b = await grab(noGrant._id);
    assert.equal(a.code, "FORBIDDEN");
    assert.equal(a.code, b.code);
    assert.equal(a.message, b.message);
    assert.deepEqual(a.details, b.details);
  });

  it("the accepted grantee starts work; history records them; the grant is unchanged", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const before = await raw(issue._id);
    const updated = await changeStatus(asActor(w.grantee), issue._id, "in_progress", { note: "Crew on site Monday." });
    assert.equal(updated.status, "in_progress");
    const last = updated.statusHistory.at(-1);
    assert.equal(last.fromStatus, "acknowledged");
    assert.equal(last.toStatus, "in_progress");
    assert.equal(String(last.actor), w.grantee.id);
    assert.equal(last.note, "Crew on site Monday.");
    const after = await raw(issue._id);
    assert.deepEqual(after.remediation, before.remediation, "starting work never alters the grant");
    assert.equal(after.statusHistory.length, before.statusHistory.length + 1);
  });

  it("a note is optional for start", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const updated = await changeStatus(asActor(w.grantee), issue._id, "in_progress");
    assert.equal(updated.statusHistory.at(-1).note, undefined);
  });
});

describe("resolve (in_progress -> resolved) requires the accepted grantee and a resolution statement", () => {
  it("rejects everyone else (EXPERT, ADMIN, reporter) with FORBIDDEN", async () => {
    const issue = await inProgressIssue(w);
    for (const actor of [w.expert1, w.expert2, w.admin, w.reporter, w.other]) {
      await expectCode(changeStatus(asActor(actor), issue._id, "resolved", { note: "I did it" }), "FORBIDDEN");
    }
    assert.equal((await reload(issue._id)).status, "in_progress");
  });

  it("the note is required, enforced server-side (absent, blank, whitespace-only, non-string)", async () => {
    const issue = await inProgressIssue(w);
    for (const note of [undefined, null, "", "   ", "\n\t\u200B", 42]) {
      await expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note }), "VALIDATION_FAILED", { field: "note" });
    }
    assert.equal((await reload(issue._id)).status, "in_progress");
  });

  it("authorization comes before note validation: an unauthorized caller with a bad note gets FORBIDDEN", async () => {
    const issue = await inProgressIssue(w);
    await expectCode(changeStatus(asActor(w.other), issue._id, "resolved", { note: "" }), "FORBIDDEN");
  });

  it("an over-long note (after normalization) is rejected, never truncated", async () => {
    const issue = await inProgressIssue(w);
    await expectCode(changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "x".repeat(2001) }), "VALIDATION_FAILED");
    const ok = await changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "x".repeat(2000) });
    assert.equal(ok.statusHistory.at(-1).note.length, 2000);
  });

  it("records the normalized resolution statement and keeps the accepted grant", async () => {
    const issue = await inProgressIssue(w);
    const updated = await changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "  Replaced   the seal.\r\n\r\n\r\n\r\nTested.  " });
    assert.equal(updated.status, "resolved");
    assert.equal(updated.statusHistory.at(-1).note, "Replaced the seal.\n\nTested.");
    const stored = await raw(issue._id);
    assert.ok(stored.remediation.acceptedAt);
  });
});

describe("verification and failed verification (EXPERT rules unchanged; notes now required)", () => {
  it("verify requires a note and an EXPERT who is not the resolver; ADMIN cannot verify", async () => {
    const issue = await resolvedIssue(w);
    await expectCode(changeStatus(asActor(w.expert2), issue._id, "verified"), "VALIDATION_FAILED", { field: "note" });
    await expectCode(changeStatus(asActor(w.admin), issue._id, "verified", { note: "ok" }), "FORBIDDEN");
    await expectCode(changeStatus(asActor(w.grantee), issue._id, "verified", { note: "ok" }), "FORBIDDEN");
    const verified = await changeStatus(asActor(w.expert2), issue._id, "verified", { note: "Verified on site." });
    assert.equal(verified.status, "verified");
  });

  it("failed verification requires a note, returns to in_progress and KEEPS the accepted grant active", async () => {
    const issue = await resolvedIssue(w);
    await expectCode(changeStatus(asActor(w.expert2), issue._id, "in_progress"), "VALIDATION_FAILED", { field: "note" });
    const back = await changeStatus(asActor(w.expert2), issue._id, "in_progress", { note: "Still leaking." });
    assert.equal(back.status, "in_progress");
    const stored = await raw(issue._id);
    assert.ok(stored.remediation.acceptedAt, "grant stays accepted");
    // the same grantee can resolve again, then a different EXPERT verifies
    await changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "Second repair." });
    const verified = await changeStatus(asActor(w.expert1), issue._id, "verified", { note: "Fixed now." });
    assert.equal(verified.status, "verified");
  });

  it("resolver != verifier still holds when an EXPERT self-granted, resolved, and tries to verify (single-EXPERT pool)", async () => {
    const soleExpert = w.expert1;
    await User.deleteOne({ _id: w.expert2.id }); // pool of one
    const issue = await acknowledgedIssue(w);
    await grantRemediation(asActor(soleExpert), issue._id, soleExpert.id); // allowed: 1 < 5
    await acceptRemediation(asActor(soleExpert), issue._id);
    await changeStatus(asActor(soleExpert), issue._id, "in_progress");
    await changeStatus(asActor(soleExpert), issue._id, "resolved", { note: "Done myself." });
    await expectCode(changeStatus(asActor(soleExpert), issue._id, "verified", { note: "Looks good to me." }), "FORBIDDEN");
    assert.equal((await reload(issue._id)).status, "resolved", "waits for an independent EXPERT; no bypass");
  });
});

describe("notes on the other transitions", () => {
  it("open -> acknowledged accepts an optional note and stores it normalized", async () => {
    const issue = await openIssue(w);
    const updated = await changeStatus(asActor(w.expert1), issue._id, "acknowledged", { note: "  Needs a site visit. " });
    assert.equal(updated.statusHistory.at(-1).note, "Needs a site visit.");
  });

  it("a blank optional note is treated as absent; a non-string note is rejected", async () => {
    const issue = await openIssue(w);
    await expectCode(changeStatus(asActor(w.expert1), issue._id, "acknowledged", { note: { x: 1 } }), "VALIDATION_FAILED");
    const updated = await changeStatus(asActor(w.expert1), issue._id, "acknowledged", { note: "   " });
    assert.equal(updated.statusHistory.at(-1).note, undefined);
  });
});

describe("history integrity", () => {
  it("every transition appends exactly one statusHistory entry and never edits earlier ones", async () => {
    const issue = await acknowledgedIssue(w);
    let prev = (await raw(issue._id)).statusHistory;
    const steps = [
      async () => grantRemediation(asActor(w.expert1), issue._id, w.grantee.id),
      async () => acceptRemediation(asActor(w.grantee), issue._id),
      async () => changeStatus(asActor(w.grantee), issue._id, "in_progress"),
      async () => changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "done" }),
      async () => changeStatus(asActor(w.expert2), issue._id, "in_progress", { note: "no" }),
      async () => changeStatus(asActor(w.grantee), issue._id, "resolved", { note: "done again" }),
      async () => changeStatus(asActor(w.expert2), issue._id, "verified", { note: "ok" }),
    ];
    for (const step of steps) {
      await step();
      const now = (await raw(issue._id)).statusHistory;
      assert.deepEqual(now.slice(0, prev.length), prev, "earlier entries are untouched");
      assert.ok(now.length - prev.length <= 1, "at most one entry per operation");
      prev = now;
    }
    const final = await raw(issue._id);
    assert.deepEqual(
      final.statusHistory.map((h) => [h.fromStatus, h.toStatus]),
      [
        [null, "open"],
        ["open", "acknowledged"],
        ["acknowledged", "in_progress"],
        ["in_progress", "resolved"],
        ["resolved", "in_progress"],
        ["in_progress", "resolved"],
        ["resolved", "verified"],
      ],
    );
  });

  it("grant operations never change status or statusHistory", async () => {
    const issue = await acknowledgedIssue(w);
    const before = await raw(issue._id);
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id);
    await acceptRemediation(asActor(w.grantee), issue._id);
    await releaseRemediation(asActor(w.grantee), issue._id);
    const after = await raw(issue._id);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.statusHistory, before.statusHistory);
  });
});

describe("role changes never affect an existing grant (ADR-0007 §9)", () => {
  it("demoting the grantor and re-roling the grantee leaves acceptance, start and resolve intact", async () => {
    const issue = await issueWithPendingGrant(w); // granted by expert1
    await User.updateOne({ _id: w.expert1.id }, { $set: { role: "USER" } }); // grantor loses EXPERT
    await User.updateOne({ _id: w.grantee.id }, { $set: { role: "ADMIN" } }); // grantee's role changes
    const granteeNow = { id: w.grantee.id, role: "ADMIN" };
    await acceptRemediation(granteeNow, issue._id);
    await changeStatus(granteeNow, issue._id, "in_progress");
    const resolved = await changeStatus(granteeNow, issue._id, "resolved", { note: "Done." });
    assert.equal(resolved.status, "resolved");
    // and verification still needs an actual EXPERT, regardless of history
    await expectCode(changeStatus({ id: w.expert1.id, role: "USER" }, issue._id, "verified", { note: "x" }), "FORBIDDEN");
  });

  it("the grantee holding the EXPERT role gains nothing, and losing it loses nothing", async () => {
    const issue = await issueWithAcceptedGrant(w, { grantee: w.expert2 });
    await User.updateOne({ _id: w.expert2.id }, { $set: { role: "USER" } });
    const started = await changeStatus({ id: w.expert2.id, role: "USER" }, issue._id, "in_progress");
    assert.equal(started.status, "in_progress");
  });
});

describe("Project isolation (ADR-0007 §11)", () => {
  it("creating a Project leaves remediation byte-for-byte unchanged", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const before = await raw(issue._id);
    await createProject(asActor(w.other), { title: "Community fix", description: "Volunteers", originIssue: issue._id });
    const after = await raw(issue._id);
    assert.deepEqual(after.remediation, before.remediation);
    assert.deepEqual(after.remediationHistory, before.remediationHistory);
    assert.deepEqual(after.statusHistory, before.statusHistory);
  });

  it("createProject reads only `status` of the Issue (never remediation)", async () => {
    const issue = await issueWithAcceptedGrant(w);
    let projection;
    const original = Issue.findById.bind(Issue);
    Issue.findById = (...args) => {
      const q = original(...args);
      const then = q.then.bind(q);
      q.then = (res, rej) => then((doc) => { projection = { ...q._fields }; return res ? res(doc) : doc; }, rej);
      return q;
    };
    try {
      await createProject(asActor(w.other), { title: "Community fix", description: "Volunteers", originIssue: issue._id });
    } finally {
      Issue.findById = original;
    }
    assert.deepEqual(projection, { status: 1 });
  });
});

describe("pre-existing (legacy) issues without the new fields keep working", () => {
  it("loads, transitions, receives a grant, and serializes without error", async () => {
    const legacyId = (
      await Issue.collection.insertOne({
        title: "Legacy report",
        description: "Created before ADR-0007",
        location: { type: "Point", coordinates: [77.5, 12.9] },
        reportedBy: (await User.findOne({ _id: w.reporter.id }))._id,
        status: "open",
        statusHistory: [{ _id: new Issue.base.Types.ObjectId(), fromStatus: null, toStatus: "open", actor: (await User.findOne({ _id: w.reporter.id }))._id, timestamp: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;
    assert.equal("remediation" in (await raw(legacyId)), false);

    const ack = await changeStatus(asActor(w.expert1), legacyId, "acknowledged");
    assert.equal(ack.status, "acknowledged");
    const granted = await grantRemediation(asActor(w.expert1), legacyId, w.grantee.id);
    assert.ok(granted.remediation);
    assert.equal(granted.remediationHistory.length, 1);
    assert.doesNotThrow(() => JSON.stringify(granted));
    assert.equal("remediation" in JSON.parse(JSON.stringify(granted)), false);
  });
});

describe("legality is still checked before authorization (ADR-0003)", () => {
  it("an illegal target is INVALID_STATE for anyone, regardless of grants", async () => {
    const issue = await acknowledgedIssue(w);
    await expectCode(changeStatus(asActor(w.other), issue._id, "verified"), "INVALID_STATE");
    await expectCode(changeStatus(asActor(w.expert1), issue._id, "resolved"), "INVALID_STATE");
  });
});

describe("withInterleave harness sanity", () => {
  it("fires exactly once between the pre-read and the write, then restores findById", async () => {
    const issue = await acknowledgedIssue(w);
    const originalFn = Issue.findById;
    let fired = 0;
    await withInterleave(async () => { fired += 1; }, () => changeStatus(asActor(w.expert1), issue._id, "acknowledged").catch(() => {}));
    assert.equal(fired, 1);
    assert.equal(Issue.findById, originalFn);
  });
});
