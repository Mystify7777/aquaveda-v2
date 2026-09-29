# Domain Model milestone decision register

Produced through a staged review: full entity-by-entity analysis → four
decision clusters (Issue lifecycle, Knowledge lifecycle, Issue↔Project,
Recommendation), each proposed and reviewed independently → cross-entity
consistency review → this register. D-3a remains unresolved (see below);
this register is not a record of a fully closed milestone.

## 🔒 Locked (see ADR-0003, ADR-0004, `domain-model.md`)

- Issue lifecycle: 5-state graph, transition authority, `resolverId !==
verifierId`, EXPERT-only verification, `acknowledged` mandatory,
  failed-verification routes to `in_progress` only, `verified` terminal
  for V2.
- Knowledge lifecycle: `draft → pending_review → approved | rejected →
draft`, EXPERT-only review authority, `reviewerId !== authorId`,
  mandatory rejection feedback, content locked during `pending_review`, no
  re-review of approved content in V2.
- Issue ↔ Project: `Issue 0..* Project`, immutable required origin
  reference, creation gated to Issue status ∈ `{acknowledged, in_progress,
resolved, verified}`, independent ownership, independent lifecycles, no
  automatic Issue authority from Project membership.
- Recommendation: derived service output, no persistence, no
  ownership/lifecycle/authority, Invariant 7 as a service-boundary
  authority contract (not conflict detection), reasoning required on every
  response.
- Cross-entity principle: ownership, participation, contribution,
  governance, and domain verification are distinct and never inferred
  from one another without an explicit rule.

## ⏸️ Deferred

| Item                                           | Note                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| User suspension/deactivation                   | No current requirement; adding a status field now would be speculative                                                        |
| Expert role acquisition mechanism              | Belongs to the Authentication/Governance milestone — `role: EXPERT` as a fact is established, the assignment _process_ is not |
| Comment deletion (soft/hard)                   | No v1 precedent, no current requirement                                                                                       |
| Project status field                           | Explicitly decided against for V2; revisit only if the Act milestone proves a need                                            |
| Leaving a project                              | No v1 precedent, no current requirement                                                                                       |
| Admin governance of already-approved Knowledge | Real future need, not solved by extending approval authority now                                                              |
| Re-review of approved Knowledge                | Out of scope for V2                                                                                                           |
| Issue recurrence / reopening `verified`        | Parked; a future `relatedIssue` reference is the likely shape, not un-terminaling `verified`                                  |

## 🔧 Implementation detail (resolved when the relevant schema is written, no ADR needed)

- Issue `category`/`severity`: **resolved (Issue #67)** — optional, canonical enum vocabularies defined in `server/src/domain/issue-classification.js`; see `domain-model.md` (Issue → Classification).

## 🟢 Established (already correct, not reopened)

- One-level comment threading (carried from v1, no pressure to change).
- Dashboard data stays fully derived via aggregation, no persistence.

## 📝 Documentation tasks (not decisions)

- Invariant-7 wording in `domain-model.md` — written as an authority
  contract, not a UI-framing note. Done.
- Plural "Projects originating from an Issue" phrasing enforced throughout
  `domain-model.md` and future docs, to prevent drift back toward an
  implied `0..1` relationship. Done.

## 🟡 The only unresolved domain dependency

**D-3a — Remediation-assertion authority.**

The Issue lifecycle (ADR-0003) requires `acknowledged → in_progress` and
`in_progress → resolved` to be performed by an "authorized remediation
actor." The mechanism by which a user obtains that authority is not
resolved by this milestone.

- Does not block `domain-model.md` or ADR-0003 from documenting the rest
  of the Issue lifecycle.
- Does block final closure of the Issue authority matrix.
- To be resolved during Project/Act authorization design, once an actual
  Project membership/authorization model exists to attach an answer to.
- Explicitly not resolved by: inventing a `REMEDIATOR` role, an
  explicit-assignment system, or granting automatic authority from Project
  creator/contributor status.

Candidate models on record for that future design session (none selected):
automatic-by-creator, automatic-by-contributor, explicit assignment,
EXPERT/ADMIN-only, or a combination.
