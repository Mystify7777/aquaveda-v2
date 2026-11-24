# Administrator targeting enforcement (#255)

Implements ADR-0012 D2, D3 and D8 in the account-governance service. **ADR-0012
is the policy authority and is unchanged**; this document records what the code
does and exactly which guarantees it gives.

## Mechanism

`server/src/services/account-governance.service.js`, `server/src/domain/admin-targeting.js`
(pure rule), `server/src/http/reasons.js` (client-safe allowlist).

Every PRODUCT operation (`muteAccount`, `suspendAccount`, `liftMute`,
`liftSuspension`) runs, in this order:

1. authenticate, ADMIN actor (`requireActor`, `requireRole`), request-shape and
   target-id validation (unchanged);
2. load the target (`404` if missing);
3. **target protection** on the pre-read: target is the actor ->
   `403 FORBIDDEN`, `reason SELF_TARGET_PROHIBITED`; else target `role` is
   `ADMIN` (any account state) -> `403 FORBIDDEN`, `reason ADMIN_TARGET_PROTECTED`;
4. state preconditions (`409 INVALID_STATE`), unchanged for USER/EXPERT;
5. ONE conditional atomic update whose filter pins **`role != ADMIN`, the
   expected `accountState`, and the observed `accountStateVersion`** (the
   `$inc` of the version stays in the same write).

A zero-match never infers `FORBIDDEN` (ADR-0007 §4): it re-reads and returns
`NOT_FOUND` or `STATE_RACE`. SYSTEM expiry (`expireMuteIfDue`,
`expireSuspensionIfDue`, `expireAccountRestrictionIfDue`, the sweeps) is **not**
subject to protection and carries no role pin (ADR-0012 D2).

Rejected operations throw before any write, so they change no account field, no
`accountStateVersion`, no `authGeneration`, delete no session, and append no
governance event.

The client sees `403`, `code: "FORBIDDEN"`, and an allowlisted `reason`
(`SELF_TARGET_PROHIBITED` or `ADMIN_TARGET_PROTECTED`); nothing else from
`details` is forwarded. Both values were added to `CLIENT_SAFE_REASONS` (an API
contract addition).

## What is guaranteed

- **G1. A product operation can never commit a restriction or lift on an account
  whose role is ADMIN at write time.** The role is pinned in the single-document
  atomic write, so this holds even if the role changes between the pre-read and
  the write (role changes do not bump `accountStateVersion`, which is why the
  version pin alone is not enough). The losing operation returns `STATE_RACE`,
  mutates nothing, and is not distinguished from other lost races by design.
- **G2. Mutual and multi-party Admin restriction through the product is
  impossible**, so there is no race to win: two Admins suspending each other are
  both rejected at the pre-read, in any interleaving.
- **G3. I1 holds for the product path by construction.** Product governance
  cannot touch an Admin account, so it cannot reduce the set of
  governance-capable Admins. This is a property of the rule, **not** of any
  count/write/recount sequence. No count is taken, no lock or transaction is
  introduced, and nothing here relies on a recount for safety.
- **G4. `account-governance.service.js` is the only product-path writer of
  account state in `server/src`; Operator and out-of-band state changes are
  outside this guarantee.**

## What is NOT guaranteed (limitations)

- **Operator path (ADR-0012 D3, follow-up F2).** The Operator restrict/restore
  tool does not exist. When built, its last-capable-Admin refusal and recount
  are detection only; concurrent Operator runs are outside the supported
  operational model and are not serialized. I1 is preserved there by procedure
  (one Operator run at a time), not enforced technically.
- **Out-of-band edits** (direct database changes, an operator promoting a user to
  ADMIN) are outside the product guarantees. Promotion racing a product write is
  safe (G1). A restriction that committed just BEFORE a promotion stays (the
  account was not an Admin then); after promotion peers cannot lift it
  (protected), only the Operator or expiry can.
- **#177 / #178** (deletion) must add the last-capable-Admin guard (ADR-0012
  GOV-T5, follow-up F3). Neither exists yet, so nothing violates it today.
- The governance event remains a second, non-transactional write (GOV-S9).
- Request-shape validation (zod, in the route) still precedes the target load, so
  an invalid body against an Admin target is `400`, not `403`. Protection precedes
  every state-dependent check.
- Admin accounts already restricted before this change (none are known) keep
  their state; the protection only blocks further product changes.

## Tests (`server/tests/admin-targeting.test.js`, 53)

Self x 4 operations (service and HTTP); peer Admin x 4 operations x
{ACTIVE, MUTED, HARD_SUSPENDED}; USER/EXPERT regression for all four operations;
check order (non-ADMIN actor, anonymous, malformed id, unknown id, protection
before state, shape validation); rejected-operation side-effect snapshots
(user document, sessions, `authGeneration`, `accountStateVersion`, events);
role change between pre-read and write via deterministic barriers
(`governanceTestHooks.afterTargetRead` for mute/suspend, `afterRead` for lifts;
no sleeps); mutual and 3-Admin all-pairs races; last-capable-Admin scenarios;
SYSTEM expiry on an Admin; atomic-filter pin assertions (including that expiry
carries no role pin); the allowlist. 11 mutation checks each fail tests.

Three existing tests changed. Two (`hard-suspension`, `mute.enforcement`) built a
restricted Admin by having one Admin restrict a peer through the product (now
prohibited); their fixtures now write the Operator-imposed state directly, and
their assertions (a restricted Admin is blocked by the middleware) are
unchanged. `issue.dto.test.js` pins the exact client-safe reason set and now
includes the two new reasons.
