import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { createIssue, changeStatus, listIssues, getIssueById } from "../src/services/issue.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
  fakeObjectId,
  validPoint,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

async function makeOpenIssue(reporter = fakeActor("USER")) {
  return createIssue(reporter, {
    title: "Leaking pipe",
    description: "Water pooling near the market",
    location: validPoint(),
  });
}

/**
 * Test-fixture-only helper. Several tests need an Issue forced directly
 * into a status the service layer cannot currently reach on its own via
 * changeStatus() — specifically "in_progress" and "resolved", which sit
 * behind D-3a's unresolved authorization gates. This fixture is allowed
 * to bypass that authorization check (it's testing what happens around
 * D-3a, not exercising it), but bypassing authorization is not license
 * to construct a domain-invalid history. The resulting statusHistory
 * must still read as a real, legal walk through ADR-0003's transition
 * graph — "open -> verified" in one hop is not a state this Issue could
 * ever actually have reached, D-3a or not.
 *
 * This is NOT a generic lifecycle-replay engine (no shared/exported
 * abstraction, no support for arbitrary graphs) — it's a fixed list of
 * the five known statuses in their one legal forward order, walked from
 * "open" up to whatever status is requested, appending one legitimate
 * transition entry per step. Kept local to this file.
 */
const ISSUE_STATUS_CHAIN = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

async function forceStatus(issueId, status, actorId = fakeActor("USER").id) {
  if (status === "open") return; // creation already leaves the Issue here

  const targetIndex = ISSUE_STATUS_CHAIN.indexOf(status);
  if (targetIndex === -1) {
    throw new Error(`forceStatus: "${status}" is not a known Issue status`);
  }

  const entries = [];
  for (let i = 1; i <= targetIndex; i++) {
    entries.push({
      fromStatus: ISSUE_STATUS_CHAIN[i - 1],
      toStatus: ISSUE_STATUS_CHAIN[i],
      actor: actorId,
      timestamp: new Date(),
    });
  }

  await Issue.updateOne(
    { _id: issueId },
    {
      $set: { status },
      $push: {
        statusHistory: { $each: entries },
      },
    },
  );
}

describe("issue.service — createIssue", () => {
  it("creates an Issue with status 'open'", async () => {
    const reporter = fakeActor("USER");
    const issue = await makeOpenIssue(reporter);
    assert.equal(issue.status, "open");
    assert.equal(String(issue.reportedBy), reporter.id);
  });

  it("initial statusHistory entry is null -> open, actor = reporter", async () => {
    const reporter = fakeActor("USER");
    const issue = await makeOpenIssue(reporter);
    assert.equal(issue.statusHistory.length, 1);
    const entry = issue.statusHistory[0];
    assert.equal(entry.fromStatus, null);
    assert.equal(entry.toStatus, "open");
    assert.equal(String(entry.actor), reporter.id);
    assert.ok(entry.timestamp instanceof Date);
  });

  it("does not accept caller-supplied status or statusHistory", async () => {
    const reporter = fakeActor("USER");
    const issue = await createIssue(reporter, {
      title: "t",
      description: "d",
      location: validPoint(),
      status: "verified", // should be ignored entirely
      statusHistory: [
        { fromStatus: "open", toStatus: "verified", actor: reporter.id },
      ],
    });
    assert.equal(issue.status, "open");
    assert.equal(issue.statusHistory.length, 1);
    assert.equal(issue.statusHistory[0].toStatus, "open");
  });
});

describe("issue.service — changeStatus: legal transitions", () => {
  it("open -> acknowledged succeeds for an EXPERT", async () => {
    const issue = await makeOpenIssue();
    const expert = fakeActor("EXPERT");
    const updated = await changeStatus(expert, issue._id, "acknowledged");
    assert.equal(updated.status, "acknowledged");
    assert.equal(updated.statusHistory.length, 2);
    assert.equal(updated.statusHistory[1].fromStatus, "open");
    assert.equal(updated.statusHistory[1].toStatus, "acknowledged");
    assert.equal(String(updated.statusHistory[1].actor), expert.id);
  });

  it("resolved -> verified succeeds for a DIFFERENT EXPERT than the resolver", async () => {
    const issue = await makeOpenIssue();
    const expertA = fakeActor("EXPERT");
    // Drive to `resolved` directly via the model, bypassing D-3a's
    // unresolved acknowledged->in_progress / in_progress->resolved gates
    // — those transitions cannot be reached through the service at all
    // right now (by design). Setting up `resolved` state directly via
    // the model is the correct way to test the transition THIS service
    // operation actually can perform (resolved -> verified), without
    // pretending D-3a is solved.
    await forceStatus(issue._id, "resolved", expertA.id);

    const expertB = fakeActor("EXPERT");
    const updated = await changeStatus(expertB, issue._id, "verified");
    assert.equal(updated.status, "verified");
    const lastEntry = updated.statusHistory[updated.statusHistory.length - 1];
    assert.equal(lastEntry.fromStatus, "resolved");
    assert.equal(lastEntry.toStatus, "verified");
    assert.equal(String(lastEntry.actor), expertB.id);
  });

  it("resolved -> in_progress (failed verification) succeeds for an EXPERT", async () => {
    const issue = await makeOpenIssue();
    const resolver = fakeActor("USER");
    await forceStatus(issue._id, "resolved", resolver.id);

    const expert = fakeActor("EXPERT");
    const updated = await changeStatus(expert, issue._id, "in_progress");
    assert.equal(updated.status, "in_progress");
    const lastEntry = updated.statusHistory[updated.statusHistory.length - 1];
    assert.equal(lastEntry.fromStatus, "resolved");
    assert.equal(lastEntry.toStatus, "in_progress");
  });
});

describe("issue.service — changeStatus: illegal transitions", () => {
  const illegalCases = [
    ["open", "in_progress"],
    ["open", "resolved"],
    ["open", "verified"],
    ["acknowledged", "resolved"],
    ["acknowledged", "verified"],
    ["acknowledged", "open"],
    ["verified", "resolved"],
    ["verified", "open"],
  ];

  for (const [from, to] of illegalCases) {
    it(`${from} -> ${to} is rejected as INVALID_STATE`, async () => {
      const issue = await makeOpenIssue();
      await forceStatus(issue._id, from);

      await assert.rejects(
        () => changeStatus(fakeActor("EXPERT"), issue._id, to),
        (err) => {
          assert.equal(err.code, DomainErrorCode.INVALID_STATE);
          return true;
        },
      );
    });
  }

  it("verified is terminal — no transition out of it succeeds", async () => {
    const issue = await makeOpenIssue();
    await forceStatus(issue._id, "verified");
    await assert.rejects(() =>
      changeStatus(fakeActor("EXPERT"), issue._id, "resolved"),
    );
  });
});

describe("issue.service — authorization", () => {
  it("open -> acknowledged fails for a non-EXPERT", async () => {
    const issue = await makeOpenIssue();
    await assert.rejects(
      () => changeStatus(fakeActor("USER"), issue._id, "acknowledged"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("resolved -> verified fails for a non-EXPERT", async () => {
    const issue = await makeOpenIssue();
    await forceStatus(issue._id, "resolved", fakeActor().id);
    await assert.rejects(
      () => changeStatus(fakeActor("USER"), issue._id, "verified"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("resolved -> verified fails when the verifier is the same actor as the resolver", async () => {
    const issue = await makeOpenIssue();
    const expert = fakeActor("EXPERT");
    await forceStatus(issue._id, "resolved", expert.id);

    await assert.rejects(
      () => changeStatus(expert, issue._id, "verified"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });
});

describe("issue.service — D-3a: unresolved authorization policy", () => {
  it("acknowledged -> in_progress throws AUTHORIZATION_POLICY_UNRESOLVED for every role, not silently allowed", async () => {
    const issue = await makeOpenIssue();
    await forceStatus(issue._id, "acknowledged");

    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      await assert.rejects(
        () => changeStatus(fakeActor(role), issue._id, "in_progress"),
        (err) => {
          assert.equal(
            err.code,
            DomainErrorCode.AUTHORIZATION_POLICY_UNRESOLVED,
          );
          return true;
        },
        `role ${role} should not be silently authorized`,
      );
    }
  });

  it("in_progress -> resolved throws AUTHORIZATION_POLICY_UNRESOLVED for every role, not silently allowed", async () => {
    const issue = await makeOpenIssue();
    await forceStatus(issue._id, "in_progress");

    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      await assert.rejects(
        () => changeStatus(fakeActor(role), issue._id, "resolved"),
        (err) => {
          assert.equal(
            err.code,
            DomainErrorCode.AUTHORIZATION_POLICY_UNRESOLVED,
          );
          return true;
        },
        `role ${role} should not be silently authorized`,
      );
    }
  });

  it("D-3a rejection does NOT modify the Issue document at all", async () => {
    const issue = await makeOpenIssue();
    await forceStatus(issue._id, "acknowledged");
    const before = await Issue.findById(issue._id).lean();

    await assert.rejects(() =>
      changeStatus(fakeActor("EXPERT"), issue._id, "in_progress"),
    );

    const after = await Issue.findById(issue._id).lean();
    assert.equal(after.status, "acknowledged");
    // Compare against the pre-rejection state directly, rather than a
    // hardcoded history length — this is robust to forceStatus's own
    // fixture-setup entry and asserts the actual invariant that matters:
    // the rejected D-3a call appended nothing and changed nothing.
    assert.equal(after.statusHistory.length, before.statusHistory.length);
    assert.deepEqual(after, before);
  });
});

describe("issue.service — not found and state race", () => {
  it("changeStatus on a non-existent Issue throws NOT_FOUND", async () => {
    await assert.rejects(
      () => changeStatus(fakeActor("EXPERT"), fakeObjectId(), "acknowledged"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.NOT_FOUND);
        return true;
      },
    );
  });

  it("state-race: two concurrent open->acknowledged attempts — exactly one succeeds, one gets STATE_RACE", async () => {
    const issue = await makeOpenIssue();
    const expertA = fakeActor("EXPERT");
    const expertB = fakeActor("EXPERT");

    const results = await Promise.allSettled([
      changeStatus(expertA, issue._id, "acknowledged"),
      changeStatus(expertB, issue._id, "acknowledged"),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    assert.equal(
      succeeded.length,
      1,
      "exactly one of the two concurrent attempts should succeed",
    );
    assert.equal(
      failed.length,
      1,
      "exactly one of the two concurrent attempts should fail",
    );
    assert.equal(failed[0].reason.code, DomainErrorCode.STATE_RACE);

    const reloaded = await Issue.findById(issue._id);
    assert.equal(reloaded.status, "acknowledged");
    // Exactly ONE new history entry was appended, not two — the losing
    // attempt's write never touched the document at all.
    assert.equal(reloaded.statusHistory.length, 2);
  });

  it("state-race: two concurrent resolved->verified attempts by different Experts — exactly one succeeds", async () => {
    const issue = await makeOpenIssue();
    const resolver = fakeActor("USER");
    await forceStatus(issue._id, "resolved", resolver.id);

    const expertA = fakeActor("EXPERT");
    const expertB = fakeActor("EXPERT");

    const results = await Promise.allSettled([
      changeStatus(expertA, issue._id, "verified"),
      changeStatus(expertB, issue._id, "verified"),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    assert.equal(succeeded.length, 1);

    const reloaded = await Issue.findById(issue._id);
    assert.equal(reloaded.status, "verified");

    // The fixture already contains four entries before either concurrent
    // call fires (creation's null->open, then forceStatus's legal walk
    // through open->acknowledged->in_progress->resolved). One winning
    // verification adds a fifth. Asserting the full sequence, not just
    // the length, catches a wider class of bug than a bare count would
    // (e.g. a duplicate entry with the wrong fromStatus wouldn't change
    // the length but would change this sequence).
    const sequence = reloaded.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
    }));
    assert.deepEqual(sequence, [
      { fromStatus: null, toStatus: "open" },
      { fromStatus: "open", toStatus: "acknowledged" },
      { fromStatus: "acknowledged", toStatus: "in_progress" },
      { fromStatus: "in_progress", toStatus: "resolved" },
      { fromStatus: "resolved", toStatus: "verified" },
    ]);

    // The winning verifier is whichever of expertA/expertB actually
    // succeeded — confirm the recorded actor matches that winner, not a
    // hardcoded assumption about which one wins the race.
    const winner = succeeded[0].value;
    const lastEntry = reloaded.statusHistory[reloaded.statusHistory.length - 1];
    assert.equal(
      String(lastEntry.actor),
      String(winner.statusHistory.at(-1).actor),
    );
  });
});

describe("listIssues (Issue #48 — public read)", () => {
  it("returns all Issues in a default page, newest first", async () => {
    const first = await makeOpenIssue();
    await new Promise((r) => setTimeout(r, 5));
    const second = await makeOpenIssue();

    const result = await listIssues();
    assert.equal(result.items.length, 2);
    assert.equal(String(result.items[0]._id), String(second._id));
    assert.equal(String(result.items[1]._id), String(first._id));
    assert.equal(result.total, 2);
    assert.equal(result.page, 1);
  });

  it("filters by status", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const openIssue = await makeOpenIssue(reporter);
    const toAcknowledge = await makeOpenIssue(reporter);
    await changeStatus(expert, toAcknowledge._id, "acknowledged");

    const openResult = await listIssues({ status: "open" });
    assert.equal(openResult.items.length, 1);
    assert.equal(String(openResult.items[0]._id), String(openIssue._id));

    const acknowledgedResult = await listIssues({ status: "acknowledged" });
    assert.equal(acknowledgedResult.items.length, 1);
    assert.equal(String(acknowledgedResult.items[0]._id), String(toAcknowledge._id));
  });

  it("rejects an unrecognized status filter with VALIDATION_FAILED-equivalent INVALID_STATE", async () => {
    await assert.rejects(
      () => listIssues({ status: "not_a_real_status" }),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );
  });

  it("respects page/limit and reports totalPages", async () => {
    for (let i = 0; i < 5; i++) {
      await makeOpenIssue();
    }
    const result = await listIssues({ page: 2, limit: 2 });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 5);
    assert.equal(result.totalPages, 3);
  });

  it("populates reportedBy with name/role only — never email or passwordHash", async () => {
    const user = await User.create({
      name: "Real Reporter",
      email: "reporter@example.com",
      passwordHash: "irrelevant-for-this-test",
      role: "USER",
    });
    const issue = await createIssue({ id: String(user._id), role: "USER" }, {
      title: "Leaking pipe",
      description: "d",
      location: validPoint(),
    });

    const result = await listIssues();
    const returned = result.items.find((i) => String(i._id) === String(issue._id));
    assert.ok(returned);
    assert.equal(returned.reportedBy.name, "Real Reporter");
    assert.equal(returned.reportedBy.role, "USER");
    assert.equal(returned.reportedBy.email, undefined);
    assert.equal(returned.reportedBy.passwordHash, undefined);
  });
});

describe("getIssueById (Issue #48 — public read)", () => {
  it("returns the Issue for a valid, existing id", async () => {
    const issue = await makeOpenIssue();
    const result = await getIssueById(issue._id);
    assert.equal(String(result._id), String(issue._id));
  });

  it("throws NOT_FOUND for a well-formed but nonexistent id", async () => {
    await assert.rejects(
      () => getIssueById(fakeObjectId()),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("throws VALIDATION_FAILED (CastError translation) for a malformed id", async () => {
    await assert.rejects(
      () => getIssueById("not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });
});
