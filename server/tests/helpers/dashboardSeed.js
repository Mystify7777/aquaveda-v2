import mongoose from "mongoose";

import { Issue } from "../../src/models/Issue.js";
import { Knowledge } from "../../src/models/Knowledge.js";
import { Project } from "../../src/models/Project.js";
import { createIssue } from "../../src/services/issue.service.js";
import { createKnowledge } from "../../src/services/knowledge.service.js";
import { validPoint } from "./testDb.js";

/**
 * Count-oriented seeding for the Dashboard tests (#53). Lifecycle correctness
 * is owned by the domain suites; these helpers only place records in a given
 * status so aggregation counts can be asserted exactly.
 */

export const actorOf = (u) => ({ id: String(u.id), role: u.role });

export async function seedIssue(reporter, status = "open") {
  const issue = await createIssue(actorOf(reporter), {
    title: `Issue ${status}`,
    description: "Seeded for dashboard counts",
    location: validPoint(),
  });
  if (status !== "open") await Issue.updateOne({ _id: issue._id }, { $set: { status } });
  return issue;
}

export async function seedKnowledge(author, status = "draft") {
  const k = await createKnowledge(actorOf(author), { title: `Article ${status}`, body: "Seeded" });
  if (status !== "draft") await Knowledge.updateOne({ _id: k._id }, { $set: { status } });
  return k;
}

export async function seedProject({ creator, contributors = [], originIssue }) {
  return Project.create({
    title: "Seeded project",
    description: "Seeded for dashboard counts",
    originIssue,
    creator: new mongoose.Types.ObjectId(String(creator.id)),
    contributors: contributors.map((c) => new mongoose.Types.ObjectId(String(c.id))),
  });
}

/** Keys at every depth of a plain JSON-ish value. */
export function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}
