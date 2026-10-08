# Domain Model

Everything in the product is a UI over a small set of primitives.
Thinking in primitives prevents the same concept from being independently
reimplemented in three different modules.

Each primitive lists the milestone that first builds it.

---

## User — _Authentication milestone_

Identity and role. Roles: `USER`, `EXPERT`, `ADMIN`.
Every contribution traces to an account (Product Law 1).

## Issue — _Explore milestone_

A geo-tagged, reported problem. Always has a location (Product Law 2).
Independently real whether or not a Project exists around it. Carries a
`domain` field defaulting to `"water"` — the schema doesn't assume water is
the only thing ever reportable.

Status lifecycle (full rationale in ADR-0003):

```
open ──→ acknowledged ──→ in_progress ──→ resolved
                                ▲             │
                                │             ├─ verification succeeds → verified (terminal)
                                └─────────────┴─ verification fails → in_progress
```

`resolved` is a claim by whoever performed remediation; `verified` is an
independent EXPERT confirmation of that claim (`resolverId !== verifierId`,
a hard invariant). `acknowledged` is mandatory, not skippable — it's the
platform's "an authority has reviewed this" signal, and only means
something if it can't be bypassed. EXPERT holds Issue-verification
authority; ADMIN does not (Invariant 9 — governance authority isn't
domain-quality authority). The domain requires enough status-transition
information to be retained because `resolved`/`verified` accountability
depends on knowing who made which claim and when.

**Classification (Issue #67, resolves D-9).** `category` (what kind of water
problem was observed — a lay observation, not a technical diagnosis) and
`severity` (impact/urgency on people or the environment — not reporter
confidence, fix difficulty/cost, or moderation priority) are **optional** at
creation. Contract, by representation:

| Layer                | Unspecified            | Canonical value | `""` | Other string |
| -------------------- | ---------------------- | --------------- | ---- | ------------ |
| Request (POST)       | **omit the key**       | accepted        | **rejected** | rejected |
| Persistence / read   | represented as `""`    | stored as-is    | —    | —            |

The client never sends `""`; `""` exists only as the persistence/read
representation of "unclassified" (the schema default). Minimum reportable
information stays title + description + location.

| `category` value         | Label                   | Meaning                                                  |
| ------------------------ | ----------------------- | -------------------------------------------------------- |
| `supply_shortage`        | No or low water supply  | Water is not arriving, or far less than usual            |
| `leakage_wastage`        | Leak or wastage         | Visible leaking, overflowing, or wasted water            |
| `water_quality`          | Water quality concern   | Unusual colour, smell, taste, or visible pollution       |
| `flooding_drainage`      | Flooding or drainage    | Standing water, waterlogging, or blocked drains          |
| `damaged_infrastructure` | Damaged water facility  | Pump, tank, tap, well, or pipeline broken or not working |
| `other`                  | Other water issue       | Water-related, fits none of the above                    |

| `severity` value | Label    | Meaning                                                          |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `low`            | Low      | Minor; little effect on daily water use or safety                |
| `medium`         | Medium   | Noticeable disruption or ongoing waste, not immediately harmful  |
| `high`           | High     | Serious disruption or risk affecting many people or environment  |
| `critical`       | Critical | Immediate risk to health or safety, or a severe emergency        |

Source of truth: `server/src/domain/issue-classification.js` (values, labels,
descriptions). Backend Zod validation, the Issue Mongoose enum, and the
frontend form/types all derive from it — no other list may exist. The set is
a bounded V1 decision: no existing locked document defined a vocabulary, so
it is deliberately small and low-friction. To add a value, append an entry to
that module (never rename or reuse a `value`; labels/descriptions may be
reworded), update this section, and add a test. Renaming/removal needs a data
migration decision.

**Read-type assumption.** The frontend type for `category`/`severity` is
`IssueCategory | ""` / `IssueSeverity | ""` (no plain `string`). This assumes
no non-canonical values exist in the database, and the repository supports
that: v2 is a rebuild (not a data migration from v1), the only seed script
creates Users, there are no Issue fixtures or migrations, and no client
ever submitted category/severity before #67 (the #44 form omitted them). Note
this is a compile-time claim only — the API client does not validate response
bodies, and Mongoose reads do not re-validate, so the type is an assumption
about stored data, not a runtime guarantee. If pre-#67 rows with free-text
values are ever introduced (e.g. a v1 import or shared environment data),
that requires an explicit decision — a migration, or a deliberate
compatibility representation on the read contract — not silent normalization
or widening the type to `string`.

**Open dependency:** `acknowledged → in_progress` and `in_progress →
resolved` both require an "authorized remediation actor," but the
mechanism for obtaining that authority is deferred to the Project/Act
authorization design — see D-3a in the domain decision register. Project
creator/contributor status does **not** by itself grant this authority.

## Knowledge — _Learn milestone_

A moderated article. Draft until expert-approved, then public.
Author-owned while pending. Full rationale in ADR-0004.

```
draft ──submit──→ pending_review ──approve──→ approved (terminal in V2)
   ▲                    │
   │                 reject
   │                    ▼
   └──────revise──── rejected
```

Rejection is revision-capable, not terminal — a rejected article returns to
`draft` on the same entity, not a new submission/version. Rejection
requires actionable feedback, since the revision path only means something
if the author can act on it. Content is locked while `pending_review` — a
reviewer must evaluate exactly what they're reviewing. Approval and
rejection require an authorized **EXPERT**, consistent with Issue
verification in ADR-0003 — ADMIN's platform-governance role does not
imply competence to judge Knowledge quality and accuracy, per Invariant 9.
Hard invariant: `reviewerId !== authorId`, regardless of role — an author
can never approve their own submission.

## Comment — _shared primitive, first built at Explore, reused at Learn_

Attached to either an Issue or a Knowledge article via a `refType`
discriminator. Built once, mounted in two places. "Community" is a view
over this primitive, not where it's implemented.

## Project — _Act milestone_

Created from an Issue, never standalone. Has contributors and
creator-controlled progress tracking. No status/lifecycle field in V2 —
existence, contributors, and progress are sufficient for now.

An Issue may have **zero or more** Projects originating from it — always
write and think in the plural. Multiple Projects around one Issue
represent independent action initiatives (distinct actors, approaches, or
resources), not duplicate records of the same effort. Each Project
references exactly one originating Issue, set at creation and immutable
afterward. Project creation requires the originating Issue's status to be
in `{acknowledged, in_progress, resolved, verified}` — not `open`, since
organizing action around an unreviewed report undercuts what
`acknowledged` is meant to signal.

Issue and Project lifecycles are independent after creation: an Issue
reaching `verified` does not close or complete an associated Project, and
Project ownership (`creator`) is fully independent from Issue ownership
(`reportedBy`) — no inheritance either direction. Project creator or
contributor status does not, by itself, grant any Issue lifecycle
authority (see the Issue section above and D-3a).

## Recommendation — _AI milestone_

A **derived service output, not a persisted entity.** Computed on request
from the rule engine (and later, optionally, an LLM layer) against an
Issue — no `Recommendation` collection, no ownership, no lifecycle, no
authority semantics, since nothing is being asserted by a person that
needs independent confirmation.

Must carry its reasoning alongside its guidance on every response (Product
Law 3) — not merely "which keyword matched," since that would
unnecessarily constrain a future, richer rule engine.

Product Invariant 7 ("AI never overrides verified knowledge") is an
authority contract enforced at the service boundary, not a semantic
conflict-detection requirement: approved Knowledge is authoritative within
the domain; Recommendation is assistive and carries no capability to
alter, invalidate, downgrade, or supersede an approved Knowledge record.
The rule engine has no obligation to compare its output against Knowledge
content — the contract is about what Recommendation _can never do_
(nothing writes to Knowledge from this path), not about detecting
disagreement.

---

## Cross-entity principle

**Ownership, participation, contribution, governance, and domain
verification are distinct forms of authority and must not be inferred
from one another without an explicit domain rule.** This shows up
repeatedly across the model rather than being one entity's quirk: Issue
reporter ≠ Issue verifier, Knowledge author ≠ Knowledge reviewer, Project
creator/contributor ≠ Issue lifecycle authority, and ADMIN is never treated
as a superset of EXPERT capability. Any future feature that appears to
grant authority based on adjacency (e.g. "they're on the Project, so they
must be able to...") should be checked against this principle before being
implemented.

---

Product Invariants and Product Laws live in `docs/vision/product-invariants.md`.
They are listed there rather than here because they are constitutional rules
that survive any restructuring of the domain model itself.

Full lifecycle rationale, alternatives considered, and consequences for
Issue and Knowledge live in `docs/adr/ADR-0003-issue-lifecycle.md` and
`docs/adr/ADR-0004-knowledge-lifecycle.md`. The complete decision record
from the Domain Model milestone — including deferred and dispositioned
items — lives in `docs/architecture/decision-register.md`.

## Expert acquisition (#91)

`User.role` becomes `EXPERT` only through an ADMIN-approved `expertApplication` (pending → approved), never by client input. See decision-register EXP-L1–L8.
