import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { createIssue, changeStatus, disposeIssue } from "../src/services/issue.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { grantRemediation } from "../src/services/remediation.service.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
  validPoint,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

async function openIssue(reporter) {
  return createIssue(reporter, {
    title: "Leaking pipe",
    description: "Water pooling near the market",
    location: validPoint(),
  });
}

describe("Issue #199 — dispositions", () => {
  it("EXPERT can mark an open Issue invalid with a required reason", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const issue = await openIssue(reporter);

    const updated = await disposeIssue(expert, issue._id, "invalid", { note: "Not an environmental issue." });

    assert.equal(updated.status, "open");
    assert.equal(updated.disposition.type, "invalid");
    assert.equal(updated.disposition.note, "Not an environmental issue.");
    assert.equal(String(updated.disposition.actor), expert.id);
    assert.equal(updated.dispositionHistory.length, 1);
  });

  it("reporter can withdraw their own open Issue, but another USER cannot", async () => {
    const reporter = fakeActor("USER");
    const other = fakeActor("USER");
    const issue = await openIssue(reporter);

    await assert.rejects(
      () => disposeIssue(other, issue._id, "withdrawn"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );

    const updated = await disposeIssue(reporter, issue._id, "withdrawn");
    assert.equal(updated.disposition.type, "withdrawn");
    assert.equal(updated.disposition.note, undefined);
  });

  it("duplicate requires a distinct, live canonical Issue", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const duplicate = await openIssue(reporter);
    const canonical = await openIssue(fakeActor("USER"));

    await assert.rejects(
      () => disposeIssue(expert, duplicate._id, "duplicate", { note: "Same report.", canonicalIssueId: duplicate._id }),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );

    const updated = await disposeIssue(expert, duplicate._id, "duplicate", {
      note: "Same report as the canonical submission.",
      canonicalIssueId: canonical._id,
    });
    assert.equal(updated.disposition.type, "duplicate");
    assert.equal(String(updated.disposition.canonicalIssueId), String(canonical._id));
    assert.equal((await Issue.findById(canonical._id)).disposition, undefined);
  });

  it("concurrent duplicate creation and canonical disposal serialize safely", async () => {
    const duplicate = await openIssue(fakeActor("USER"));
    const canonical = await openIssue(fakeActor("USER"));
    const expert = fakeActor("EXPERT");

    const results = await Promise.allSettled([
      disposeIssue(expert, duplicate._id, "duplicate", {
        note: "Same report.",
        canonicalIssueId: canonical._id,
      }),
      disposeIssue(expert, canonical._id, "invalid", { note: "Not actionable." }),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      results.find((r) => r.status === "rejected").reason.code,
      DomainErrorCode.INVALID_STATE,
    );

    const duplicateAfter = await Issue.findById(duplicate._id);
    const canonicalAfter = await Issue.findById(canonical._id);

    if (duplicateAfter.disposition?.type === "duplicate") {
      assert.equal(canonicalAfter.disposition, undefined);
    } else {
      assert.equal(canonicalAfter.disposition?.type, "invalid");
      assert.equal(duplicateAfter.disposition, undefined);
    }
  });

  it("an Issue already serving as canonical cannot be disposed", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const duplicate = await openIssue(reporter);
    const canonical = await openIssue(fakeActor("USER"));

    await disposeIssue(expert, duplicate._id, "duplicate", {
      note: "Same report.",
      canonicalIssueId: canonical._id,
    });

    await assert.rejects(
      () => disposeIssue(expert, canonical._id, "invalid", { note: "No longer canonical." }),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );

    const stillCanonical = await Issue.findById(canonical._id);
    assert.equal(stillCanonical.disposition, undefined);
  });

  it("a disposed Issue cannot re-enter lifecycle or remediation", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const issue = await openIssue(reporter);
    await disposeIssue(expert, issue._id, "invalid", { note: "Not actionable." });

    await assert.rejects(
      () => changeStatus(expert, issue._id, "acknowledged"),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );
    await assert.rejects(
      () => grantRemediation(expert, issue._id, fakeActor("USER").id),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );
  });

  it("two concurrent disposition attempts produce exactly one terminal outcome", async () => {
    const reporter = fakeActor("USER");
    const expertA = fakeActor("EXPERT");
    const expertB = fakeActor("EXPERT");
    const issue = await openIssue(reporter);

    const results = await Promise.allSettled([
      disposeIssue(expertA, issue._id, "invalid", { note: "A" }),
      disposeIssue(expertB, issue._id, "duplicate", {
        note: "B",
        canonicalIssueId: (await openIssue(fakeActor("USER")))._id,
      }),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.ok(
      [DomainErrorCode.STATE_RACE, DomainErrorCode.FORBIDDEN].includes(
        results.find((r) => r.status === "rejected").reason.code,
      ),
    );

    const final = await Issue.findById(issue._id);
    assert.ok(final.disposition);
    assert.equal(final.dispositionHistory.length, 1);
  });

  it("dispositions are unavailable outside the open triage state", async () => {
    const reporter = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const issue = await openIssue(reporter);
    await changeStatus(expert, issue._id, "acknowledged");

    await assert.rejects(
      () => disposeIssue(expert, issue._id, "invalid", { note: "Too late." }),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });
});
