# Persistence Design — Analysis

**Status:** Approved. Analysis only — no Mongoose schemas,
models, connection code, or dependency installation. This document maps
the settled Domain Model (`docs/domain/domain-model.md`, ADR-0003,
ADR-0004, `docs/architecture/decision-register.md`) onto MongoDB/Mongoose
without foreclosing anything the Domain Model deliberately left open.

The discipline carried over from the Domain Model milestone applies here
too: **domain decisions describe meaning and behavior; persistence
decisions describe how that meaning is stored.** Every section below tries
to keep that boundary visible rather than quietly collapsing it.

---

## 1. Persistence principles

These govern every decision in this document:

1. **Persist only what has a concrete access pattern.** A domain concept
   existing is not, by itself, a reason to give it a collection —
   Recommendation is the standing example from the Domain Model milestone.
2. **Prefer embedding when data is always read with its parent, is
   bounded in growth, and has no independent query requirement.** Prefer
   referencing when data is queried independently, grows unboundedly, or
   represents a distinct entity with its own lifecycle.
3. **No generic abstractions without two concrete, structurally similar
   requirements.** This is the same reasoning that rejected D-20 (a
   generic status-history primitive) in the Domain Model milestone —
   carried forward here rather than re-litigated.
4. **Domain invariants that require cross-document or contextual
   reasoning are not schema-enforceable and should not be forced to be.**
   Attempting to encode them at the schema level either fails silently or
   re-implements domain logic inside the persistence layer, which
   defeats the purpose of keeping the two separate.
5. **Do not close a deferred domain decision through schema shape.** Where
   the Domain Model explicitly left something open (D-3a, User suspension,
   Project status, etc.), the schema should remain neutral enough that the
   eventual decision doesn't require a breaking migration.
6. **Transactions are justified by identified multi-document atomicity
   requirements, not adopted defensively.** None are assumed until a
   concrete operation demonstrates the need.

---

## 2. Domain concept → persistence mapping

| Concept                  | Persisted? | Shape                           | Why                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User                     | Yes        | Collection                      | Independent entity, queried independently (auth, listings, ownership joins), long-lived, referenced by every other entity.                                                                                                                                          |
| Issue                    | Yes        | Collection                      | Independent entity with its own lifecycle, geo-queried independently (map, nearby, filters), referenced by Project/Comment.                                                                                                                                         |
| Knowledge                | Yes        | Collection                      | Independent entity with its own lifecycle, queried independently (public listing, author's drafts), referenced by Comment.                                                                                                                                          |
| Comment                  | Yes        | Collection                      | Queried independently and paginated per-target; unbounded growth per Issue/Knowledge rules out embedding (this is the exact v1 bug — `Issue.comments[]` — already identified and rejected).                                                                         |
| Project                  | Yes        | Collection                      | Independent entity, joined/listed independently, has its own contributor and progress data, referenced by nothing that would justify embedding it inside Issue (see §3).                                                                                            |
| Recommendation           | **No**     | N/A — computed, not stored      | Confirmed again here: no ownership, no lifecycle, no independent query need, no requirement surfaced anywhere in this analysis that changes the Domain Model conclusion. Remains a pure function output: `Issue → RecommendationService → { guidance, reasoning }`. |
| Issue status history     | Yes        | **Embedded** array on Issue     | See §4.                                                                                                                                                                                                                                                             |
| Knowledge review history | Yes        | **Embedded** array on Knowledge | See §5.                                                                                                                                                                                                                                                             |

Five collections. Issue status history and Knowledge review history are
embedded within their parent documents, not separate collections (see §4,
§5). Recommendation is not persisted at all (see below).

### Recommendation — confirming the default holds

The instruction was to keep "no persistence" as the default unless a
concrete requirement contradicts it. Checked against every access pattern
surfaced in this analysis: no operation needs to list past
Recommendations, no operation needs to query a Recommendation
independently of its Issue, and nothing in the persistence layer creates a
cost problem the Domain Model's reasoning didn't already address (a
deterministic rule engine costs nothing meaningful to recompute). Nothing
found. The default holds.

---

## 3. Relationship analysis

Domain relationship and MongoDB representation are evaluated separately
for each pairing — a domain relationship existing does not by itself
imply an `ObjectId` reference, let alone which side holds it.

### Project → originating Issue

**Domain relationship:** required, immutable, one Project points to
exactly one Issue; one Issue may have zero or more Projects.

**MongoDB representation:** reference, held on `Project` (`originIssue:
ObjectId`), **not** an array on `Issue`. This is a deliberate choice, not
the only possible one — an array of Project references on Issue was
considered and rejected for the same reason v1's `Issue.comments[]` was
identified as a bug: Issue is the "one" side of a one-to-many relationship
whose "many" side can grow, and unbounded arrays on the one side are the
exact anti-pattern this project already corrected once. Querying
"Projects originating from this Issue" is done via an index on
`Project.originIssue`, not by reading an array field.

**Access pattern:** "show Projects for this Issue" (Explore/Act UI) and
"show the originating Issue for this Project" (Project detail view) are
both single-hop lookups against an indexed field — no embedding needed to
make either fast.

### Project contributors

**Domain relationship:** many-to-many, Project ↔ User, with an asymmetry
already established in the Domain Model — contributors participate,
only the creator controls progress.

**MongoDB representation:** embedded array of `ObjectId` references on
`Project` (`contributors: [ObjectId]`), **not** embedded full User
documents. Referencing avoids duplicating/staleness-prone User data
(name, role) inside every Project a person has joined. The array itself
is embedded on `Project` (not a separate join collection) because the
primary access pattern — "who has joined this Project" — reads it
alongside the Project it belongs to. This does not mean contributors are
_only_ ever read that way: reverse lookups ("which Projects has this user
joined") are a plausible and reasonable query, answerable via an index on
`contributors` without a separate join collection. If contributor counts
grow materially large for a given Project, or write contention on the
array (concurrent joins) becomes a measurable problem, the embedded-array
representation should be reconsidered — most likely toward a separate
`ProjectMembership` join collection at that point, not before.

**What this array does and does not represent:** `contributors` records
_Project participation_ — who has joined a given collaborative effort.
It does not represent, encode, or imply any form of _Issue lifecycle
authority_. Project participation, Project progress-update authority
(already scoped to `creator` only, per the Domain Model), and Issue
status-transition authority are three distinct things, and this schema
shape keeps them distinct rather than conflating them. In particular,
appearing in a Project's `contributors` array does **not** resolve or
imply an answer to **D-3a** (who is authorized to assert `in_progress →
resolved` on the originating Issue). This persistence document introduces
no role, assignment, membership, or authorization mechanism to answer
D-3a — the array is a plain list of participant references, deliberately
inert with respect to Issue authority, so that whatever D-3a eventually
decides can be layered on by the service layer without requiring a change
to this shape.

### Comment relationships

**Domain relationship:** a Comment attaches to exactly one of Issue or
Knowledge via the `refType` discriminator (already an architecturally
settled decision, not reopened here), has one author, and optionally one
parent Comment (one level of nesting only).

**MongoDB representation:** own collection (unbounded growth per target
rules out embedding, as above), with `refType: 'ISSUE' | 'WIKI'`, `refId:
ObjectId` (intentionally not a typed ref — it's polymorphic by design),
`author: ObjectId ref User`, `parentComment: ObjectId ref Comment |
null`. This preserves the exact v1 pattern already proven to work,
including the fix (normalized, no duplicate array) already in place.

**One-level nesting enforcement:** the domain rule — a `parentComment`
may reference only a top-level Comment; a Comment whose own
`parentComment` is non-null cannot itself be used as a parent — is a
**service/domain validation rule, not a schema constraint.** Mongoose has
no native way to express "the referenced document's own reference field
must be null" without a query against that referenced document at write
time, which is the same category of contextual, read-then-validate check
already ruled out of the schema layer in §6 (`resolverId !== verifierId`,
`reviewerId !== authorId`). The `createComment`/`replyToComment` service
operation is responsible for loading the target `parentComment` (when
one is supplied) and rejecting the write if that target already has a
non-null `parentComment` of its own.

### Knowledge author/reviewer relationships

**Domain relationship:** `author` is fixed at creation, immutable.
`reviewer` is not a top-level property of a Knowledge article — it is a
property of an individual review _decision_. A Knowledge article does not
have "a reviewer" the way it has "an author"; it has zero or more review
decisions, each made by a specific reviewer at a specific time. Framing
it as a top-level property would imply that "the reviewer" is a durable
fact about the Knowledge entity itself, when in reality a given article
may pass through multiple review decisions (one or more rejections
followed by an approval), each with a potentially different reviewer.

**MongoDB representation:** `author: ObjectId ref User` (required,
immutable — this is a top-level property because it is a durable,
unchanging fact about the Knowledge entity). Reviewer identity is **not**
a flat `reviewer` field on the Knowledge document — it belongs only inside
each `reviewHistory` entry (§5), where it is correctly scoped to the
decision it describes rather than to the article as a whole. The same
reasoning applies to Issue's resolver/verifier identities (next
paragraph): both are properties of transitions, not of the entity.

### Issue reporter/resolver/verifier relationships

**Domain relationship:** `reporter` is fixed at creation, immutable.
Resolver and verifier are _not_ fixed identities on the Issue as a
whole — they're properties of specific transitions, and because the
lifecycle allows `resolved → in_progress → resolved → verified` loops
(failed verification), a given Issue can accumulate multiple different
resolver/verifier pairs over its lifetime.

**MongoDB representation:** `reportedBy: ObjectId ref User` (required,
immutable) at the top level. Resolver and verifier identity live
**inside the status-history entries** (§4), not as flat
`resolvedBy`/`verifiedBy` fields on Issue. This is a direct consequence of
the failed-verification loop: a flat field would only ever hold the _most
recent_ actor and would silently lose the accountability trail ADR-0003
requires the moment a verification fails and the cycle repeats. This
connects §3 to §4 directly — the relationship analysis and the history
analysis aren't independent conclusions, one requires the other.

---

## 4. Issue status history analysis

**Embedded or referenced?** Embedded array of subdocuments on `Issue`.

**Reasoning**, evaluated on its own terms rather than assumed from
Knowledge's case:

- **Query requirement:** status history is read exclusively alongside its
  Issue (viewing an Issue's timeline). No requirement anywhere in the
  Domain Model or this analysis needs to query status history across
  Issues independently of fetching each Issue. This is the single
  strongest signal toward embedding.
- **Growth characteristics:** bounded. The state machine has five states
  and one loop (`resolved ⇄ in_progress` on failed verification). Even a
  pathological case — an Issue failing verification repeatedly — produces
  entries in the tens, not thousands. Not a document-size risk.
- **Ordering:** array insertion order is chronological order; no separate
  sequence field is required by the domain, though a monotonic counter
  could be added later purely as an implementation convenience for
  detecting concurrent-write races — that's an implementation detail, not
  a domain requirement, and not decided here.
- **Accountability requirement (from ADR-0003):** each entry needs, at
  minimum, the prior state, the new state, the acting user, and a
  timestamp. Nothing in ADR-0003 requires a free-text note field on Issue
  transitions the way ADR-0004 requires one on Knowledge rejection — the
  transition type itself (e.g., `resolved → in_progress`) already
  communicates "this was a failed verification," since that's the only
  path that produces that specific transition.

**Minimum fields per entry** (shape, not schema code): prior status, new
status, acting user reference, timestamp. No additional fields required
by the domain as currently settled.

### Initial history entry: does creation count as a transition?

Two options were weighed explicitly, not assumed:

**Option A — keep `null → open`.** Define `statusHistory` formally as an
Issue's _lifecycle history_: the first entry is a creation/initialization
event, and every entry after it is a state transition in the sense
defined by ADR-0003. Under this definition, "creation" and "transition"
are both members of one category — events in the lifecycle — so including
both under one array is not a category error, it's the array doing
exactly what its name says.

**Option B — omit the synthetic entry.** `statusHistory` contains only
actual domain state transitions as ADR-0003 defines them (`open →
acknowledged`, etc.), with `reportedBy` + `createdAt` already representing
Issue creation at the top level, so the array never needs to speak for
the creation moment at all.

**Decision: Option A.** `statusHistory` includes the initial `null →
open` entry, with `statusHistory` formally defined as: _the complete
lifecycle history of an Issue, whose first entry records creation and
whose subsequent entries record each state transition, in the same
representation._

Reasoning: ADR-0003's accountability requirement is about reconstructing
an Issue's full timeline — who made which claim, and when — and creation
is part of that timeline, not a separate category of fact about the
Issue. Option B's alternative (`reportedBy` + `createdAt` standing in for
the creation moment) works, but it means every consumer needing the full
timeline — a UI timeline component, an audit export — must combine two
differently-shaped sources (a pair of top-level fields, plus an array) to
reconstruct one linear sequence of events, rather than reading one
array. Option A avoids that seam entirely.

The redundancy this creates — `reportedBy`/`createdAt` and the array's
first entry both describing the same fact — is not a risk of the two
drifting apart: both are set from the same values in the same atomic
document-creation write, not maintained independently afterward. It is
duplication of the kind already accepted elsewhere in this document (§7)
as acceptable when it's cheap, structural, and set once — not the kind of
duplication that introduces a synchronization problem.

### Concurrency: safe lifecycle transitions

MongoDB's single-document write atomicity (relied on in §8 to rule out
transactions) guarantees that _one_ write to an Issue document is
all-or-nothing. It does **not**, by itself, guarantee that a
**read-current-state, validate, then write** sequence — which is exactly
what `changeStatus` does — is safe under concurrent execution. These are
different guarantees, and conflating them would be a real gap in this
analysis.

**The race:** two actors (or the same actor via a double-submit) both call
`changeStatus` on the same Issue at nearly the same time, both reading
`status: in_progress` before either write lands. Both validate
successfully against that read (transition is legal, actor is
authorized). Both then attempt to set `status: resolved` and append a
history entry. Without a mechanism tying the write to the state that was
actually validated, the second write can silently overwrite the first —
or, more subtly, both writes could succeed as sequential updates, leaving
two `in_progress → resolved` history entries for what should have been
one accepted transition and one rejected race loser.

**Required persistence-level invariant:** a status transition must
validate against the _expected_ current state and atomically update the
status and append its history entry as a single operation — not as a
read, followed by a separate write that trusts the read was still valid.

More precisely: **the `fromStatus` recorded in the appended history entry
must equal the expected current status used in the conditional update's
match filter.** These are not two independently-set values that happen to
usually agree — they must be the _same_ value, supplied once, used both
to gate whether the write is allowed to happen at all and to populate what
the write records as having happened. The conceptual operation is:

```
expectedStatus
      ↓
conditional match on Issue._id + expectedStatus
      ↓
atomically: set status = targetStatus, append { fromStatus: expectedStatus, toStatus: targetStatus, actor, timestamp }
```

If the match fails (because the actual current status no longer equals
`expectedStatus`), nothing is written — not the status, not the history
entry — and the operation reports "state changed underneath you" rather
than silently proceeding with a mismatched pair. This is what keeps the
state change and its accountability record from ever being able to
disagree with each other: there is no code path where the status
transitions to `targetStatus` while the history entry records a different
`fromStatus` than what was actually true at the moment of the write.

**Mechanisms considered** (not yet prescribed as the final implementation
— proposed for review):

- **Conditional atomic update** (optimistic, state-conditioned): the
  update operation's filter includes both the document id _and_ the
  expected current status (e.g., "update this Issue, but only if its
  status is still `in_progress`"), with the status change and history-
  entry append performed in that same atomic operation. If the filter no
  longer matches — because a concurrent write already changed the status —
  the operation matches zero documents, and the service layer treats
  that as a distinguishable "state changed underneath you" outcome,
  separate from an authorization failure or an invalid-transition
  failure. The loser can be told to reload and retry, rather than
  silently losing their update or corrupting history.
- **Generic optimistic-concurrency version field** (e.g., a document-wide
  version counter incremented on every write, checked-and-incremented
  atomically): a more general mechanism that works regardless of which
  field changed. Considered, but likely unnecessary complexity here
  specifically _because_ status is exactly the field under contention for
  this class of race — conditioning the update on expected status
  achieves the same safety without a separate versioning scheme covering
  fields that aren't actually contested this way.

**Proposal:** the conditional atomic update (state-conditioned filter),
not a generic version field, is the better fit for Issue status
transitions — it directly encodes "this write is only valid if the state
I validated against is still true," which is precisely the invariant
required, without introducing a general-purpose mechanism the domain
doesn't otherwise need. This is a proposal for review, not treated as
finalized — the exact implementation (which MongoDB/Mongoose operation
achieves this atomically) is left to schema/implementation work once this
mechanism is approved.

**Scope of this conclusion:** "a generic version field is unnecessary"
applies specifically to the lifecycle-transition concurrency problem
analyzed here — status-conditioned writes to `Issue.status` and
`Knowledge.status`. It is not a general claim that no future concurrency
problem in this system will ever need a broader mechanism. If a future
requirement introduces concurrent writes to a field where state-
conditioning on a single value isn't a natural fit — for example,
concurrent edits to multiple independent fields on the same document,
where no single field's value is what's actually under contention — a
generic optimistic-concurrency scheme should be evaluated fresh at that
point, on its own merits, not ruled out by this conclusion.

The same mechanism applies to Knowledge's `approve`/`reject` operations
(§5) for the identical reason — both are read-validate-write sequences
over a status-like field with an appended history entry, so this section
is not repeated there, only referenced.

---

## 5. Knowledge review-history analysis

**Embedded or referenced?** Embedded array of subdocuments on `Knowledge`
— arrived at independently, not by copying §4's conclusion, though it
lands in the same place.

**Reasoning:**

- **Query requirement:** same as Issue — review history is read alongside
  its Knowledge document (author checking feedback, an authorized Expert
  reviewing decision history). No cross-Knowledge query requirement
  surfaced.
- **Growth characteristics: not domain-bounded.** This differs from
  Issue's case and should not be described the same way. ADR-0004
  deliberately allows unlimited `rejected → draft → resubmit` cycles — the
  domain places no ceiling on how many times an article can be rejected
  and revised. Embedding is therefore **not** justified by a bounded-
  growth argument the way Issue's history is. The embedding decision here
  rests instead on a **V2 capacity assumption**: given the platform's
  current expected scale and the fact that review history is always
  parent-scoped (read with its Knowledge document, never queried
  independently), an embedded array is expected to stay well within
  practical document-size limits for realistic usage. This should be
  revisited — likely toward a separate `KnowledgeReview` collection — if
  either of the following becomes true: (a) revision-cycle counts in
  practice turn out to be materially higher than expected (e.g., a
  moderation workflow that encourages many small iterative rejections
  rather than substantive ones), or (b) a future requirement needs to
  query review history independently of its Knowledge document (e.g., a
  platform-wide "recent moderation decisions" feed).
- **Accountability requirement (from ADR-0004):** each entry needs the
  decision (approve/reject), the reviewing Expert, a timestamp, and —
  specifically for rejections — the required actionable feedback
  established as a hard domain requirement in ADR-0004. Unlike Issue,
  this domain does require a content field on at least some entries.
- **No synthetic creation event.** Unlike Issue's `statusHistory` (§4),
  `reviewHistory` represents review _decisions_ only — approve or reject
  events. It does not contain an entry for the article entering `draft`
  or being submitted to `pending_review`; those aren't review decisions,
  and inventing a synthetic entry for them would misrepresent what the
  array means. Before any review has occurred, `reviewHistory` is
  correctly an empty array — the `draft`/`pending_review` state is fully
  represented by the top-level `status` field and `createdAt`, with no
  need for the history array to duplicate it. This is a deliberate
  asymmetry with Issue's initial-entry decision (§4), not an
  inconsistency: Issue's creation _is itself_ a state transition
  (`null → open`) worth recording, while Knowledge's creation is not a
  review decision and doesn't belong in a review-decision log.
- **Concurrency:** the same read-validate-write race analyzed for Issue
  (§4) applies identically to `approve`/`reject` — both are
  state-conditioned updates with an appended history entry. The same
  proposed mechanism (conditional atomic update keyed on expected current
  status) applies here without modification; not re-derived separately.

**Minimum fields per entry:** decision, reviewer reference, timestamp,
feedback (required when decision is `rejected`; not applicable when
`approved`).

### Why not a shared generic History structure

Explicitly considered and rejected, consistent with D-20's disposition in
the Domain Model milestone. The two structures don't actually share a
field shape: Issue's entries are `(fromStatus, toStatus, actor,
timestamp)`, Knowledge's are `(decision, reviewer, timestamp,
feedback?)`. Forcing them into one generic shape would mean either a
lowest-common-denominator schema that loses meaning (e.g., a generic
`data: Mixed` field) or a polymorphic schema with unused optional fields
on each side — added complexity with no query, reporting, or code-reuse
benefit identified anywhere in this analysis. Two small, independently
understandable embedded structures are simpler than one generic one here.

---

## 6. Constraints and index analysis

Each non-unique index is listed alongside the concrete access pattern
that justifies it. Indexes not backed by a current planned query are not
proposed — adding indexes speculatively increases write overhead without
identifiable read benefit.

**User**

- Unique index on `email` — enforces the uniqueness constraint for login
  identity lookup (`findOne({ email })` at authentication). Both unique
  and queried; qualifies as a uniqueness constraint and an index
  simultaneously.

**Issue**

- `2dsphere` on `location` — required for all geo queries: map display
  (`$geoWithin` bounding box for the Explore map viewport), nearby lookup
  (`$near` for radius search), and geospatial filtering. No geo query
  works without this; it is not optional. (Issue #41: bounding-box
  discovery uses this index via a `$geoWithin` `$centerSphere` candidate
  filter plus exact planar bounds; `$near` radius search is **not**
  implemented — see `issue-discovery-contract.md`.)
- Text index `issue_text_search` on `title` + `description`
  (`default_language: "none"`) — **added by Issue #41** for the public
  `q` search; the only text index on the collection. It selects
  candidates only (no stemming, so multilingual reports tokenize
  predictably); the contract's whole-word, every-term semantics are
  enforced by a per-term exact check on those candidates — see
  `issue-discovery-contract.md`. No other index was added for #41: `category`/`severity`
  are low-cardinality enums that are always combined with another filter
  or served from a page-bounded sort, so no access pattern justifies one.
- Index on `status` — the public Issue listing and Explore map filter both
  filter by status (`{ status: 'open' }`, `{ status: { $in: [...] } }`).
  Without this, every listing query scans the full collection.
- Index on `reportedBy` — the user dashboard's "my reported Issues" view
  queries `{ reportedBy: userId }`. Removed from the compound-index
  consideration for now; a plain single-field index satisfies the current
  access pattern without the added complexity of a compound key.

**Knowledge**

- Index on `status` — the public Knowledge listing always filters
  `{ status: 'approved' }` (Invariant 2, no exceptions). Without this,
  the public listing scans the full collection on every page load.
- Index on `author` — the "my articles" view queries `{ author: userId }`.
  This is the only current access pattern requiring a lookup by author on
  the Knowledge collection.

**Comment**

- Compound index on `(refType, refId)` — every Comment listing query
  filters by both fields together (`{ refType: 'ISSUE', refId: issueId }`).
  A compound index on both covers this exactly; a single-field index on
  either alone would not be selective enough to be useful given that
  `refType` has only two values.

**Comment access patterns — enumerated before deciding on `parentComment`:**

The currently established Comment read patterns (from v1's proven API
shape — `GET /api/v1/comments?refType=...&refId=...` — and the domain
model's confirmation that Comment threading is one level only) are:

1. **Comments for an Issue/Knowledge target** — the only established
   read pattern. A single query filtered by `(refType, refId)`, paginated,
   returns the comments for that target. Because threading is one level
   deep, this result set already contains both top-level comments and
   their replies together — there is no established second query that
   fetches "just the replies to comment X."
2. **Replies to a specific Comment** — not a separately-issued database
   query in any currently established behavior. Replies are already
   present in pattern 1's result set; distinguishing top-level comments
   from replies (grouping by `parentComment`) happens in the response-
   shaping/rendering layer against data already fetched, not via a second
   `{ parentComment: commentId }` query against the database.
3. **No other Comment read pattern is currently established** — no v1
   endpoint or domain-model requirement describes any other way Comments
   are read.

**Decision:** no `parentComment` index is proposed. Per Principle 1
(§1), an index is justified by a concrete access pattern, and no
established pattern issues a direct `{ parentComment: commentId }` query
— pattern 2 above is served entirely from pattern 1's already-indexed
`(refType, refId)` query. Adding an index here would be speculative.

This should be revisited if a future comment-UI design introduces
genuine lazy-loaded/paginated reply-expansion (fetching replies to one
specific comment on demand, independently of the target's main comment
listing) — that would be a real `{ parentComment: commentId }` query and
would justify its own index at that point. Nothing in the currently
established design does this.

**Project**

- Index on `originIssue` — the "Projects originating from this Issue"
  query (`{ originIssue: issueId }`) is the primary access pattern for
  the Issue detail view's project list. Without this, the query scans
  all Projects.
- Index on `contributors` (array field index) — the "Projects this user
  has joined" reverse lookup (`{ contributors: userId }`). MongoDB
  supports multikey indexes on array fields; this enables the query noted
  in §3 without a separate join collection. Included because §3 explicitly
  identified this as a planned access pattern, not a speculative future
  need.

**Not proposed:** `creator` index on Project — no current query browses
Projects by creator independently of other filters.

Timestamps: standard `createdAt`/`updatedAt` on all five top-level
collections (Mongoose's `timestamps: true` option). History entries carry
their own explicit timestamp field rather than relying on subdocument
auto-timestamps, for clarity about what the timestamp represents (the
transition/decision time, not a document-modification time).

Audit fields: the history arrays _are_ the audit trail for Issue and
Knowledge — no separate audit-log concept is introduced.

### Mongoose/MongoDB constraint vs. domain/service invariant

This distinction matters enough to state plainly, per the explicit
instruction not to pretend schema validation covers contextual rules:

**Genuinely schema-enforceable** (Mongoose/MongoDB can express these
directly): required fields, type correctness, enum membership (status
values), string length limits, uniqueness via indexes.

**Not genuinely schema-enforceable**, despite being real domain
invariants:

- **`resolverId !== verifierId`** — comparing the actor of one specific
  historical transition against another, contextual to the operation
  being performed. A Mongoose custom validator _could_ attempt this by
  loading the document and inspecting prior history entries mid-write,
  but that means re-implementing the domain operation's logic inside the
  persistence layer — exactly the boundary-blurring this project has
  avoided since the Domain Model milestone began. **Enforced in the
  service layer's `changeStatus` operation, not the schema.**
- **`reviewerId !== authorId`** — same reasoning, same conclusion.
  **Enforced in the service layer's `approve`/`reject` operations.**
- **Project creation requiring `Issue.status ∈ {acknowledged, ...}`** —
  requires reading the referenced Issue's current state at write time,
  which a Mongoose validator can technically do (via a query inside the
  validator function) but again means encoding a state-machine rule
  inside a schema file rather than the service layer that owns the Issue
  lifecycle. **Enforced in the service layer's `createProject` operation.**

`immutable: true` (a real Mongoose schema option) is proposed as a
best-effort guard on `reportedBy`, `author`, and `originIssue` — worth
noting explicitly that this is _partial_ protection: it prevents
`document.save()` from changing the field after it's set, but doesn't by
itself stop every write path (e.g., a raw `updateOne`/`findOneAndUpdate`
call can still bypass it unless the service layer disciplines itself to
never expose an update path for these fields). The real guarantee is
architectural — no service-layer operation ever accepts these fields as
updatable — with `immutable: true` as a secondary, defense-in-depth
backstop, not the primary mechanism.

---

## 7. Validation-boundary analysis

| Layer              | Responsibility                                                                                                                                                                                                                                                | Does _not_ own                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain/service** | Cross-document and contextual invariants (`resolverId !== verifierId`, `reviewerId !== authorId`), state-machine transition legality (`changeStatus`, `approve`/`reject` validating current-state + actor authority + invariants), authorization/role checks. | Input-shape validation, structural DB constraints.                                                                                        |
| **Zod**            | Request-shape validation at the API boundary — is `title` a non-empty string within bounds, is `location` a valid GeoJSON point, is rejection `feedback` present and non-empty. Validates _input DTOs_ coming from the network.                               | Anything requiring DB state to evaluate (can't know if `resolverId !== verifierId` without reading the Issue).                            |
| **Mongoose**       | Schema-level structural integrity as a second line of defense — required fields, types, enums, `immutable` (partial), triggers index creation.                                                                                                                | Contextual/cross-document rules (see §6). Should not be the primary enforcement point for anything Zod or the service layer already owns. |
| **MongoDB**        | Index-backed constraints (uniqueness, geospatial queries), BSON-level type storage.                                                                                                                                                                           | Business logic of any kind.                                                                                                               |

**On duplication:** structural rules cheap to state twice (e.g.
`required` on both the Zod input schema and the Mongoose schema) are kept
in both, as inexpensive defense-in-depth against any write path that
might bypass the API layer. Complex business rules — the contextual
invariants above — are **not** duplicated across layers; they live in
exactly one place, the service layer, because duplicating a rule that
can't actually be correctly expressed in the other layers doesn't add
safety, it adds a second, weaker, possibly-inconsistent copy of the rule.

---

## 8. Transaction analysis

Re-examined explicitly in light of the embedding decisions above, per
instruction, rather than assumed from a pre-embedding intuition:

| Operation                                  | Documents touched                                                                          | Atomic without a transaction?                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Issue status change (any transition)       | One (`Issue` — status field + appended history entry, same document)                       | Yes — single-document write is atomic in MongoDB by default. |
| Knowledge review decision (approve/reject) | One (`Knowledge` — status field + appended history entry, same document)                   | Yes — same reasoning.                                        |
| Knowledge revise (`rejected → draft`)      | One (`Knowledge`)                                                                          | Yes.                                                         |
| Project creation                           | One (`Project` insert; reads `Issue.status` but does not write to Issue)                   | Yes — no write to a second document.                         |
| Project join                               | One (`Project` — append to `contributors`)                                                 | Yes.                                                         |
| Comment creation                           | One (`Comment` insert; no write-back to Issue/Knowledge, per the already-corrected v1 bug) | Yes.                                                         |

**No operation identified in the current settled domain model requires a
multi-document transaction.** This is a direct consequence of two prior
decisions: embedding history inside its parent document (§4, §5) rather
than as a separate collection, and choosing reference-only, non-
denormalized relationships everywhere else (§3) rather than writing to
both sides of a relationship.

This conclusion is explicitly revisable: if a future requirement
introduces a genuine cross-document invariant that must be atomic (for
example, if history were later split into its own collection for reasons
not currently foreseen), transactions would need re-evaluation at that
point. Nothing in this document treats "no transactions needed" as
permanent — only as accurate given the shapes proposed here.

---

## 9. Deferred-decision persistence impact

For each item the Domain Model left open, the question here is narrower
than resolving it: **does the proposed schema shape accidentally foreclose
it?** In every case, the answer is no — proposed shapes are additive-safe.

| Deferred item                              | Schema impact today                                                                                                                                                                         | Why it stays open                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-3a** (remediation-assertion authority) | The `actor` field on `resolved`/`in_progress` status-history entries is a plain `ObjectId ref User` — not role-gated, not tied to Project membership, not requiring an "assignment" record. | Whatever D-3a eventually decides (explicit assignment, role-gate, membership-based, or a combination) can be enforced entirely in the service layer's `changeStatus` authorization check without touching this schema shape. |
| User suspension                            | No `status`/`isActive` field added to `User` now.                                                                                                                                           | Additive field if introduced later — no migration of existing documents required beyond a default value.                                                                                                                     |
| Project status                             | No `status` field added to `Project` now, consistent with the Domain Model's explicit decision against one in V2.                                                                           | Same — additive if the Act milestone later proves a need.                                                                                                                                                                    |
| Leaving a Project                          | No "leave" operation designed; `contributors` remains a plain `ObjectId` array.                                                                                                             | An array-pull operation is trivial to add later; the array shape itself doesn't need to change to support it.                                                                                                                |
| Deletion/deactivation (any entity)         | No `deletedAt`/`isActive` soft-delete field added anywhere.                                                                                                                                 | Additive if introduced later. Hard-delete semantics remain undesigned, deliberately, matching the Domain Model's disposition.                                                                                                |

No action is taken on any of these now — this section confirms non-
foreclosure, it does not resolve anything.

---

## 10. Proposed persistence model (summary)

Field-level shape only — not schema code, not a Mongoose file. Presented
for review before any implementation.

**User** — `name`, `email` (unique), `passwordHash` (write-only, never
returned), `role` (`USER | EXPERT | ADMIN`), `bio`, timestamps.

**Issue** — `title`, `description`, `location` (GeoJSON Point, 2dsphere
indexed), `severity`, `category`, `domain` (default `"water"`), `status`
(indexed), `reportedBy` (ref User, required, immutable), `statusHistory`
(embedded array: `fromStatus`, `toStatus`, `actor` ref User, `timestamp`
— includes an initial `null → open` entry at creation, per §4), timestamps.

**Knowledge** — `title`, `body`, `region`, `status` (indexed), `author`
(ref User, required, immutable), `reviewHistory` (embedded array:
`decision`, `reviewer` ref User, `feedback` (required when rejected),
`timestamp` — decisions only, no entry for `draft`/`pending_review`
transitions, per §5), timestamps.

**Comment** — `refType` (`ISSUE | WIKI`), `refId` (polymorphic, indexed
compound with `refType`), `author` (ref User, required), `body`,
`parentComment` (ref Comment, nullable — service-enforced one level only,
per §3), timestamps.

**Project** — `title`, `description`, `originIssue` (ref Issue, required,
immutable, indexed), `creator` (ref User, required), `contributors`
(array of User refs), `progress`, timestamps.

**Recommendation** — no schema. `Issue → RecommendationService(issue) →
{ guidance, reasoning }`, computed per request.

---

## 11. Decisions requiring architectural sign-off

Judgment calls made in this analysis, surfaced explicitly rather than
treated as self-evidently correct:

1. **Embedding both history structures** rather than either as separate
   collections. The reasoning (§4, §5) rests on "no independent query
   requirement exists today" — worth confirming this holds against actual
   planned UI needs (e.g., does any admin view need to query status
   changes _across_ Issues, which would push toward a separate,
   independently-indexable collection instead). For Knowledge specifically,
   this rests on a **V2 capacity assumption**, not a domain-bounded growth
   argument — ADR-0004 places no cap on revision cycles, so embedding here
   is a scale bet, not a structural guarantee, and should be revisited if
   revision-cycle counts exceed expectations or independent querying of
   review history becomes a requirement (see §5 for the specific
   reconsideration conditions).
2. **Not adding a flat `resolvedBy`/`verifiedBy`/`reviewer` field**
   alongside the history arrays, even for query convenience (e.g. "show me
   the current verifier" without walking the array). This trades a small
   amount of query convenience for avoiding a denormalized field that
   could drift from the history's source of truth. Worth confirming this
   trade-off is acceptable rather than adding a "current reviewer"
   convenience field.
3. **`immutable: true` as a partial-only guard**, with the real
   enforcement living in service-layer discipline rather than the schema.
   This is a normal Mongoose limitation, but worth flagging as an accepted
   risk rather than an oversight.
4. **No transactions proposed anywhere.** Confirmed as a consequence of
   the embedding and reference choices above, not a separate decision —
   but worth architectural sign-off given how consequential a wrong call
   here would be to change later.
5. **Rejecting a shared generic history structure** (§5) — consistent
   with the Domain Model milestone's D-20 disposition, carried forward
   rather than re-argued from scratch.
6. **Concurrent lifecycle transition safety** (§4). The proposed mechanism
   — a conditional atomic update keyed on expected current status, rather
   than a generic optimistic-concurrency version field — is a genuine
   design choice, not a settled implementation detail. Worth confirming
   this is the right mechanism before it's built, since retrofitting a
   different concurrency strategy after write paths exist is more
   disruptive than choosing correctly now.
7. **Initial Issue status-history semantics** (§4). The decision to include
   a `null → open` entry at creation, making `statusHistory` a complete
   standalone timeline rather than a supplement to top-level
   `reportedBy`/`createdAt`, is a real modeling choice with a real
   alternative (excluding it) that was considered and rejected. Worth
   explicit sign-off since it affects what every consumer of Issue history
   can assume the array contains.

Once these decisions are reviewed and approved, no further domain-level
decisions are expected to block schema implementation. The seven items
above are flagged because they're the highest-judgment calls in this
document, not because they're unresolved in the way D-3a is unresolved.
