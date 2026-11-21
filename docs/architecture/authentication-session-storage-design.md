# Authentication milestone — refresh-token/session storage design (Step 3)

**Status: analysis only. No code. No decision-register promotion.**
Resolves the one sub-decision both prior documents explicitly declined
to answer: where does refresh-token/session state live, and what is its
lifecycle. Grounded in L1 (Topology B), L2 (HttpOnly cookies only), L3
(proportionate security), and the existing `User` model as it stands
today.

---

## The decision

> Should refresh-token/session state be a field embedded on the
> existing `User` document, or a dedicated `Session`/`RefreshToken`
> collection?

## Why this is the one that actually matters

Every other open item from the prior two documents (cookie attributes,
JWT payload shape) is a parameter choice within an already-locked
direction. This one is different in kind: it decides whether a sixth
collection enters the schema — the same weight of decision as the
original five (User, Issue, Knowledge, Comment, Project), which went
through full Persistence Design scrutiny (ADR-0005, ADR-0006). Getting
this wrong doesn't produce a bug, it produces a schema shape that's
awkward to migrate away from once real users and real sessions exist.

---

## Options

### Option 1 — Field(s) embedded on `User`

Store refresh-token state directly on the `User` document, e.g. a
hashed current refresh token and its expiry, or a small bounded array of
`{ tokenHash, expiresAt, issuedAt }` entries for multi-session support.

**Pros**
- No new collection, no new index, no new file in `server/src/models/`.
- One document read resolves both identity and session validity in a
  single query during refresh.
- Matches L3 (proportionate security) — this is the simpler
  implementation for a platform that isn't trying to support serious
  multi-device session management yet.

**Cons**
- **The two documents have fundamentally different responsibilities,
  lifecycles, retention rules, and invalidation semantics — regardless
  of refresh-token strategy.** `User` represents durable identity/profile
  data with no natural expiry. A session represents a time-bounded
  authentication grant that is created, rotated or reused, and
  eventually invalidated or expired, independent of anything about the
  user's profile. This distinction holds even under a long-lived,
  non-rotating refresh token that writes to the database rarely — the
  architectural mismatch is about *what the data means and how its
  lifecycle is governed*, not primarily about write frequency. (Write
  frequency is a real secondary cost when rotation is chosen — see
  Option 2 below — but it is not the load-bearing argument.)
- If a bounded array is chosen for multi-session support, it inherits
  exactly the "how many is enough, what evicts the oldest" complexity
  Persistence Design already avoided once (Knowledge's reviewHistory
  capacity-assumption debate, recorded in `decision-register.md`).
  Doing that again here, on a field that didn't need to exist a
  paragraph ago, is avoidable.
- Couples authentication's invalidation semantics (logout, logout-all,
  revocation) to the same document contended by profile updates — e.g.
  "log out of all devices" becomes a write to a field on the same
  document other requests may concurrently be reading for identity
  resolution, rather than a clean delete against an independent
  collection.

### Option 2 — Dedicated `Session` (or `RefreshToken`) collection

A new collection, one document per active session/refresh token,
referencing `User` by ID.

**Pros**
- **Matches the write-pattern separation the project has consistently
  chosen elsewhere.** This is the same reasoning ADR-0005 already used
  to justify keeping `Issue.statusHistory` and `Knowledge.reviewHistory`
  as separate concerns from each other despite superficial similarity —
  here the two things (identity, session) don't even resemble each
  other structurally, so the case for separation is stronger, not
  weaker.
- Session lifecycle (issue, rotate, expire, revoke) becomes a
  self-contained concern with its own natural index (`userId`,
  `expiresAt` — the latter usable directly with a MongoDB TTL index for
  automatic expiry cleanup, which the embedded-field option can't get
  for free).
- Multi-session support (logging in from two browsers) falls out
  naturally as "two documents" rather than "grow the array and solve
  eviction" — if multi-session is ever needed, this option doesn't
  require a redesign to get there, whereas Option 1 does.
- Logout, and any future "log out everywhere," become simple,
  independent operations (delete one document / delete all documents
  matching `userId`) that don't risk a concurrent write colliding with
  an unrelated profile update on the same `User` document.
- Consistent with the existing five-collection precedent: reference-only
  relationships, no embedding across unrelated concerns, `ObjectId ref`
  pattern already used throughout (`Issue.reportedBy`,
  `Project.originIssue`, etc.).

**Cons**
- One more collection, one more model file, one more thing to explain in
  onboarding — a real cost, just a small one.
- Refresh requires a second query (session lookup) in addition to the
  user lookup already required by L2's DB-backed-role design (§4 of the
  original review: role must be read fresh from the DB on every
  request, not trusted from the JWT). In practice this is a second
  indexed lookup by `_id` or a compound key, not a meaningful
  performance concern for a "low-friction community platform" (L3).

---

## Recommendation: **Option 2 — dedicated `Session` collection**

This is the one place in this milestone I'd actively push back on
picking the "smaller-looking" option by default. Option 1 looks simpler
on day one specifically because it avoids writing one new file, but it
conflates two things — durable identity and time-bounded session
lifecycle — that have different responsibilities, different retention
rules, and different invalidation semantics, independent of whatever
refresh-token strategy is eventually chosen. L3's "proportionate, not
maximal" posture argues against building a *heavyweight* session system
(device fingerprinting, geographic anomaly detection, etc.) — it does
not argue for cramming session state into the wrong document to save a
file. A minimal `Session` collection is not heavyweight; it's the
correctly-shaped minimal thing.

Concretely, minimal shape (illustrative only, not a schema to implement
from this document — finalized in the Step 4 report):

```
Session
  _id                (this document's own ID — the "sid" a refresh JWT
                       must carry, so the backend can look up the exact
                       session a refresh token claims to belong to,
                       rather than resolving by userId alone, which
                       breaks once multiple concurrent sessions exist)
  userId       (ObjectId ref User, indexed)
  tokenHash    (hash of the refresh token, never the raw token)
  expiresAt    (indexed with a real MongoDB TTL index — see note below)
  createdAt
```

One document per active refresh token. Login/register create one.
Refresh rotates it (or creates a new one and deletes the old, depending
on the rotation strategy — a separate, smaller decision than the storage
question this document resolves). Logout deletes it. No multi-device
management UI or "active sessions" list is implied or required by this
shape — that would be a future, separately-justified feature, not
something this decision commits to building now.

**TTL nuance, to be carried into implementation:** a MongoDB TTL index
on `expiresAt` handles eventual physical cleanup of expired session
documents, but the TTL monitor runs periodically (not on the exact
expiry instant) — it is not a substitute for an explicit expiry check.
The authentication service must independently verify
`session.expiresAt > now` before treating a session as valid, regardless
of whether MongoDB has physically deleted the expired document yet.
Treating TTL-index presence as sufficient expiry enforcement would be a
real bug, not a style nit.

This does **not** reopen or expand Persistence Design's five-collection
decision as a general principle — that decision was about AquaVeda's
*domain* entities (User, Issue, Knowledge, Comment, Project). `Session`
is infrastructure supporting identity, not a domain entity, in the same
sense that Recommendation is a derived service output rather than a
domain entity. Adding it doesn't say "five was wrong," it says
"authentication infrastructure has its own storage needs, orthogonal to
the domain model."

---

## Explicit non-goals of this decision

- Does not decide refresh-token rotation strategy in detail (rotate vs.
  reuse-detection vs. simple expiry) — flagged as a smaller follow-on
  decision, not resolved here.
- Does not introduce multi-device session listing/management as a
  feature — the shape merely doesn't *preclude* it later, unlike Option
  1's array approach which would need rework to get there.
- Does not touch `User.js` at all. No `refreshToken` field, no
  `sessions` array, gets added to the existing model.
- Does not affect D-3a in any way — this is purely about where a hashed
  token lives, unrelated to Issue lifecycle authorization.

---

## File impact of this decision specifically

- `server/src/models/Session.js` — new (name TBD at implementation time;
  `Session` used here for clarity, `RefreshToken` is an equally
  reasonable name — not deciding the name in this document)
- `server/src/services/auth.service.js` — creates/rotates/deletes
  `Session` documents as part of login/refresh/logout, per the earlier
  scope-boundary analysis
- No changes to `User.js`, and no changes to any Phase D service or
  model

---

## Summary

**Recommendation, now reviewed and corrected: a dedicated `Session`
collection**, not a `User`-embedded field, named `Session` (not
`RefreshToken` — it represents a session lifecycle, which may
eventually carry more than a token hash, not merely a credential). The
governing rationale is separation of responsibility/lifecycle/retention/
invalidation semantics between identity and session — not write
frequency, which depends on a rotation strategy decided separately (see
the consolidated Step 4 report).

This resolves the last major open architectural question blocking
implementation planning. Remaining smaller open items (exact cookie
attributes for the Topology B split, refresh-rotation strategy, final
`DomainErrorCode` naming for auth-specific errors, the `sid`-in-JWT
lookup mechanism) are captured in the Step 4 consolidated report.

See also: account-state effects on sessions (invalidation, fresh-session recovery) are recorded in [ADR-0010](../adr/ADR-0010-account-governance.md) §4 (register GOV-L4); this design's session model is unchanged.
