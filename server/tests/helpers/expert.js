import { User } from "../../src/models/User.js";
import {
  applyForExpert,
  approveExpertApplication,
} from "../../src/services/expert-application.service.js";

/**
 * Test/development fixture for the Expert authority path (#91).
 *
 * Produces a verified EXPERT by driving the REAL lifecycle:
 *   USER --applyForExpert--> pending --ADMIN approveExpertApplication--> EXPERT
 * No direct `role: "EXPERT"` write, so the resulting document (role +
 * expertApplication.status + history) is indistinguishable from a
 * genuinely approved Expert and exercises the same authorization.
 *
 * The ADMIN actor is a direct-write fixture ONLY because ADMIN
 * provisioning belongs to #89. This module lives under tests/ — it is
 * not importable from src/, exposes no HTTP surface, and cannot run
 * in production.
 */

let seq = 0;

/**
 * A valid application submission (EXP-L9+). Override any field per test.
 * Satisfies every domain rule: 1 area, experience >= 80 chars, ack v1.
 */
export function validSubmission(overrides = {}) {
  return {
    expertiseAreas: ["groundwater_wells"],
    experience:
      "Ten years of borewell recharge monitoring across three districts, including community training and quarterly reporting.",
    acknowledgement: { version: 1 },
    ...overrides,
  };
}

export async function createFixtureUser(role = "USER", overrides = {}) {
  seq += 1;
  const user = await User.create({
    name: `Fixture ${role} ${seq}`,
    email: `fixture-${role.toLowerCase()}-${seq}-${Date.now()}@example.test`,
    passwordHash: "fixture-user-never-signs-in",
    role,
    ...overrides,
  });
  return { id: String(user._id), role, ctx: { id: String(user._id), role } };
}

/** @returns {{ expert, admin }} — expert.ctx carries role "EXPERT" as persisted by approval. */
export async function provisionVerifiedExpert({ admin } = {}) {
  const reviewer = admin ?? (await createFixtureUser("ADMIN"));
  const applicant = await createFixtureUser("USER");
  const applied = await applyForExpert(applicant.ctx, validSubmission());
  await approveExpertApplication(reviewer.ctx, applicant.id, { revision: applied.history.length });
  return {
    admin: reviewer,
    expert: { id: applicant.id, role: "EXPERT", ctx: { id: applicant.id, role: "EXPERT" } },
  };
}

/**
 * Promote an EXISTING registered user (e.g. one holding a real access
 * token) to EXPERT through the real lifecycle — apply, then approval by a
 * fixture ADMIN. Replaces direct `role: "EXPERT"` writes in suites that
 * need a persisted Expert (#90). The caller's token stays valid: the
 * middleware reads role fresh from the database on every request (L11).
 */
export async function promoteToExpertViaLifecycle(userId) {
  const id = String(userId);
  const admin = await createFixtureUser("ADMIN");
  const applied = await applyForExpert({ id, role: "USER" }, validSubmission());
  await approveExpertApplication(admin.ctx, id, { revision: applied.history.length });
}
