/**
 * Browser-suite fixture seeding (#85). Test-only; not part of the app.
 *
 * Writes the minimum data the public smoke flows need (one Issue, one approved
 * Knowledge article, one Project) by calling the real domain services, so
 * lifecycle rules (ADR-0003/0004, project eligibility) are exercised rather
 * than bypassed. The only direct writes are the two User documents: EXPERT has
 * no provisioning path yet (#89/#91), and acknowledging an Issue / approving
 * Knowledge is EXPERT-only. These users never sign in.
 *
 * Safety: it wipes every collection first (idempotent re-runs), so it refuses
 * to run unless MONGO_URI is a loopback host AND an `_e2e` database. Checked
 * (see e2e-seed-guard.js) before connectDB() or any write.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_e2e node server/scripts/seed-e2e.js
 */
import { readFileSync } from "node:fs";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { Comment } from "../src/models/Comment.js";
import { Issue } from "../src/models/Issue.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { Project } from "../src/models/Project.js";
import { Session } from "../src/models/Session.js";
import { User } from "../src/models/User.js";
import { changeStatus, createIssue } from "../src/services/issue.service.js";
import {
  approve,
  createKnowledge,
  submitForReview,
} from "../src/services/knowledge.service.js";
import { createProject } from "../src/services/project.service.js";
import { assertE2eDatabase } from "./e2e-seed-guard.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../../e2e/fixtures.json", import.meta.url), "utf8"),
);

async function main() {
  assertE2eDatabase(process.env.MONGO_URI);
  await connectDB();

  await Promise.all(
    [Comment, Project, Knowledge, Issue, Session, User].map((m) => m.deleteMany({})),
  );

  const passwordHash = "e2e-fixture-user-never-signs-in";
  const reporter = await User.create({
    name: "E2E Reporter",
    email: "e2e-reporter@example.test",
    passwordHash,
    role: "USER",
  });
  const expert = await User.create({
    name: "E2E Expert",
    email: "e2e-expert@example.test",
    passwordHash,
    role: "EXPERT",
  });
  const reporterCtx = { id: String(reporter._id), role: "USER" };
  const expertCtx = { id: String(expert._id), role: "EXPERT" };

  const issue = await createIssue(reporterCtx, {
    title: fixtures.issueTitle,
    description: "Water pooling near the market after the weekend.",
    location: { type: "Point", coordinates: [77.5, 12.9] },
  });
  await changeStatus(expertCtx, String(issue._id), "acknowledged");

  const article = await createKnowledge(reporterCtx, {
    title: fixtures.knowledgeTitle,
    body: "Collect roof runoff in a covered barrel and filter before use.",
  });
  await submitForReview(reporterCtx, String(article._id));
  await approve(expertCtx, String(article._id));

  await createProject(reporterCtx, {
    title: fixtures.projectTitle,
    description: "Volunteers organising a repair drive.",
    originIssue: issue._id,
  });

  console.log("[seed-e2e] fixtures ready");
}

main()
  .catch((error) => {
    console.error("[seed-e2e] failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
