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
  await applyForExpert(applicant.ctx);
  await approveExpertApplication(reviewer.ctx, applicant.id);
  return {
    admin: reviewer,
    expert: { id: applicant.id, role: "EXPERT", ctx: { id: applicant.id, role: "EXPERT" } },
  };
}
