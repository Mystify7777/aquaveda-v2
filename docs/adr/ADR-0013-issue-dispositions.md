# ADR-0013: Issue dispositions

## Status

Accepted.

## Context

ADR-0003 defines the Issue lifecycle as:

`open → acknowledged → in_progress → resolved → verified`

That lifecycle describes the progression of a valid Issue through remediation. Issue #199 requires a controlled triage outcome for reports that should not proceed through remediation: invalid reports, duplicates of an existing Issue, and voluntary withdrawal by the reporter.

These outcomes describe what happened to the report, not a new remediation lifecycle state. Adding `dismissed` or `withdrawn` to the five-state lifecycle would change the meaning and transition graph established by ADR-0003.

## Decision

Issue #199 uses **terminal disposition metadata attached to an Issue**, while preserving the existing five-state `status` field.

The current Issue therefore has two independent concepts:

- `status`: lifecycle progression of a valid Issue.
- `disposition`: terminal triage outcome, when one exists.

A disposed Issue cannot perform any further lifecycle or remediation operation. Its original lifecycle status remains stored for history and compatibility, while public reads expose the disposition explicitly.

### Dispositions

| Disposition | Meaning | Authority | Allowed source status |
|---|---|---|---|
| `invalid` | The report does not meet Issue validity/eligibility criteria. | EXPERT | `open` |
| `duplicate` | The report substantially duplicates an existing canonical Issue. | EXPERT | `open` |
| `withdrawn` | The reporter voluntarily retracts the report. | Reporter | `open` |

ADMIN does not receive a generic override/reopen/dismiss capability. Existing ADMIN authority remains unchanged.

### Notes and duplicate linkage

- `invalid` requires a non-blank explanatory note.
- `duplicate` requires a non-blank explanatory note and a canonical Issue reference.
- `withdrawn` accepts an optional note.
- A duplicate cannot reference itself.
- The canonical Issue must exist and must not itself be disposed.
- Once an Issue is referenced as a canonical Issue, it cannot itself receive a terminal disposition.
- Disposition does not mutate or delete the canonical Issue.

### Reopening

Dispositions are terminal in V2. There is no reopen operation. If a withdrawn or invalid report needs to be reconsidered, a new Issue may be submitted. Duplicate reports remain linked to the canonical Issue.

### Visibility

Disposed Issues remain publicly readable. Public DTOs expose:

- the unchanged lifecycle `status`;
- the current disposition;
- the disposition timestamp and public note;
- the canonical Issue ID for duplicates.

This preserves the report's auditability rather than making a disposition silently disappear.

### History and audit

Disposition changes are append-only in `dispositionHistory`. Each entry records:

- disposition;
- actor;
- timestamp;
- note, when supplied;
- canonical Issue ID for duplicates.

The current `disposition` is a compact read projection of the terminal decision. No lifecycle history entry is fabricated for a disposition.

### Workflow capabilities

The server workflow capability model exposes:

- `disposition.invalid` to an EXPERT for an open, undisposed Issue;
- `disposition.duplicate` to an EXPERT for an open, undisposed Issue;
- `disposition.withdraw` to the reporting actor for an open, undisposed Issue.

The frontend renders these capabilities without inferring authority from role or status.

### Remediation interaction

Because dispositions are allowed only from `open`, no Issue with an active remediation grant or remediation lifecycle state can be disposed. Existing remediation, resolution, verification, and failed-verification semantics remain unchanged.

## Consequences

- The five-state lifecycle remains stable and valid Issues retain their existing semantics.
- Public consumers must distinguish lifecycle status from terminal disposition.
- Workflow evaluators and mutation services must both enforce the same disposition predicates.
- No generic cancellation or reopen operation exists.
- Future recurrence/reopening remains a separate domain decision.

## Rejected alternatives

### Add `invalid`, `duplicate`, and `withdrawn` as ordinary Issue statuses

Rejected because it would expand ADR-0003's lifecycle graph and conflate triage outcomes with remediation progression.

### Add a generic `dismissed` status

Rejected because it loses the distinction between invalid, duplicate, and voluntary withdrawal that Issue #199 explicitly requires.

### Allow ADMIN to override any disposition

Rejected because existing Issue authority deliberately separates platform governance from domain-quality authority. No new generic administrative lifecycle authority is justified by this issue.

### Delete disposed Issues

Rejected because deletion would destroy the audit trail and violate Issue #199's history/integrity requirements.
