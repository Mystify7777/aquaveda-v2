# ADR-0003: Issue status lifecycle

## Status

Accepted, with one dependency deferred (see Consequences).

## Context

V1's `UpgradePlan.md` proposed a five-state Issue lifecycle
(`open → acknowledged → in_progress → resolved → verified`) but never
actually implemented it — the legacy findings in the v1→v2 context
transfer confirm this was a plan, not proven behavior. The existing
`domain-model.md` already names the five states, but naming a vocabulary
is not the same as defining a state machine: no v1 or v2 document
previously specified valid transitions, transition authority, or what
each state means operationally.

This ADR defines the actual state machine, arrived at through a staged
domain-analysis review (Domain Model Analysis, Issue lifecycle cluster).

## Decision

Adopt the five-state lifecycle with the following semantics, transitions,
and authority model.

### State semantics

| State          | Meaning                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`         | Reported. No authorized actor has reviewed it yet.                                                                                                                                             |
| `acknowledged` | An authorized actor has reviewed the report and accepted it for further action. (Not a claim that the report is factually verified — only that it's been reviewed and accepted for attention.) |
| `in_progress`  | Remediation work is actively underway.                                                                                                                                                         |
| `resolved`     | The actor performing remediation claims the problem is fixed. A claim, not a fact.                                                                                                             |
| `verified`     | An independent, authorized Expert confirms the claimed resolution holds. The fact, following the claim.                                                                                        |

### Transition graph

```
open ──→ acknowledged ──→ in_progress ──→ resolved
                                ▲             │
                                │             ├─ verification succeeds → verified (terminal)
                                └─────────────┴─ verification fails → in_progress
```

No other transitions are valid. In particular:

- `acknowledged → open`, `in_progress → acknowledged`, `resolved → acknowledged`
  are all invalid — none describe a real state of the world.
- `verified` is terminal. Recurrence of a previously verified issue is out
  of scope for V2 (see Consequences / parking lot).
- The `resolved → in_progress` transition occurs **only** on failed
  verification. It is not a generic "reopen" — that term is reserved for
  the deferred recurrence concept.

### Transition authority

| Transition                                     | Authority                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `open → acknowledged`                          | EXPERT                                                                                                                                      |
| `acknowledged → in_progress`                   | Requires an authorized remediation actor. Mechanism deferred — see D-3a below.                                                              |
| `in_progress → resolved`                       | Requires an authorized remediation actor. Mechanism deferred — see D-3a below.                                                              |
| `resolved → verified`                          | EXPERT, and **never** the same account that set `resolved` — this is a hard invariant (`resolverId !== verifierId`), not a soft preference. |
| `resolved → in_progress` (failed verification) | EXPERT                                                                                                                                      |

ADMIN does not hold Issue verification authority. Verification is a
domain-quality assertion about a physical outcome, which is EXPERT's
domain per Product Invariant 9's separation of expert and platform
authority — ADMIN's governance role does not imply competence to confirm
water-conservation remediation.

### Domain operation contract

```
changeStatus(issue, targetState, actor) validates:
  1. current state permits the transition
  2. actor holds authority for this transition
  3. transition-specific constraints hold (e.g. resolverId !== verifierId)
  4. domain invariants hold
```

Invalid transitions and unauthorized actors must be rejected by the domain
operation itself, not merely by a generic authorization failure at a
higher layer.

### Status history

Issue status history has domain significance: `resolved` is an
accountable claim and `verified` is its independent confirmation, and that
relationship only means something if the system retains enough transition
information (state, actor, timestamp) to support it. This is a domain
requirement. **How** that history is represented — embedded array, separate
collection, or otherwise — is explicitly deferred to persistence design and
is not decided by this ADR.

## Why

- The claim/confirmation split (`resolved` vs. `verified`) gives the
  lifecycle an actual trust mechanism instead of five arbitrary labels.
  Product usefulness depends on `verified` meaning something a user can
  rely on — which requires independence between the two actors.
- `acknowledged` as mandatory (not skippable) preserves its function as a
  visible "an authority has seen this" signal. Making it optional would
  make the signal unreliable.
- Restricting Issue verification to EXPERT (not EXPERT-or-ADMIN) follows
  directly from Product Invariant 9 rather than assuming admin authority is
  a superset of expert authority — a distinction this project has now
  applied consistently across both Issue and Knowledge (ADR-0004).

## Alternatives considered

- **Three-state lifecycle** (`open/in_progress/resolved`, matching v1's
  actually-implemented behavior) — rejected: doesn't provide the
  independent-confirmation trust mechanism, which was the entire point of
  the richer model being proposed in the first place.
- **EXPERT-or-ADMIN verification** — rejected: conflates platform
  governance authority with domain-quality authority. See Product
  Invariant 9.
- **Allowing `verified → in_progress` for recurrence** — rejected for
  V2: no evidence of product need yet; parked rather than designed
  speculatively. A future `relatedIssue` reference on a new Issue is the
  more likely shape if this becomes necessary, but that's a future
  decision, not this one.

## Consequences

- **D-3a is an open dependency, not an oversight.** `acknowledged →
in_progress` and `in_progress → resolved` both require "an authorized
  remediation actor," but the mechanism for obtaining that authority is
  deferred to the Project/Act authorization design (see the Issue↔Project
  domain analysis). This ADR does not invent a `REMEDIATOR` role, an
  explicit-assignment system, or automatic authority from Project
  membership to close that gap. Until D-3a resolves, the Issue authority
  matrix has two rows that cannot be fully specified, and this ADR cannot
  be considered fully closed — only the parts independent of D-3a are
  final.
- Persistence design (status history shape, indexes) is not addressed here
  and follows this ADR, not the other way around.
- Recurrence/reopening of `verified` Issues is parked in
  `docs/future/parking-lot.md`, not designed against.

## Update (2026-11-01): D-3a resolved by ADR-0007

The two "mechanism deferred" rows above are specified by
[ADR-0007](./ADR-0007-remediation-authorization.md): remediation authority is an
explicit, EXPERT-issued, grantee-accepted, issue-scoped grant (embedded single assignee),
checked atomically with the transition. The original text above is retained unchanged as
the record of the earlier deferral.
