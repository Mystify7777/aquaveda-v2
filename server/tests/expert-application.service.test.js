import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { User } from "../src/models/User.js";
import { DomainErrorCode } from "../src/services/errors.js";
import {
  applyForExpert,
  getMyExpertApplication,
  listPendingExpertApplications,
  approveExpertApplication,
  rejectExpertApplication,
} from "../src/services/expert-application.service.js";
import { createKnowledge, submitForReview, approve } from "../src/services/knowledge.service.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeObjectId } from "./helpers/testDb.js";
import { createFixtureUser, provisionVerifiedExpert, validSubmission } from "./helpers/expert.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const rejectsWith = (p, code) =>
  assert.rejects(p, (err) => {
    assert.equal(err.code, code);
    return true;
  });

const stored = (id) => User.findById(id).lean();

/**
 * Migration shims (EXP-L9+): the service now takes a submission and the
 * `revision` the reviewer saw. These wrappers model a reviewer who has just
 * seen the CURRENT application; tests that exercise staleness pass an explicit
 * `revision` through the real functions instead.
 */
const applyApp = (ctx, submission = validSubmission()) => applyForExpert(ctx, submission);
const currentRevision = async (id) => {
  try {
    const u = await User.findById(id).select("expertApplication").lean();
    return u?.expertApplication?.history?.length ?? 1;
  } catch {
    return 1; // malformed id: let the service report it
  }
};
const approveApp = async (ctx, id, extra = {}) =>
  approveExpertApplication(ctx, id, { revision: await currentRevision(id), ...extra });
const rejectApp = async (ctx, id, note = "Not enough detail to verify expertise") =>
  rejectExpertApplication(ctx, id, {
    revision: await currentRevision(id),
    ...(typeof note === "object" ? note : { note }),
  });

describe("applyForExpert", () => {
  it("USER creates a pending application; history records none -> pending", async () => {
    const u = await createFixtureUser("USER");
    const dto = await applyApp(u.ctx);
    assert.equal(dto.status, "pending");
    assert.equal(dto.history.length, 1);
    assert.equal(dto.history[0].fromStatus, null);
    assert.equal(dto.history[0].toStatus, "pending");
    assert.equal("actor" in dto.history[0], false, "applicant DTO hides reviewer/actor identity");

    const doc = await stored(u.id);
    assert.equal(doc.role, "USER", "applying grants nothing");
    assert.equal(String(doc.expertApplication.history[0].actor), u.id);
  });

  it("requires an identified actor", async () => {
    await rejectsWith(applyApp(null), DomainErrorCode.UNAUTHORIZED);
  });

  it("EXPERT and ADMIN cannot apply", async () => {
    for (const role of ["EXPERT", "ADMIN"]) {
      const u = await createFixtureUser(role);
      await rejectsWith(applyApp(u.ctx), DomainErrorCode.FORBIDDEN);
    }
  });

  it("stale USER token but stored role EXPERT is rejected by the stored role", async () => {
    const { expert } = await provisionVerifiedExpert();
    await rejectsWith(applyApp({ id: expert.id, role: "USER" }), DomainErrorCode.INVALID_STATE);
    const u = await createFixtureUser("EXPERT");
    await rejectsWith(applyApp({ id: u.id, role: "USER" }), DomainErrorCode.FORBIDDEN);
  });

  it("duplicate active (pending) request is rejected and appends nothing", async () => {
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    await rejectsWith(applyApp(u.ctx), DomainErrorCode.INVALID_STATE);
    assert.equal((await stored(u.id)).expertApplication.history.length, 1);
  });

  it("concurrent double-apply: exactly one wins, one history entry", async () => {
    const u = await createFixtureUser("USER");
    const results = await Promise.allSettled([applyApp(u.ctx), applyApp(u.ctx)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r) => r.status === "rejected");
    assert.ok(
      [DomainErrorCode.INVALID_STATE, DomainErrorCode.STATE_RACE].includes(loser.reason.code),
    );
    assert.equal((await stored(u.id)).expertApplication.history.length, 1);
  });

  it("re-application after rejection: rejected -> pending, full history retained", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    await rejectApp(admin.ctx, u.id, "needs more detail");
    const dto = await applyApp(u.ctx);
    assert.equal(dto.status, "pending");
    assert.deepEqual(
      dto.history.map((h) => [h.fromStatus, h.toStatus]),
      [
        [null, "pending"],
        ["pending", "rejected"],
        ["rejected", "pending"],
      ],
    );
    assert.equal((await stored(u.id)).role, "USER");
  });

  it("an approved Expert cannot re-apply", async () => {
    const { expert } = await provisionVerifiedExpert();
    await rejectsWith(applyApp(expert.ctx), DomainErrorCode.FORBIDDEN);
  });
});

describe("getMyExpertApplication", () => {
  it("returns status none when never applied", async () => {
    const u = await createFixtureUser("USER");
    assert.deepEqual(await getMyExpertApplication(u.ctx), { status: "none", history: [] });
  });

  it("returns the caller's own application, including the rejection note", async () => {
    const admin = await createFixtureUser("ADMIN");
    const a = await createFixtureUser("USER");
    const b = await createFixtureUser("USER");
    await applyApp(a.ctx);
    await applyApp(b.ctx);
    await rejectApp(admin.ctx, a.id, "insufficient detail");
    const mine = await getMyExpertApplication(a.ctx);
    assert.equal(mine.status, "rejected");
    assert.equal(mine.history.at(-1).note, "insufficient detail");
    assert.equal((await getMyExpertApplication(b.ctx)).status, "pending");
  });

  it("requires an identified actor", async () => {
    await rejectsWith(getMyExpertApplication(undefined), DomainErrorCode.UNAUTHORIZED);
  });
});

describe("approve / reject authorization", () => {
  it("USER, EXPERT cannot approve or reject; anonymous is UNAUTHORIZED", async () => {
    const applicant = await createFixtureUser("USER");
    await applyApp(applicant.ctx);
    const { expert } = await provisionVerifiedExpert();
    const user = await createFixtureUser("USER");
    for (const actor of [user.ctx, expert.ctx]) {
      await rejectsWith(approveApp(actor, applicant.id), DomainErrorCode.FORBIDDEN);
      await rejectsWith(rejectApp(actor, applicant.id), DomainErrorCode.FORBIDDEN);
    }
    await rejectsWith(approveApp(null, applicant.id), DomainErrorCode.UNAUTHORIZED);
    const doc = await stored(applicant.id);
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication.status, "pending");
    assert.equal(doc.expertApplication.history.length, 1);
  });

  it("an applicant cannot approve their own application", async () => {
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    await rejectsWith(approveApp(u.ctx, u.id), DomainErrorCode.FORBIDDEN);
    assert.equal((await stored(u.id)).role, "USER");
  });

  it("an ADMIN actor never decides their own application (self guard)", async () => {
    const admin = await createFixtureUser("ADMIN", {
      expertApplication: {
        status: "pending",
        history: [{ fromStatus: null, toStatus: "pending", actor: fakeObjectId() }],
      },
    });
    await rejectsWith(approveApp(admin.ctx, admin.id), DomainErrorCode.FORBIDDEN);
  });

  it("non-ADMIN is refused before the target is even looked up", async () => {
    const user = await createFixtureUser("USER");
    await rejectsWith(approveApp(user.ctx, fakeObjectId()), DomainErrorCode.FORBIDDEN);
  });

  it("list queue is ADMIN-only", async () => {
    const user = await createFixtureUser("USER");
    await rejectsWith(listPendingExpertApplications(user.ctx), DomainErrorCode.FORBIDDEN);
  });
});

describe("approve / reject behavior", () => {
  it("approval grants EXPERT atomically and persists the decision", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    const dto = await approveApp(admin.ctx, u.id);
    assert.equal(dto.status, "approved");

    const doc = await stored(u.id);
    assert.equal(doc.role, "EXPERT");
    assert.equal(doc.expertApplication.status, "approved");
    const last = doc.expertApplication.history.at(-1);
    assert.equal(last.fromStatus, "pending");
    assert.equal(last.toStatus, "approved");
    assert.equal(String(last.actor), admin.id);
    assert.ok(last.timestamp instanceof Date);
    assert.equal("reviewer" in doc, false, "no flat reviewer field");
  });

  it("rejection does not grant EXPERT; persists decision and note", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    await rejectApp(admin.ctx, u.id, "not enough evidence");
    const doc = await stored(u.id);
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication.status, "rejected");
    const last = doc.expertApplication.history.at(-1);
    assert.equal(last.toStatus, "rejected");
    assert.equal(last.note, "not enough evidence");
    assert.equal(String(last.actor), admin.id);
  });

  it("invariant: role EXPERT <=> approved application, across every transition", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    const check = async () => {
      const d = await stored(u.id);
      assert.equal(d.role === "EXPERT", d.expertApplication?.status === "approved");
    };
    await check();
    await applyApp(u.ctx);
    await check();
    await rejectApp(admin.ctx, u.id);
    await check();
    await applyApp(u.ctx);
    await check();
    await approveApp(admin.ctx, u.id);
    await check();
  });

  it("already-approved cannot be approved or rejected again", async () => {
    const { admin, expert } = await provisionVerifiedExpert();
    await rejectsWith(approveApp(admin.ctx, expert.id), DomainErrorCode.INVALID_STATE);
    await rejectsWith(rejectApp(admin.ctx, expert.id), DomainErrorCode.INVALID_STATE);
    const doc = await stored(expert.id);
    assert.equal(doc.role, "EXPERT");
    assert.equal(doc.expertApplication.history.length, 2);
  });

  it("rejected cannot be approved or rejected again without re-applying", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    await rejectApp(admin.ctx, u.id);
    await rejectsWith(approveApp(admin.ctx, u.id), DomainErrorCode.INVALID_STATE);
    await rejectsWith(rejectApp(admin.ctx, u.id), DomainErrorCode.INVALID_STATE);
    assert.equal((await stored(u.id)).role, "USER");
  });

  it("nonexistent user, user without an application, malformed id", async () => {
    const admin = await createFixtureUser("ADMIN");
    const plain = await createFixtureUser("USER");
    await rejectsWith(approveApp(admin.ctx, fakeObjectId()), DomainErrorCode.NOT_FOUND);
    await rejectsWith(approveApp(admin.ctx, plain.id), DomainErrorCode.NOT_FOUND);
    await rejectsWith(rejectApp(admin.ctx, plain.id), DomainErrorCode.NOT_FOUND);
    await rejectsWith(approveApp(admin.ctx, "not-an-id"), DomainErrorCode.VALIDATION_FAILED);
  });

  it("concurrent approve vs reject: exactly one wins; role matches the winner", async () => {
    const admin1 = await createFixtureUser("ADMIN");
    const admin2 = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx);
    const results = await Promise.allSettled([
      approveApp(admin1.ctx, u.id),
      rejectApp(admin2.ctx, u.id),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    assert.equal(won.length, 1);
    assert.ok(
      [DomainErrorCode.STATE_RACE, DomainErrorCode.INVALID_STATE].includes(
        results.find((r) => r.status === "rejected").reason.code,
      ),
    );
    const doc = await stored(u.id);
    assert.equal(doc.expertApplication.history.length, 2);
    assert.equal(doc.role === "EXPERT", won[0].value.status === "approved");
  });
});

describe("reviewer queue", () => {
  it("lists only pending applications, oldest first, paginated, without email/hash", async () => {
    const admin = await createFixtureUser("ADMIN");
    const a = await createFixtureUser("USER");
    const b = await createFixtureUser("USER");
    const c = await createFixtureUser("USER");
    await applyApp(a.ctx);
    await applyApp(b.ctx);
    await applyApp(c.ctx);
    await approveApp(admin.ctx, b.id);

    const page = await listPendingExpertApplications(admin.ctx, { page: 1, limit: 10 });
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((i) => i.userId), [a.id, c.id]);
    for (const item of page.items) {
      assert.equal(item.status, "pending");
      assert.equal("email" in item, false);
      assert.equal("passwordHash" in item, false);
      assert.equal(item.history[0].actor, item.userId);
    }
    const p2 = await listPendingExpertApplications(admin.ctx, { page: 2, limit: 1 });
    assert.deepEqual(p2.items.map((i) => i.userId), [c.id]);
    assert.equal(p2.totalPages, 2);
  });
});

describe("fixture: verified EXPERT exercises real authorization (#90 readiness)", () => {
  it("fixture-provisioned EXPERT can approve Knowledge; a rejected applicant cannot", async () => {
    const { expert } = await provisionVerifiedExpert();
    const doc = await stored(expert.id);
    assert.equal(doc.role, "EXPERT");
    assert.equal(doc.expertApplication.status, "approved");
    assert.deepEqual(
      doc.expertApplication.history.map((h) => h.toStatus),
      ["pending", "approved"],
    );

    const author = await createFixtureUser("USER");
    const k = await createKnowledge(author.ctx, { title: "Rain barrels", body: "Collect runoff." });
    await submitForReview(author.ctx, String(k._id));
    const out = await approve(expert.ctx, String(k._id));
    assert.equal(out.status, "approved");

    const admin = await createFixtureUser("ADMIN");
    const nope = await createFixtureUser("USER");
    await applyApp(nope.ctx);
    await rejectApp(admin.ctx, nope.id);
    const k2 = await createKnowledge(author.ctx, { title: "Swales", body: "Dig a swale." });
    await submitForReview(author.ctx, String(k2._id));
    await rejectsWith(approve({ id: nope.id, role: "USER" }, String(k2._id)), DomainErrorCode.FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------
// EXP-L9+ / EXP-L10+ — submission persistence, revision pinning, DTO snapshot
// ---------------------------------------------------------------------------
describe("submission persistence (service)", () => {
  it("rejects a missing or invalid submission with VALIDATION_FAILED and writes nothing", async () => {
    const u = await createFixtureUser("USER");
    for (const input of [undefined, null, {}, validSubmission({ expertiseAreas: [] }), validSubmission({ acknowledgement: { version: 99 } })]) {
      await rejectsWith(applyForExpert(u.ctx, input), DomainErrorCode.VALIDATION_FAILED);
    }
    assert.equal((await stored(u.id)).expertApplication, undefined);
  });

  it("stores the normalized submission on the pending entry with a server-computed hash of the retained text", async () => {
    const { createHash } = await import("node:crypto");
    const { ACKNOWLEDGEMENT_TEXTS } = await import("../src/domain/expert-application-submission.js");
    const u = await createFixtureUser("USER");
    const before = Date.now();
    await applyApp(u.ctx, validSubmission({ affiliation: " Trust ", references: ["https://example.org/x"] }));
    const entry = (await stored(u.id)).expertApplication.history[0];
    assert.equal(entry.submission.affiliation, "Trust");
    assert.deepEqual(entry.submission.references, ["https://example.org/x"]);
    assert.equal(
      entry.submission.acknowledgement.textSha256,
      createHash("sha256").update(ACKNOWLEDGEMENT_TEXTS[1], "utf8").digest("hex"),
    );
    assert.ok(entry.submission.acknowledgement.acceptedAt.getTime() >= before);
    assert.equal(entry.submission.acknowledgement.acceptedAt.getTime(), entry.timestamp.getTime());
  });

  it("each attempt keeps its own submission: reject then re-apply appends a NEW submission, the old one is preserved", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx, validSubmission({ expertiseAreas: ["groundwater_wells"] }));
    await rejectApp(admin.ctx, u.id);
    await applyApp(u.ctx, validSubmission({ expertiseAreas: ["policy_governance"] }));
    const h = (await stored(u.id)).expertApplication.history;
    const pendings = h.filter((e) => e.toStatus === "pending");
    assert.equal(pendings.length, 2);
    assert.deepEqual(pendings[0].submission.expertiseAreas, ["groundwater_wells"]);
    assert.deepEqual(pendings[1].submission.expertiseAreas, ["policy_governance"]);
    assert.ok(h.filter((e) => e.toStatus !== "pending").every((e) => e.submission === undefined));
  });
});

describe("revision-pinned decisions (service)", () => {
  async function pending() {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    const dto = await applyApp(u.ctx);
    return { admin, u, revision: dto.history.length };
  }

  it("missing / invalid revision => VALIDATION_FAILED, before any lookup or write", async () => {
    const { admin, u } = await pending();
    for (const revision of [undefined, 0, -1, 1.5, "1", null, 10_001]) {
      await rejectsWith(approveExpertApplication(admin.ctx, u.id, { revision }), DomainErrorCode.VALIDATION_FAILED);
      await rejectsWith(
        rejectExpertApplication(admin.ctx, u.id, { revision, note: "valid long note" }),
        DomainErrorCode.VALIDATION_FAILED,
      );
    }
    await rejectsWith(approveExpertApplication(admin.ctx, u.id), DomainErrorCode.VALIDATION_FAILED);
    assert.equal((await stored(u.id)).expertApplication.status, "pending");
  });

  it("reject note: required and trimmed 10..500 at the service boundary too", async () => {
    const { admin, u, revision } = await pending();
    for (const note of [undefined, "", "   ", "123456789", "x".repeat(501)]) {
      await rejectsWith(rejectExpertApplication(admin.ctx, u.id, { revision, note }), DomainErrorCode.VALIDATION_FAILED);
    }
    const ok = await rejectExpertApplication(admin.ctx, u.id, { revision, note: "  0123456789  " });
    assert.equal(ok.history.at(-1).note, "0123456789");
  });

  it("stale revision => STATE_RACE; zero writes, no role change (reject -> re-apply -> stale approve)", async () => {
    const { admin, u, revision } = await pending();
    const other = await createFixtureUser("ADMIN");
    await rejectExpertApplication(other.ctx, u.id, { revision, note: "needs more detail" });
    await applyApp(u.ctx, validSubmission({ experience: `${validSubmission().experience} Second attempt.` }));
    const snapshot = JSON.stringify(await stored(u.id));

    await rejectsWith(approveExpertApplication(admin.ctx, u.id, { revision }), DomainErrorCode.STATE_RACE);
    await rejectsWith(
      rejectExpertApplication(admin.ctx, u.id, { revision, note: "stale reject attempt" }),
      DomainErrorCode.STATE_RACE,
    );
    assert.equal(JSON.stringify(await stored(u.id)), snapshot, "stale decisions must not change the document at all");
  });

  it("competing decisions on one revision: exactly one wins, one decision entry is written", async () => {
    const { admin, u, revision } = await pending();
    const other = await createFixtureUser("ADMIN");
    const results = await Promise.allSettled([
      rejectExpertApplication(other.ctx, u.id, { revision, note: "first reviewer rejects" }),
      approveExpertApplication(admin.ctx, u.id, { revision }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok([DomainErrorCode.STATE_RACE, DomainErrorCode.INVALID_STATE].includes(rejected.reason.code));
    assert.equal((await stored(u.id)).expertApplication.history.length, 2);
  });

  it("the production decision filter is the atomic guard: it matches only the exact revision and pending status", async () => {
    // Runs the EXACT exported predicate against real data (merge gate: requires
    // real MongoDB). This is what protects the race window between the service's
    // pre-read and its write.
    const { decisionFilter } = await import("../src/services/expert-application.service.js");
    const { u, revision } = await pending();
    const count = (rev) => User.countDocuments(decisionFilter(u.id, rev));
    assert.equal(await count(revision), 1);
    assert.equal(await count(revision + 1), 0, "newer revision than the document has");
    assert.equal(await count(0), 0, "revision 0 never matches a non-empty history");
    // Older-revision boundary: grow the history while keeping status pending
    // (artificial, isolates the $size guard), so `revision` is now one entry stale.
    await User.updateOne(
      { _id: u.id },
      { $push: { "expertApplication.history": { fromStatus: "pending", toStatus: "pending", actor: u.id, timestamp: new Date() } } },
    );
    assert.equal(await count(revision), 0, "an older revision no longer matches after the history grew");
    assert.equal(await count(revision + 1), 1, "the current revision matches");
    await User.updateOne({ _id: u.id }, { $set: { "expertApplication.status": "rejected" } });
    assert.equal(await count(revision + 1), 0, "status must also be pending");
    await User.updateOne({ _id: u.id }, { $set: { "expertApplication.status": "pending", role: "EXPERT" } });
    assert.equal(await count(revision + 1), 0, "role must still be USER");
  });

  it("error contract: a stale revision on a STILL-PENDING application is STATE_RACE; once another decision landed it is INVALID_STATE", async () => {
    const { admin, u, revision } = await pending();
    const other = await createFixtureUser("ADMIN");
    // history grows but the application is still pending (artificial; real flows
    // reach this via reject -> re-apply, covered above)
    await User.updateOne(
      { _id: u.id },
      { $push: { "expertApplication.history": { fromStatus: "pending", toStatus: "pending", actor: u.id, timestamp: new Date() } } },
    );
    await rejectsWith(approveExpertApplication(admin.ctx, u.id, { revision }), DomainErrorCode.STATE_RACE);

    const current = (await stored(u.id)).expertApplication.history.length;
    await approveExpertApplication(other.ctx, u.id, { revision: current });
    // A is now stale AND the application is no longer pending: the pre-read reports status first.
    await rejectsWith(approveExpertApplication(admin.ctx, u.id, { revision }), DomainErrorCode.INVALID_STATE);
    assert.equal((await stored(u.id)).role, "EXPERT");
    assert.equal((await stored(u.id)).expertApplication.history.length, current + 1, "only the winning decision was recorded");
  });

  it("DTO snapshot invariant: for a pending application revision === history.length and submission is the last pending entry's", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyApp(u.ctx, validSubmission({ expertiseAreas: ["groundwater_wells"] }));
    await rejectApp(admin.ctx, u.id);
    await applyApp(u.ctx, validSubmission({ expertiseAreas: ["other"] }));
    const { items } = await listPendingExpertApplications(admin.ctx, { page: 1, limit: 10 });
    const item = items.find((i) => i.userId === u.id);
    assert.equal(item.revision, 3);
    assert.equal(item.history.at(-1).toStatus, "pending");
    assert.deepEqual(item.submission.expertiseAreas, ["other"]);
    assert.deepEqual(item.history[0].submission.expertiseAreas, ["groundwater_wells"]);
    assert.equal(item.history[1].submission, undefined, "decision entries carry no submission key");
  });

  it("legacy pending application: submission null (never fabricated), revision = history length, decidable", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await User.updateOne(
      { _id: u.id },
      { $set: { expertApplication: { status: "pending", history: [{ fromStatus: null, toStatus: "pending", actor: u.id, timestamp: new Date() }] } } },
    );
    const mine = await getMyExpertApplication(u.ctx);
    assert.equal(mine.history[0].submission, null);
    const { items } = await listPendingExpertApplications(admin.ctx, { page: 1, limit: 10 });
    assert.equal(items[0].submission, null);
    assert.equal(items[0].revision, 1);
    const done = await approveExpertApplication(admin.ctx, u.id, { revision: 1 });
    assert.equal(done.status, "approved");
  });
});
