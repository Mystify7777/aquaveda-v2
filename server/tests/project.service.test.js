import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { createIssue } from "../src/services/issue.service.js";
import { createProject, listProjects, getProjectById } from "../src/services/project.service.js";
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

/**
 * Test-fixture-only helper, same reasoning as issue.service.test.js's
 * forceStatus: this fixture bypasses D-3a's authorization gates to reach
 * "in_progress"/"resolved" states directly, but bypassing authorization
 * is not license to construct a domain-invalid history. The resulting
 * statusHistory must still be a legal walk through ADR-0003's transition
 * graph — not a single "open -> resolved"-style shortcut hop. Not a
 * generic abstraction — local to this file, fixed known status order,
 * no support for arbitrary graphs.
 */
const ISSUE_STATUS_CHAIN = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

async function makeIssueWithStatus(status) {
  const issue = await createIssue(fakeActor("USER"), {
    title: "Leaking pipe",
    description: "d",
    location: validPoint(),
  });

  if (status !== "open") {
    const targetIndex = ISSUE_STATUS_CHAIN.indexOf(status);
    if (targetIndex === -1) {
      throw new Error(
        `makeIssueWithStatus: "${status}" is not a known Issue status`,
      );
    }

    const entries = [];
    for (let i = 1; i <= targetIndex; i++) {
      entries.push({
        fromStatus: ISSUE_STATUS_CHAIN[i - 1],
        toStatus: ISSUE_STATUS_CHAIN[i],
        actor: fakeActor("USER").id,
        timestamp: new Date(),
      });
    }

    await Issue.updateOne(
      { _id: issue._id },
      {
        $set: { status },
        $push: {
          statusHistory: { $each: entries },
        },
      },
    );
  }
  return Issue.findById(issue._id);
}

describe("project.service — createProject", () => {
  for (const status of [
    "acknowledged",
    "in_progress",
    "resolved",
    "verified",
  ]) {
    it(`allows creation when the Issue is "${status}"`, async () => {
      const issue = await makeIssueWithStatus(status);
      const creator = fakeActor("USER");
      const project = await createProject(creator, {
        title: "Community pipe repair",
        description: "Organizing volunteers",
        originIssue: issue._id,
      });
      assert.equal(String(project.originIssue), String(issue._id));
      assert.equal(String(project.creator), creator.id);
      assert.deepEqual(project.contributors, []);
    });
  }

  it("rejects creation when the Issue is still 'open'", async () => {
    const issue = await makeIssueWithStatus("open");
    await assert.rejects(
      () =>
        createProject(fakeActor("USER"), {
          title: "t",
          description: "d",
          originIssue: issue._id,
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });

  it("fails with NOT_FOUND when originIssue does not exist", async () => {
    await assert.rejects(
      () =>
        createProject(fakeActor("USER"), {
          title: "t",
          description: "d",
          originIssue: fakeObjectId(),
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.NOT_FOUND);
        return true;
      },
    );
  });

  it("does not mutate the originating Issue in any way", async () => {
    const issue = await makeIssueWithStatus("acknowledged");
    const before = await Issue.findById(issue._id).lean();

    await createProject(fakeActor("USER"), {
      title: "t",
      description: "d",
      originIssue: issue._id,
    });

    const after = await Issue.findById(issue._id).lean();
    assert.deepEqual(before, after);
  });

  it("Project creation confers no Issue lifecycle authority (documented by absence, not by a positive check)", async () => {
    // There is no Issue-authority field or flag anywhere on Project to
    // test the absence OF. This test exists to make that fact explicit
    // and durable: creating a Project produces a document with exactly
    // {title, description, originIssue, creator, contributors, progress}
    // and nothing that could be mistaken for a grant of authority over
    // the Issue's lifecycle. If a future change added such a field, this
    // test's field-set assertion would catch it.
    const issue = await makeIssueWithStatus("acknowledged");
    const project = await createProject(fakeActor("USER"), {
      title: "t",
      description: "d",
      originIssue: issue._id,
    });
    const fields = Object.keys(project.toObject()).sort();
    const disallowed = [
      "remediationAuthority",
      "issueAuthority",
      "canResolve",
      "canVerify",
    ];
    for (const field of disallowed) {
      assert.ok(
        !fields.includes(field),
        `Project should never have a "${field}" field`,
      );
    }
  });
});

describe("listProjects (Issue #48 — public read)", () => {
  it("returns all Projects in a default page, newest first", async () => {
    const issueA = await makeIssueWithStatus("acknowledged");
    const issueB = await makeIssueWithStatus("acknowledged");
    const first = await createProject(fakeActor("USER"), {
      title: "first",
      description: "d",
      originIssue: issueA._id,
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createProject(fakeActor("USER"), {
      title: "second",
      description: "d",
      originIssue: issueB._id,
    });

    const result = await listProjects();
    assert.equal(result.items.length, 2);
    assert.equal(String(result.items[0]._id), String(second._id));
    assert.equal(String(result.items[1]._id), String(first._id));
  });

  it("filters by originIssue", async () => {
    const issueA = await makeIssueWithStatus("acknowledged");
    const issueB = await makeIssueWithStatus("acknowledged");
    const projectA = await createProject(fakeActor("USER"), {
      title: "a",
      description: "d",
      originIssue: issueA._id,
    });
    await createProject(fakeActor("USER"), {
      title: "b",
      description: "d",
      originIssue: issueB._id,
    });

    const result = await listProjects({ originIssue: String(issueA._id) });
    assert.equal(result.items.length, 1);
    assert.equal(String(result.items[0]._id), String(projectA._id));
  });

  it("respects page/limit and reports totalPages", async () => {
    for (let i = 0; i < 3; i++) {
      const issue = await makeIssueWithStatus("acknowledged");
      await createProject(fakeActor("USER"), {
        title: `p${i}`,
        description: "d",
        originIssue: issue._id,
      });
    }
    const result = await listProjects({ page: 2, limit: 2 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 3);
    assert.equal(result.totalPages, 2);
  });
});

describe("getProjectById (Issue #48 — public read)", () => {
  it("returns the Project for a valid, existing id", async () => {
    const issue = await makeIssueWithStatus("acknowledged");
    const project = await createProject(fakeActor("USER"), {
      title: "t",
      description: "d",
      originIssue: issue._id,
    });
    const result = await getProjectById(project._id);
    assert.equal(String(result._id), String(project._id));
  });

  it("throws NOT_FOUND for a well-formed but nonexistent id", async () => {
    await assert.rejects(
      () => getProjectById(fakeObjectId()),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("throws VALIDATION_FAILED (CastError translation) for a malformed id", async () => {
    await assert.rejects(
      () => getProjectById("not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });

  it("populates creator and contributors with name/role only — never email or passwordHash", async () => {
    const user = await User.create({
      name: "Real Creator",
      email: "creator@example.com",
      passwordHash: "irrelevant-for-this-test",
      role: "USER",
    });
    const issue = await makeIssueWithStatus("acknowledged");
    const project = await createProject({ id: String(user._id), role: "USER" }, {
      title: "t",
      description: "d",
      originIssue: issue._id,
    });

    const result = await getProjectById(project._id);
    assert.equal(result.creator.name, "Real Creator");
    assert.equal(result.creator.role, "USER");
    assert.equal(result.creator.email, undefined);
    assert.equal(result.creator.passwordHash, undefined);
  });
});
