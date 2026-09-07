# Authorization & Ownership Policy Consolidation — architecture investigation report

**Status: investigation report only. No code. No dependency changes.
No `decision-register.md` modifications.** Per the assignment's own
constraints, this ends at the report — implementation, D-3a resolution,
Project membership invention, and generic-ownership infrastructure are
all explicitly out of scope for this document.

Sources read directly (not from prior summaries):
`server/src/services/issue.service.js`, `knowledge.service.js`,
`comment.service.js`, `project.service.js`, `errors.js`,
`server/src/models/{User,Issue,Knowledge,Comment,Project}.js`,
`server/src/middleware/auth.js`, `docs/architecture/decision-register.md`,
`docs/domain/domain-model.md`, `docs/vision/product-invariants.md`,
`docs/engineering/standards.md`.

---

## 1. Existing authorization inventory

| Check | Location(s) | Duplication count | Current policy meaning | Consolidation justified? |
|---|---|---|---|---|
| Actor presence (`!actorContext?.id` → `UNAUTHORIZED`) | `requireActor()` in `issue.service.js`, `knowledge.service.js`, `comment.service.js`, `project.service.js` | 4 — byte-for-byte identical function bodies in all four files | "An unauthenticated request cannot perform any write." Universal, no exceptions found anywhere. | **Yes.** Identical code, identical meaning, zero variation across 4 sites. |
| Role gate `role !== "EXPERT"` | `issue.service.js` (`resolved→verified`; `resolved→in_progress`), `knowledge.service.js` (`approve`, `reject`) | 4 inline occurrences, each independently written (not calling a shared function) | "Only EXPERT may perform this specific state-changing action." Never ADMIN, never USER, no exceptions. | **Yes, but narrowly.** All 4 sites check the exact same single role against the exact same field name (`actorContext.role`). No site checks a role *set*. |
| Ownership gate (`author !== actorContext.id`) | `knowledge.service.js`: `submitForReview` (must equal), `revise` (must equal) | 2, both in the same file, both "must equal author" (never "must equal admin," never "must differ") | "Only the Knowledge author may submit their own draft or revise their own rejected draft." | Only 2 instances, both structurally identical to each other. Justifies at most a narrow, same-file helper — see §4. |
| History-derived identity gate | `issue.service.js` `authorizeTransition()` (resolver ≠ verifier, read from `statusHistory`'s last entry), `knowledge.service.js` `approve`/`reject` (reviewer ≠ author, read from the document's own `author` field) | 2, structurally different from each other (one requires array traversal, one doesn't) | "The same person cannot both act and later approve/verify their own action." | **No.** Not the same shape. Forcing a shared abstraction here would be premature generalization. |
| D-3a gate (`AUTHORIZATION_POLICY_UNRESOLVED`) | `issue.service.js`, 2 sites (`acknowledged→in_progress`, `in_progress→resolved`) | 2, deliberately unconditional (thrown for every role, not a real check) | "No policy exists yet; this is not evaluable." | N/A — not a real authorization check, a placeholder marker. Not a consolidation candidate; see §6. |

No authorization check exists anywhere for: Issue ownership
(`reportedBy` is read but never compared to `actorContext`), Project
ownership (`creator`/`contributors` are never compared to
`actorContext` outside of writing them at creation), or Comment
ownership (`author` is written, never checked). This is not 3 missing
consolidations — it's 3 entities with **zero** existing ownership
policy to consolidate, because no operation currently reads those
fields for authorization purposes.

## 2. Existing vs. deferred vs. genuinely unbuilt

**Existing behavior** (real, tested, in the 127/127 suite):
- Actor-presence gate (universal).
- EXPERT-only gates on 3 Issue/Knowledge state transitions.
- Knowledge author-only gates on `submitForReview`/`revise`.
- Two bespoke self-action exclusions (resolver≠verifier, reviewer≠author).

**Deliberately deferred** (on record in `decision-register.md`'s ⏸️
table, re-confirmed by direct re-reading, not re-litigated here):
- Comment deletion (soft/hard).
- Admin governance of already-approved Knowledge.
- Leaving a Project.
- Expert role *acquisition* mechanism (distinct from what EXPERT means
  once held, which is in scope for this milestone).

**Genuinely unbuilt** (no operation exists for a policy to attach to —
not a deferred decision, an absent one):
- Any edit operation on Issue, Comment, or Project.
- Any delete operation on any of the four entities.
- Any Project join/membership-changing operation (`contributors` is
  written once, at creation, as `[]`, and never touched again by any
  service function).
- Any ADMIN-gated operation of any kind (see §5).

The distinction matters concretely: deciding "who may edit a Comment"
today means inventing both the operation and its policy simultaneously
— the failure mode the assignment explicitly warns against ("Do not
invent future authorization policy merely to make the architecture
look complete").

## 3. Proposed authorization primitives

Only two are justified by actual repeated usage; a third
(`requireOwner()`) is explicitly not proposed, with reasons given.

### `requireActor(actorContext)` — consolidate, do not redesign

- **API shape**: unchanged from what already exists in all 4 files —
  `(actorContext) => void`, throws `UNAUTHORIZED` if `!actorContext?.id`.
- **Responsibility**: confirm a request has *any* identified actor,
  nothing more.
- **Why it exists**: already exists 4 times, byte-identical (per direct
  read — see stop-and-flag condition in §7 for the implementation-time
  confirmation this still deserves). Pure deduplication, not new
  policy.
- **Duplication removed**: 4 → 1.

### `requireRole(actorContext, role)` — single required role, no sets

- **API shape**: `(actorContext, role: string) => void`, throws
  `FORBIDDEN` if `actorContext.role !== role`. **Single role parameter
  only — no array, no `["EXPERT", "ADMIN"]` semantics.** Deliberate
  API-level constraint, not an oversight: Product Invariant 9
  ("Experts verify. Admins govern. Neither substitutes for the
  other.") is currently impossible to violate by construction, because
  no code path checks for either role interchangeably. A `requireRole`
  accepting a role *set* would make that violation one call-site typo
  away (`requireRole(ctx, ["EXPERT","ADMIN"])` where only EXPERT was
  meant) instead of structurally impossible. Keeping the signature
  single-role preserves the invariant as an API-level guarantee, not a
  code-review convention.
- **Why it exists**: 4 existing call sites already check exactly one
  role each; no site ever checks more than one. The primitive matches
  actual usage exactly, nothing more.
- **Duplication removed**: 4 inline checks → 1 shared function, 4 call
  sites.

### Not proposed: `requireOwner()` (generic)

Investigated per the assignment's actual question ("does the existing
system have a general ownership rule?" — not "how do we implement
requireOwner"). Answer: **no.** Only 2 real ownership checks exist,
both in `knowledge.service.js`, both checking the exact same field
(`author`) against the exact same actor field (`id`), with identical
semantics. Two identical instances in one file is weaker evidence than
the two primitives above — plausible to extract into a same-file
helper (`requireKnowledgeAuthor(knowledge, actorContext)`) if
`knowledge.service.js` grows a third such check, but not strong enough
to justify a cross-entity, generic `requireOwner(doc, actorContext,
field)` today, especially since Issue, Comment, and Project have **no**
ownership check at all to generalize from — building a generic version
now designs for 3 hypothetical cases against 1 real one.

### Not proposed: any multi-role helper, any generic `authorize()` dispatcher

No existing call site needs either. Building either now would be
speculative infrastructure with zero current call sites — the
"no speculative abstractions" theme already restated across
Foundation, Persistence Design, and Phase D in this same register.

## 4. Ownership decision

**Explicit answer: "ownership automatically grants authority" is not a
valid general rule for this project, and should not become one.**

Evidence against treating it as universal:
- **Knowledge**: ownership (`author`) grants exactly two specific
  rights (`submitForReview`, `revise`) — not "edit anything," not
  "delete," not "self-approve" (explicitly forbidden: an author may
  not approve their own submission). Ownership here is a narrow,
  operation-specific gate, not a general authority.
- **Issue**: ownership (`reportedBy`) grants **zero** rights today. A
  reporter cannot change their own Issue's status, cannot edit it,
  cannot delete it. This isn't a gap — ADR-0003 (re-read directly)
  assigns Issue status authority to role (EXPERT) or D-3a, never to
  the reporter, by design.
- **Project**: ownership (`creator`) grants zero rights today, because
  no operation exists yet that would test it (§2).
- **Comment**: ownership (`author`) grants zero rights today, same
  reason.

The pattern that does hold: **where ownership grants anything, it's
because a specific operation's design says so, not because ownership
is inherently authoritative.** Recommendation: keep ownership semantics
operation-specific going forward, exactly as today. Do not introduce a
blanket rule ("owners may always edit/delete their own resources") — no
product invariant states this, and Issue's own design already
contradicts it.

## 5. ADMIN decision

**Explicit recommendation: do not implement an ADMIN-only capability in
this milestone.**

Investigated per the assignment's actual question — whether an
*existing* operation could naturally become ADMIN-gated without
inventing a new one:
- Issue's 5 transitions: all already have a settled authority story
  (EXPERT for 2, D-3a-blocked for 2, none is a governance action —
  acknowledging/verifying an Issue is domain-quality judgment, which
  Invariant 9 assigns to EXPERT specifically). Re-purposing any of
  these to ADMIN would contradict ADR-0003's already-locked authority
  assignment, not extend it.
- Knowledge's `approve`/`reject`: same reasoning — Invariant 9 assigns
  domain-quality verification to EXPERT, explicitly not substitutable
  by ADMIN. Making either ADMIN-eligible would directly violate the
  invariant this milestone exists to protect.
- The one deferred item that actually matches "governance over
  something that already exists" — admin governance of already-
  approved Knowledge — is explicitly listed in the deferred table as
  "a real future need, not solved by extending approval authority
  now." That's a correct existing call, not a gap this report should
  reverse; the deferred entry itself acknowledges the need is real
  while declining to solve it prematurely, pending a concrete shape
  (unpublish? flag? re-review trigger?) that doesn't exist yet.

No existing operation can be honestly ADMIN-gated without either
contradicting an already-locked authority decision (ADR-0003/0004,
Invariant 9) or inventing a new operation to attach it to — which the
assignment explicitly says not to do. **Recommendation: document this
as an acknowledged, currently-open gap** (Invariant 9's governance half
remains asserted-but-unimplemented) rather than manufacture a
capability — the same treatment already given to D-3a.

## 6. D-3a decision

**D-3a remains explicitly out of scope for this milestone.**

Direct re-reading of `decision-register.md` confirms its resolution is
tied to a Project membership/authorization model that does not
currently exist:

> "To be resolved during Project/Act authorization design, once an
> actual Project membership/authorization model exists to attach an
> answer to."

Confirmed against the actual codebase: `Project.contributors` is
written once (empty array, at creation) and never read or modified by
any service function afterward (§2). There is no join operation, no
assignment mechanism, no membership concept beyond a static array
nobody populates. D-3a's own recorded candidate models
(`automatic-by-creator`, `automatic-by-contributor`, `explicit
assignment`) are all Project-membership-shaped and depend on that
concept existing first.

`decision-register.md` also explicitly rules out inventing any of the
following as part of *any* unrelated work — a category this milestone
falls into if it touched D-3a at all: a `REMEDIATOR` role, automatic
authority from Project creator status, contributor authority, or
explicit-assignment infrastructure. No new evidence emerged in this
investigation to justify overriding that.
`AUTHORIZATION_POLICY_UNRESOLVED` stays exactly as implemented; this
report does not propose touching `issue.service.js`'s D-3a gate.

## 7. Proposed implementation boundary

### In scope
- Extract `requireActor()` into one shared module, imported by all 4
  services, deleting the 4 duplicate definitions.
- Introduce `requireRole(actorContext, role)` as a single-role-only
  primitive; replace the 4 inline role checks with calls to it.
- Record, in the eventual decision report, the ownership finding from
  §4 as a locked statement ("ownership is operation-specific, not a
  general authority") so it isn't silently re-litigated later.
- Record the ADMIN gap from §5 as an acknowledged, open item — not
  solved, not hidden.
- Formally re-record D-3a's out-of-scope status (§6), so a future
  thread doesn't need to re-derive this reasoning from scratch.

### Out of scope
- D-3a resolution in any form (§6).
- Any Project membership/assignment/contributor-authority model.
- A generic `requireOwner()` (§3) — insufficient evidence (2 identical
  instances, one file).
- Any multi-role or role-set authorization API (§3, §1) — would make
  Invariant 9 violable by construction.
- Any new edit/delete operation on any entity (§2) — feature work, not
  authorization policy.
- Comment deletion, Project leave, Admin re-review of Knowledge — all
  previously deferred (§2), no new requirement surfaced here.

### Deferred dependencies
- A real ADMIN capability depends on either (a) a concrete shape for
  "governance of approved Knowledge" being decided in a future
  milestone, or (b) some other governance-shaped operation being
  designed first. Neither exists yet.
- D-3a depends entirely on the Project/Act milestone producing an
  actual membership model.
- A cross-entity `requireOwner()` depends on at least one more real
  ownership check appearing outside `knowledge.service.js` — currently
  0 such cases exist (Issue/Comment/Project all have none).

### Stop-and-flag conditions
- If implementing `requireRole()` reveals any existing call site that
  actually needs more than one accepted role, stop and flag before
  proceeding — that would contradict this report's §3 finding and
  needs its own review, not a silent signature widening.
- If consolidating `requireActor()` surfaces even one of the 4 copies
  behaving subtly differently (different error message, different edge
  case), stop and flag — this report asserts byte-identical behavior
  from direct reading, but a mechanical diff during implementation is
  the real confirmation.
- If any future request asks to attach D-3a resolution, a generic
  `requireOwner()`, or an ADMIN capability to this milestone's
  implementation step, treat that as a scope change requiring its own
  review cycle, not an in-flight addition.
