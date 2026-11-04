import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Issue } from "../../src/models/Issue.js";
import { User } from "../../src/models/User.js";
import { changeStatus, createIssue } from "../../src/services/issue.service.js";
import { acceptRemediation, grantRemediation } from "../../src/services/remediation.service.js";
import { validPoint } from "./testDb.js";

/**
 * Fixtures for the remediation/lifecycle suites (#140). Everything is built
 * through the REAL services against the real test database, so fixtures can
 * never put an Issue into a state the domain would not allow.
 */

let seq = 0;

/** A real User document plus its actorContext fields ({ id, role }). */
export async function makeUser(role = "USER", label = role.toLowerCase()) {
  seq += 1;
  const doc = await User.create({
    name: `${label}${seq}`,
    email: `${label}${seq}.${Date.now()}@example.test`,
    passwordHash: "not-a-real-hash",
    role,
  });
  return { id: doc.id, role, name: doc.name };
}

/** The usual cast: a reporter, two EXPERTs, a grantee, a bystander, an ADMIN. */
export async function makeWorld() {
  return {
    reporter: await makeUser("USER", "reporter"),
    expert1: await makeUser("EXPERT", "expert"),
    expert2: await makeUser("EXPERT", "expert"),
    grantee: await makeUser("USER", "grantee"),
    other: await makeUser("USER", "bystander"),
    admin: await makeUser("ADMIN", "admin"),
  };
}

export const asActor = (u) => ({ id: u.id, role: u.role });

export async function openIssue(w) {
  return createIssue(asActor(w.reporter), { title: "Burst pipe", description: "Water everywhere", location: validPoint() });
}

export async function acknowledgedIssue(w) {
  const issue = await openIssue(w);
  return changeStatus(asActor(w.expert1), issue._id, "acknowledged");
}

/** acknowledged, pending grant to `grantee` issued by `grantor`. */
export async function issueWithPendingGrant(w, { grantee = w.grantee, grantor = w.expert1, status = "acknowledged" } = {}) {
  const issue = await acknowledgedIssue(w);
  if (status === "in_progress") await moveToInProgress(w, issue._id);
  return grantRemediation(asActor(grantor), issue._id, grantee.id);
}

/** acknowledged, accepted grant held by `grantee`. */
export async function issueWithAcceptedGrant(w, { grantee = w.grantee, grantor = w.expert1 } = {}) {
  const issue = await issueWithPendingGrant(w, { grantee, grantor });
  return acceptRemediation(asActor(grantee), issue._id);
}

/** Helper for tests that need an `in_progress` issue before granting (re-grant scenarios). */
async function moveToInProgress(w, issueId) {
  const g = await grantRemediation(asActor(w.expert1), issueId, w.grantee.id);
  await acceptRemediation(asActor(w.grantee), issueId);
  await changeStatus(asActor(w.grantee), issueId, "in_progress");
  // remove the helper grant so the caller can issue its own
  await Issue.updateOne({ _id: issueId }, { $unset: { remediation: "" } });
  return g;
}

export async function inProgressIssue(w, opts) {
  const issue = await issueWithAcceptedGrant(w, opts);
  return changeStatus(asActor(opts?.grantee ?? w.grantee), issue._id, "in_progress");
}

export async function resolvedIssue(w, opts) {
  const issue = await inProgressIssue(w, opts);
  return changeStatus(asActor(opts?.grantee ?? w.grantee), issue._id, "resolved", { note: "Replaced the cracked section." });
}

export async function verifiedIssue(w, opts) {
  const issue = await resolvedIssue(w, opts);
  return changeStatus(asActor(w.expert2), issue._id, "verified", { note: "Confirmed on site." });
}

export const reload = (id) => Issue.findById(id);
/** The stored document exactly as MongoDB holds it (no Mongoose casting/defaults). */
export const raw = (id) => Issue.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });

/** assert.rejects with a DomainError code (and optional details subset). */
export async function expectCode(promise, code, detailsSubset) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (detailsSubset) {
      for (const [k, v] of Object.entries(detailsSubset)) assert.equal(err.details?.[k], v, `details.${k}`);
    }
    return true;
  });
}

/**
 * Deterministic race injector. Runs `hook(doc)` AFTER the service's pre-read
 * (`Issue.findById(...)` awaited) returns and BEFORE the service continues —
 * i.e. exactly inside the window a stale snapshot is exposed to. Fires once by
 * default; the hook's own calls are not intercepted. Returns a restore function.
 */
export function interleaveAfterPreRead(hook, { times = 1 } = {}) {
  const originalFn = Issue.findById; // restored by identity, not a bound copy
  const original = originalFn.bind(Issue);
  let remaining = times;
  Issue.findById = (...args) => {
    const query = original(...args);
    if (remaining <= 0) return query;
    const originalThen = query.then.bind(query);
    query.then = (resolve, reject) =>
      originalThen(async (doc) => {
        if (remaining > 0) {
          remaining -= 1;
          await hook(doc);
        }
        return resolve ? resolve(doc) : doc;
      }, reject);
    return query;
  };
  return () => {
    Issue.findById = originalFn;
  };
}

/** Runs `fn` with the injector installed, always restoring it. */
export async function withInterleave(hook, fn, opts) {
  const restore = interleaveAfterPreRead(hook, opts);
  try {
    return await fn();
  } finally {
    restore();
  }
}
