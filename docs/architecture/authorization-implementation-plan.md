# Authorization & Ownership Policy — implementation plan

**Status: plan only. No production code written.** Based on the locked
decisions in `decision-register.md`'s "🔒 Locked — Authorization &
Ownership Policy" section (AUTH-L1–L5), promoted from
`authorization-architecture-decision-report.md`. Do not begin
implementation from this document without a separate go-ahead.

Goal: pure refactor. Every existing test must still pass unchanged in
behavior — this plan adds no new policy, removes no existing check,
changes no error code or message that any test currently asserts on.

---

## 1. Shared authorization module to create

**New file: `server/src/services/authorization.js`**

```
requireActor(actorContext)
  → throws UNAUTHORIZED iff !actorContext?.id
  → identical to the 4 existing copies, moved, not modified

requireRole(actorContext, role)
  → throws FORBIDDEN iff actorContext.role !== role
  → exactly two parameters, always — no array/set, no per-call-site
    message. Message is canonical (see §2a); role/actualRole are
    carried in `details`, not prose.
```

Both functions import from `./errors.js` exactly as the 4 services
already do (`unauthorized`, `forbidden`) — no new error codes, no new
`DomainErrorCode` entries.

Placed alongside the other services (not in a `middleware/` or
`lib/` directory) because these are domain-service-layer primitives,
consumed only by the four domain services — consistent with
`actorContext`'s existing boundary (opaque input, never touches
Express/JWT/cookies), not a fifth arm of `authMiddleware`.

## 2. The four service files to refactor

For each file: delete the local `requireActor()` definition, import
the shared one, and replace inline role checks with `requireRole()`
calls. **No change to control flow, ordering, or which check runs
before which** — only the mechanism of each check changes.

### `server/src/services/issue.service.js`
- Delete local `requireActor()`; import from `authorization.js`.
- In `authorizeTransition()`:
  - `open → acknowledged`: replace the inline `role !== "EXPERT"` check
    with `requireRole(actorContext, "EXPERT")`. **Not present in the
    original investigation report's inventory (§1) or this plan's first
    draft — found only while implementing (3 EXPERT checks in this file,
    not 2). Corrected here retroactively; see the implementation
    handoff for the full note.**
  - `resolved → verified`: same replacement.
  - `resolved → in_progress`: same replacement.
  - `acknowledged → in_progress`/`in_progress → resolved`: **untouched**
    — these throw `AUTHORIZATION_POLICY_UNRESOLVED` unconditionally,
    never reach a role check, and this plan does not touch that logic
    (AUTH-L5).

### `server/src/services/knowledge.service.js`
- Delete local `requireActor()`; import from `authorization.js`.
- `approve()`: replace the `role !== "EXPERT"` check with
  `requireRole(actorContext, "EXPERT")`.
- `reject()`: same replacement.
- Ownership checks in `submitForReview()`/`revise()`
  (`String(knowledge.author) !== String(actorContext.id)`) are **left
  exactly as-is, inline** — AUTH-L3 explicitly rejects a generic
  `requireOwner()`, and this plan does not introduce even a
  Knowledge-local ownership helper (the decision report flagged that
  as only "plausible if a third instance appears," not decided now).

### `server/src/services/comment.service.js`
- Delete local `requireActor()`; import from `authorization.js`.
- No role checks exist in this file — nothing else changes.

### `server/src/services/project.service.js`
- Delete local `requireActor()`; import from `authorization.js`.
- No role checks exist in this file — nothing else changes.

### 2a. Canonical role-denial message (corrected — no per-call-site message parameter)

`requireRole(actorContext, role)` takes exactly two parameters, per
review. The 5 existing call sites (3 in `issue.service.js` —
`open→acknowledged`, `resolved→verified`, `resolved→in_progress` — plus
`approve`/`reject` in `knowledge.service.js`) currently throw 5 slightly
different English sentences; this refactor **intentionally normalizes**
them to one canonical message, with the specific role/action recoverable
from structured `details`, not from parsing prose:

```
requireRole(actorContext, role)
  → throws forbidden("Forbidden: insufficient role privileges",
      { requiredRole: role, actualRole: actorContext.role })
```

This is a deliberate, small behavior normalization — the `FORBIDDEN`
code and the actor/role facts are unchanged; only the message string
changes. Any existing test asserting on one of the 5 old message
strings verbatim must be updated to assert on the canonical message
and/or the `details.requiredRole` field instead — that is expected,
not a regression, and is called out explicitly in §3.

## 3. Tests to add

**New file: `server/tests/authorization.service.test.js`** — direct
unit tests of the shared primitives in isolation, no DB required
(these two functions never touch Mongoose):

- `requireActor`: throws `UNAUTHORIZED` for `null`, `undefined`,
  `{}`, `{ id: null }`; does not throw for `{ id: "x", role: "USER" }`.
- `requireRole`: throws `FORBIDDEN` when role mismatches; does not
  throw when it matches; confirms the second parameter is a single
  string (no test exercises or expects array support, since none
  should exist).
- Confirms `requireRole`'s thrown error carries the canonical message
  ("Forbidden: insufficient role privileges") and `details.requiredRole`
  / `details.actualRole` — not a per-call-site sentence.

**Existing test files — checked in advance**: every existing FORBIDDEN
assertion in `issue.service.test.js` and `knowledge.service.test.js`
(confirmed by direct grep) asserts only `err.code ===
DomainErrorCode.FORBIDDEN` — none assert on the message string. The
canonical-message normalization in §2a therefore requires **no test
changes** in either file; flagging this only so it isn't assumed to be
a bigger diff than it is. `comment.service.test.js`,
`project.service.test.js`, and the full `auth.*.test.js` set need no
changes at all (no role checks exist in the first two; the auth files
don't touch these services). Re-run all of them regardless, to confirm
this expectation holds.

## 4. Verification commands

```bash
node --check server/src/services/authorization.js
node --check server/src/services/issue.service.js
node --check server/src/services/knowledge.service.js
node --check server/src/services/comment.service.js
node --check server/src/services/project.service.js
node --check server/tests/authorization.service.test.js

npm run verify:models        # expect unchanged: 44/44
npm run verify:validation    # expect unchanged: 63/63
npm run verify:cookie-config # expect unchanged: 10/10 (unaffected by this work)

npm test                     # expect: previous 127 + new authorization.service.test.js
                              # cases, 0 failures, 0 regressions. Exact new total
                              # to be reported after the test file is written —
                              # not pre-committed to a specific number here to
                              # avoid the same off-by-one mistake made during
                              # Phase H.
```

Same discipline as every prior milestone: Claude's own sandbox can run
`node --check` and offline verify scripts but not `npm test` against
real MongoDB — the developer's real local run is the one that counts.

## 5. Explicit out-of-scope boundaries (restated from AUTH-L1–L5, binding for implementation)

- No generic `requireOwner()` — Knowledge's 2 ownership checks stay
  inline, unchanged.
- No multi-role or role-set support in `requireRole()` — single string
  only, ever.
- No new ADMIN-gated operation.
- No edit or delete operation on any entity.
- No Project membership/join/assignment logic.
- No change to `AUTHORIZATION_POLICY_UNRESOLVED` or the two D-3a-gated
  transitions in `issue.service.js` — not read, not modified, not
  even reformatted incidentally while editing nearby code.
- No new `DomainErrorCode` values — `requireActor`/`requireRole` reuse
  `UNAUTHORIZED`/`FORBIDDEN`, already defined.
- No change to `server/app.js`, routes, or middleware — this is a
  service-layer-only refactor, consistent with the actorContext
  boundary Authentication was built to respect.

---

Stopping here for review, per instruction. No files under `server/src`
or `server/tests` have been created or modified yet.
