import { User } from "../models/User.js";
import { GovernanceEvent } from "../models/GovernanceEvent.js";
import { buildDirectoryFilter } from "../domain/account-directory.js";
import { requireActor, requireRole } from "./authorization.js";
import { DomainError, DomainErrorCode, notFound } from "./errors.js";
import { toAdminDirectoryEntry } from "./account-directory.dto.js";
import { toAdminGovernanceEvent } from "./governance-event.dto.js";

/**
 * Admin directory reads (#181). ADMIN only, strictly read-only: no lazy
 * expiry, no events, no writes. Contract: docs/architecture/admin-directory.md.
 */

const DIRECTORY_SELECT =
  "name email role createdAt accountState accountStateChangedAt accountRestriction";

const page = (items, total, p, limit) => ({
  items,
  page: p,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
});

function requireAdmin(actorContext) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
}

async function loadTargetOrThrow(userId, select) {
  let user;
  try {
    user = await User.findById(userId).select(select).lean();
  } catch (err) {
    if (err?.name === "CastError") {
      throw new DomainError(DomainErrorCode.VALIDATION_FAILED, "Invalid account id");
    }
    throw err;
  }
  if (!user) throw notFound("Account not found", { resource: "User" });
  return user;
}

export async function listAccountDirectory(
  actorContext,
  { page: p = 1, limit = 20, role, accountState, q } = {},
  { now = new Date() } = {},
) {
  requireAdmin(actorContext);
  const filter = buildDirectoryFilter({ role, accountState, q });
  const [users, total] = await Promise.all([
    User.find(filter)
      .select(DIRECTORY_SELECT)
      .sort({ createdAt: -1, _id: -1 })
      .skip((p - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return page(users.map((u) => toAdminDirectoryEntry(u, now)), total, p, limit);
}

export async function getAccountDirectoryEntry(actorContext, userId, { now = new Date() } = {}) {
  requireAdmin(actorContext);
  return toAdminDirectoryEntry(await loadTargetOrThrow(userId, DIRECTORY_SELECT), now);
}

export async function listAccountGovernanceHistory(actorContext, userId, { page: p = 1, limit = 20 } = {}) {
  requireAdmin(actorContext);
  await loadTargetOrThrow(userId, "_id");
  const filter = { target: userId };
  const [events, total] = await Promise.all([
    GovernanceEvent.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((p - 1) * limit)
      .limit(limit)
      .lean(),
    GovernanceEvent.countDocuments(filter),
  ]);
  // One batched actor lookup per page (no per-event query).
  const actorIds = [...new Set(events.filter((e) => e.actor).map((e) => String(e.actor)))];
  const actors = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select("name").lean()
    : [];
  const byId = new Map(actors.map((a) => [String(a._id), a.name]));
  return page(events.map((e) => toAdminGovernanceEvent(e, byId)), total, p, limit);
}
