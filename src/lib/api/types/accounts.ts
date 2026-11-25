import type { PaginatedResponse } from "./pagination";

/**
 * Admin account-governance read contract (#181, consumed by #250). Explicit
 * allowlist: these are the ONLY fields the UI reads. The API deliberately omits
 * password hashes, sessions, `bio`, `expertApplication`, credential/state
 * versions, and the private governance `reason`, `references` and
 * `idempotencyKey`; nothing here (or in any renderer) may add them back.
 */
export type DirectoryRole = "USER" | "EXPERT" | "ADMIN";

/**
 * The account states the directory can FILTER by: exactly the backend's
 * `DIRECTORY_STATES` (src/lib/accounts/directory-contract.ts). A test asserts the
 * two stay identical. (Entry/history state fields stay `string`: persisted data
 * and history also carry roles for Expert actions.)
 */
export type DirectoryAccountState =
  | "ACTIVE"
  | "MUTED"
  | "HARD_SUSPENDED"
  | "DELETION_PENDING"
  | "PERMANENTLY_DELETED";

export interface AdminAccountRestriction {
  kind: "TEMPORARY" | "INDEFINITE";
  expiresAt: string | null;
  /** The user-safe explanation only; never the private moderation reason. */
  safeReason: string | null;
  /** Expired but not yet lifted: the persisted state lags until the next lazy lift. */
  lapsed: boolean;
}

export interface AdminAccountEntry {
  id: string;
  name: string;
  email: string;
  role: DirectoryRole;
  registeredAt: string;
  /** The persisted account state (a lapsed restriction still shows its old state). */
  accountState: string;
  accountStateChangedAt: string | null;
  deletionPending: boolean;
  deletionRequestedAt: string | null;
  restriction: AdminAccountRestriction | null;
}

export interface AdminGovernanceEvent {
  id: string;
  action: string;
  actorType: "USER" | "SYSTEM";
  actor: { id: string; name: string | null } | null;
  /** An account state or, for Expert actions, a role. */
  previousState: string;
  resultingState: string;
  safeReason: string | null;
  occurredAt: string;
}

export type AdminDirectoryPage = PaginatedResponse<AdminAccountEntry>;
export type AdminHistoryPage = PaginatedResponse<AdminGovernanceEvent>;

export interface AdminDirectoryQuery {
  page?: number;
  role?: DirectoryRole;
  accountState?: DirectoryAccountState;
  q?: string;
}
