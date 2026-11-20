# Engineering Standards

One file. Coding standards, commit conventions, branching, and Definition
of Done all live here — because nobody remembers which of five files a rule
lives in.

---

## Frontend contribution path

For frontend issue work, use [`frontend-contributing.md`](./frontend-contributing.md) as the concise navigation path through product invariants, architecture decisions, Next.js patterns, testing, and PR expectations. This file remains the canonical home for engineering standards and Definition of Done.

---

## Coding standards

- **TypeScript, strictly.** `strict: true` in tsconfig. No `any`, no
  unchecked casts papering over a shape mismatch.
- **Server Components by default.** Add `"use client"` only where the code
  actually needs browser APIs, React state, or event handlers — then push
  that boundary as deep in the tree as possible.
- **Small, focused files.** A component earns its own file once it has its
  own reason to change. Composition over inheritance.
- **No prop drilling past two levels.** Colocate state or use context.
- **Comments explain _why_, not _what_.** The code says what it does.
  A comment earns its place by carrying reasoning the code cannot.
- **No `console.log` in committed code.** `console.error` is acceptable in
  error boundaries and genuinely exceptional paths.

---

## Dependency policy

A dependency is added in the same commit as the first file that imports it.
`package.json` reflects what's actually built, not what's planned.

---

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary

feat(explore): add severity filter chip
fix(auth): normalize email before login lookup
docs(adr): record ADR-0002 Express decision
```

Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci`
`chore` `revert`

---

## Branching

`main` is always deployable. Feature work happens on
`type/short-description` branches merged via PR once the build passes.

---

## Definition of Done

A feature is done when it is:

- [ ] **Functional** — happy path and realistic failure paths both work
- [ ] **Responsive** — usable at 375px, no horizontal scroll
- [ ] **Accessible** — keyboard-operable, visible focus, ARIA where needed
- [ ] **Typed** — no `any`, no unchecked casts
- [ ] **Tested** — non-trivial logic has a unit test; user flows get e2e
      coverage once a testing framework is added (next milestone)
- [ ] **Self-reviewed** — product questions answered before it's "done":
  - Would a real user understand this without explanation?
  - Does the interaction feel obvious?
  - Is this solving a real problem?
  - Could it be simpler?
- [ ] **Documented** — CLAUDE.md updated; ADR added if a durable
      architectural decision was made
- [ ] **No TODOs for core functionality** — deferred enhancements are fine;
      TODOs standing in for missing required behavior are not "done"
