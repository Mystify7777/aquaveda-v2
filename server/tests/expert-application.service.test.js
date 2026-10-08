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
import { createFixtureUser, provisionVerifiedExpert } from "./helpers/expert.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

const rejectsWith = (p, code) =>
  assert.rejects(p, (err) => {
    assert.equal(err.code, code);
    return true;
  });

const stored = (id) => User.findById(id).lean();

describe("applyForExpert", () => {
  it("USER creates a pending application; history records none -> pending", async () => {
    const u = await createFixtureUser("USER");
    const dto = await applyForExpert(u.ctx);
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
    await rejectsWith(applyForExpert(null), DomainErrorCode.UNAUTHORIZED);
  });

  it("EXPERT and ADMIN cannot apply", async () => {
    for (const role of ["EXPERT", "ADMIN"]) {
      const u = await createFixtureUser(role);
      await rejectsWith(applyForExpert(u.ctx), DomainErrorCode.FORBIDDEN);
    }
  });

  it("stale USER token but stored role EXPERT is rejected by the stored role", async () => {
    const { expert } = await provisionVerifiedExpert();
    await rejectsWith(applyForExpert({ id: expert.id, role: "USER" }), DomainErrorCode.INVALID_STATE);
    const u = await createFixtureUser("EXPERT");
    await rejectsWith(applyForExpert({ id: u.id, role: "USER" }), DomainErrorCode.FORBIDDEN);
  });

  it("duplicate active (pending) request is rejected and appends nothing", async () => {
    const u = await createFixtureUser("USER");
    await applyForExpert(u.ctx);
    await rejectsWith(applyForExpert(u.ctx), DomainErrorCode.INVALID_STATE);
    assert.equal((await stored(u.id)).expertApplication.history.length, 1);
  });

  it("concurrent double-apply: exactly one wins, one history entry", async () => {
    const u = await createFixtureUser("USER");
    const results = await Promise.allSettled([applyForExpert(u.ctx), applyForExpert(u.ctx)]);
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
    await applyForExpert(u.ctx);
    await rejectExpertApplication(admin.ctx, u.id, "needs more detail");
    const dto = await applyForExpert(u.ctx);
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
    await rejectsWith(applyForExpert(expert.ctx), DomainErrorCode.FORBIDDEN);
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
    await applyForExpert(a.ctx);
    await applyForExpert(b.ctx);
    await rejectExpertApplication(admin.ctx, a.id, "insufficient detail");
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
    await applyForExpert(applicant.ctx);
    const { expert } = await provisionVerifiedExpert();
    const user = await createFixtureUser("USER");
    for (const actor of [user.ctx, expert.ctx]) {
      await rejectsWith(approveExpertApplication(actor, applicant.id), DomainErrorCode.FORBIDDEN);
      await rejectsWith(rejectExpertApplication(actor, applicant.id), DomainErrorCode.FORBIDDEN);
    }
    await rejectsWith(approveExpertApplication(null, applicant.id), DomainErrorCode.UNAUTHORIZED);
    const doc = await stored(applicant.id);
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication.status, "pending");
    assert.equal(doc.expertApplication.history.length, 1);
  });

  it("an applicant cannot approve their own application", async () => {
    const u = await createFixtureUser("USER");
    await applyForExpert(u.ctx);
    await rejectsWith(approveExpertApplication(u.ctx, u.id), DomainErrorCode.FORBIDDEN);
    assert.equal((await stored(u.id)).role, "USER");
  });

  it("an ADMIN actor never decides their own application (self guard)", async () => {
    const admin = await createFixtureUser("ADMIN", {
      expertApplication: {
        status: "pending",
        history: [{ fromStatus: null, toStatus: "pending", actor: fakeObjectId() }],
      },
    });
    await rejectsWith(approveExpertApplication(admin.ctx, admin.id), DomainErrorCode.FORBIDDEN);
  });

  it("non-ADMIN is refused before the target is even looked up", async () => {
    const user = await createFixtureUser("USER");
    await rejectsWith(approveExpertApplication(user.ctx, fakeObjectId()), DomainErrorCode.FORBIDDEN);
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
    await applyForExpert(u.ctx);
    const dto = await approveExpertApplication(admin.ctx, u.id);
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
    await applyForExpert(u.ctx);
    await rejectExpertApplication(admin.ctx, u.id, "not enough evidence");
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
    await applyForExpert(u.ctx);
    await check();
    await rejectExpertApplication(admin.ctx, u.id);
    await check();
    await applyForExpert(u.ctx);
    await check();
    await approveExpertApplication(admin.ctx, u.id);
    await check();
  });

  it("already-approved cannot be approved or rejected again", async () => {
    const { admin, expert } = await provisionVerifiedExpert();
    await rejectsWith(approveExpertApplication(admin.ctx, expert.id), DomainErrorCode.INVALID_STATE);
    await rejectsWith(rejectExpertApplication(admin.ctx, expert.id), DomainErrorCode.INVALID_STATE);
    const doc = await stored(expert.id);
    assert.equal(doc.role, "EXPERT");
    assert.equal(doc.expertApplication.history.length, 2);
  });

  it("rejected cannot be approved or rejected again without re-applying", async () => {
    const admin = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyForExpert(u.ctx);
    await rejectExpertApplication(admin.ctx, u.id);
    await rejectsWith(approveExpertApplication(admin.ctx, u.id), DomainErrorCode.INVALID_STATE);
    await rejectsWith(rejectExpertApplication(admin.ctx, u.id), DomainErrorCode.INVALID_STATE);
    assert.equal((await stored(u.id)).role, "USER");
  });

  it("nonexistent user, user without an application, malformed id", async () => {
    const admin = await createFixtureUser("ADMIN");
    const plain = await createFixtureUser("USER");
    await rejectsWith(approveExpertApplication(admin.ctx, fakeObjectId()), DomainErrorCode.NOT_FOUND);
    await rejectsWith(approveExpertApplication(admin.ctx, plain.id), DomainErrorCode.NOT_FOUND);
    await rejectsWith(rejectExpertApplication(admin.ctx, plain.id), DomainErrorCode.NOT_FOUND);
    await rejectsWith(approveExpertApplication(admin.ctx, "not-an-id"), DomainErrorCode.VALIDATION_FAILED);
  });

  it("concurrent approve vs reject: exactly one wins; role matches the winner", async () => {
    const admin1 = await createFixtureUser("ADMIN");
    const admin2 = await createFixtureUser("ADMIN");
    const u = await createFixtureUser("USER");
    await applyForExpert(u.ctx);
    const results = await Promise.allSettled([
      approveExpertApplication(admin1.ctx, u.id),
      rejectExpertApplication(admin2.ctx, u.id),
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
    await applyForExpert(a.ctx);
    await applyForExpert(b.ctx);
    await applyForExpert(c.ctx);
    await approveExpertApplication(admin.ctx, b.id);

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
    await applyForExpert(nope.ctx);
    await rejectExpertApplication(admin.ctx, nope.id);
    const k2 = await createKnowledge(author.ctx, { title: "Swales", body: "Dig a swale." });
    await submitForReview(author.ctx, String(k2._id));
    await rejectsWith(approve({ id: nope.id, role: "USER" }, String(k2._id)), DomainErrorCode.FORBIDDEN);
  });
});
