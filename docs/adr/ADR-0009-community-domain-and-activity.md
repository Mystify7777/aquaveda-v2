# ADR-0009: Community Discussions and Activity projection (resolves #163)

## Status

Accepted (2026-11-14) as the architecture/domain contract for the Community
milestone. Resolves the domain and projection decisions required before
Issues #164–#167 implementation.

This ADR introduces the first-class Discussion resource and defines Community
Activity as a derived read model. It does not implement either resource, add
routes, or change the existing Issue, Knowledge, or Comment implementations.

## Context

Community has two distinct responsibilities:

1. **Discussions** — first-class conversations initiated directly by users.
2. **Activity** — a discovery projection over conversation activity from
   Discussions, Issues, and Knowledge.

Community is not a generic post/forum model. Issues and Knowledge remain the
canonical owners of their existing conversations.

The existing Comment primitive is target-bound:

`Comment(refType, refId)`

with the current target vocabulary `ISSUE | WIKI`, and one-level replies.
Issue #165 is explicitly responsible for determining whether `DISCUSSION`
can be added without weakening those invariants.

The backend already uses offset pagination with `page`/`limit`, a maximum
limit of 50, and deterministic `createdAt DESC, _id DESC` ordering for public
lists. Community should use the same pagination model rather than introducing
a cursor framework solely for this feature.

## Decision

### 1. Discussion is a first-class domain resource

A Discussion is an independently addressable document.

Conceptual shape:

```text
Discussion
├── _id
├── title
├── body
├── category
├── status
├── author
├── createdAt
└── updatedAt
```

MVP categories are exactly:

- `QUESTION`
- `DISCUSSION`
- `IDEA`

The category is classification, not workflow authority.

### 2. Discussion lifecycle and visibility

The MVP lifecycle is intentionally small:

- `ACTIVE` — publicly discoverable and publicly readable.
- `HIDDEN` — not publicly discoverable or readable.

`HIDDEN` is a moderation visibility state, not a social "deleted" state.

There is no `DELETED`, `ARCHIVED`, `LOCKED`, `CLOSED`, or reputation
state in this ADR.

Public list/detail reads expose only `ACTIVE` Discussions. A hidden Discussion
must not be distinguishable from a nonexistent Discussion through anonymous
public reads.

The status is server-owned. Clients never supply or mutate it through the
ordinary Discussion creation contract.

### 3. Ownership and authorization

The Discussion author is the authenticated actor who creates it.

Creation:

- anonymous: rejected;
- authenticated USER/EXPERT/ADMIN: allowed, subject to normal validation and
  any future moderation restrictions explicitly introduced by #167.

The frontend may hide the creation UI from anonymous users, but that is not an
authorization boundary. The backend service remains authoritative.

Discussion ownership does not grant any unrelated platform authority. In
particular, author identity does not imply Issue, Knowledge, moderation, or
Expert authority.

### 4. Public Discussion DTO

The public Discussion projection is an explicit allowlist:

```ts
interface PublicDiscussion {
  _id: string;
  title: string;
  body: string;
  category: "QUESTION" | "DISCUSSION" | "IDEA";
  status: "ACTIVE";
  author: PublicActor;
  createdAt: string;
  updatedAt: string;
}
```

`PublicActor` remains the existing public identity shape:

```ts
{ _id: string; name: string; role: "USER" | "EXPERT" | "ADMIN" }
```

No email, password hash, moderation internals, report records, or other
storage fields are public.

The list endpoint uses the same public DTO unless a later contract explicitly
defines a summary projection. No second, speculative list shape is invented
here.

### 5. Discussion API contract

The initial API surface is:

```http
GET  /api/v1/discussions
GET  /api/v1/discussions/:discussionId
POST /api/v1/discussions
```

Exact route implementation belongs to #164, but the following semantics are
locked:

- GET list is anonymous-accessible and returns only public Discussions.
- GET detail is anonymous-accessible for public Discussions.
- POST requires an authenticated actor.
- Invalid request shape is a validation failure.
- A malformed Discussion id is a validation failure.
- A nonexistent or hidden Discussion is not distinguishable through the public
  detail boundary.
- Responses use the existing `ApiResponse<T>` envelope.
- List pagination uses `page` and `limit`, with the shared V2 bounds.
- List ordering is `createdAt DESC, _id DESC`.

Creation accepts only:

```ts
{
  title: string;
  body: string;
  category: "QUESTION" | "DISCUSSION" | "IDEA";
}
```

Clients do not submit `author`, `status`, `createdAt`, `updatedAt`, or
moderation fields.

This ADR does not define edit/delete routes. `updatedAt` remains a persistence
timestamp for future domain changes, but no MVP mutation is implied by its
presence.

### 6. Comment compatibility

The existing Comment primitive remains the canonical conversation primitive.

Current locked invariants are preserved:

- `refType` identifies the target domain;
- `refId` identifies the target document;
- a reply must use the exact same `(refType, refId)` pair as its parent;
- a reply cannot itself receive a reply;
- the existing ISSUE/WIKI behavior must remain unchanged.

Issue #165 is the implementation gate for extending the target vocabulary to
`DISCUSSION`.

The preferred result is:

```text
Comment
├── ISSUE
├── WIKI
└── DISCUSSION
```

using the existing `(refType, refId)` access pattern and compound index.

A separate DiscussionComment collection is rejected unless #165 demonstrates
a concrete invariant, authorization, lifecycle, or query-performance reason
that makes shared Comment unsafe.

No Discussion-comment route or persistence change is implemented by this ADR.

### 7. Community Activity is a derived projection

Community Activity is **not** a persisted domain entity and is not a second
source of truth.

A single Activity item represents the latest public conversation activity for
one canonical resource.

The three source types are:

- `DISCUSSION`
- `ISSUE`
- `KNOWLEDGE`

Canonical ownership remains:

```text
Discussion → Discussion + its Comments
Issue      → Issue + its Comments
Knowledge  → Knowledge + its Comments
```

Community only projects those sources into a common discovery shape.

### 8. Activity semantics

The activity timestamp is defined as follows.

**Discussion**

- If the Discussion has public comments, `activityAt` is the timestamp of
  the latest public comment.
- If it has no comments, `activityAt` is `createdAt`.

This makes a newly created Discussion discoverable immediately while allowing
subsequent conversation to move it upward in the feed.

**Issue / Knowledge**

- An Activity item exists only when the canonical resource has at least one
  publicly readable Comment.
- `activityAt` is the timestamp of the latest publicly readable Comment.

This prevents an Issue or Knowledge article with no conversation from being
misrepresented as "conversation activity."

For Knowledge, the existing public-read rule remains authoritative: only
approved Knowledge content contributes public Community Activity.

### 9. Activity DTO

The unified projection has this conceptual shape:

```ts
interface CommunityActivityItem {
  id: string;
  type: "DISCUSSION" | "ISSUE" | "KNOWLEDGE";
  activityAt: string;
  title: string;
  category?: string;
  commentCount: number;
  resource: {
    type: "DISCUSSION" | "ISSUE" | "KNOWLEDGE";
    id: string;
  };
  author: PublicActor | null;
}
```

Rules:

- `id` is a deterministic projection identity, not a new persisted id.
  It uses the form `<type-lowercase>:<resourceId>`. The public id is not
  used as the internal pagination tie-breaker.
- `resource.type + resource.id` is the canonical destination identity.
- The frontend owns presentation and route construction from the established
  resource route contract; the backend does not invent arbitrary UI URLs.
- `commentCount` counts only comments that are publicly readable under the
  target's visibility rules.
- `author` is the Discussion author for Discussions and the canonical
  resource author/reporter for Issue/Knowledge where the existing public DTO
  has such an actor. It may be null when the source has no public actor.
- No private workflow/remediation/review/reporting fields are projected.

The Activity item is intentionally a summary. Full Discussion, Issue, Knowledge,
and Comment representations remain owned by their existing endpoints.

### 10. Activity ordering and pagination

The canonical ordering is:

```text
activityAt DESC
sourceType ASC
resourceObjectId DESC
```

This is the internal total-order comparator used for pagination. `sourceType`
uses the canonical source vocabulary (`DISCUSSION`, `ISSUE`, `KNOWLEDGE`).
`resourceObjectId` is the underlying MongoDB ObjectId, compared as an ObjectId,
not as part of the public projection string. Equal timestamps therefore remain
deterministically ordered without relying on lexicographical ordering of the
public `id`.

The public projection `id` remains a deterministic identity in the form
`<type-lowercase>:<resourceId>`. It is not the pagination sort key. Every page
boundary must use the same internal comparator as the total-count/source-set
calculation.

Pagination is ordinary V2 offset pagination:

```text
?page=1&limit=20
```

The response uses the existing envelope:

```ts
{
  items: CommunityActivityItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

No cursor token is introduced for MVP.

The implementation must calculate the same public source set for `items` and
`total`. It must not fetch an arbitrary fixed number from each source and
silently truncate the merged result, because that would make page boundaries
incorrect as source proportions change.

### 11. Projection implementation strategy

The Activity read model remains derived at request time for MVP.

Implementation may use MongoDB aggregation or coordinated source queries, but
the contract requires:

1. public visibility filtering before projection;
2. latest-comment selection per canonical target;
3. comment-count calculation from the same public target set;
4. deterministic merge/order;
5. bounded pagination;
6. batched actor/target hydration;
7. no per-item request-time database query loop.

The implementation must explicitly test for N+1 behavior. A loop that performs
one target/comment/actor query per feed item is not an acceptable implementation
of this contract.

The implementation must also avoid loading the full eligible source population
into application memory. Pagination and total-count calculation must use
bounded database-side aggregation or another demonstrably bounded strategy.
An implementation that materializes all eligible Discussions, Issues, or
Knowledge resources merely to merge, sort, or count the feed is not acceptable.

No materialized Activity collection, background projector, event bus, or
real-time update mechanism is introduced in MVP.

### 12. Required persistence indexes

Discussion must have indexes supporting its established access patterns:

- public status + creation ordering:
  `{ status: 1, createdAt: -1, _id: -1 }`
- an author-oriented index is **conditional**, not required by this ADR. If
  #164 establishes a real author-specific query such as a future
  `GET /api/v1/discussions/mine`, it may add the smallest evidence-backed
  index at that point. No speculative author index is required by MVP.

The existing Comment index:

```text
{ refType: 1, refId: 1 }
```

remains the primary target-thread access path.

If #165 demonstrates that the existing index is insufficient for the final
Discussion query shape, it may propose the smallest additional index with
evidence. Indexes are not added speculatively.

Issue and Knowledge indexes are unchanged by this ADR.

### 13. Error and empty behavior

Public list endpoints return a successful empty page when no public resources
match:

```text
items = []
total = 0
totalPages = 0
```

Malformed query values or ids are validation failures.

A hidden/nonexistent public Discussion resolves to the same public not-found
boundary. The API must not reveal that a hidden resource exists.

Backend errors continue through the existing shared response/error mapping.

### 14. Privacy and visibility boundary

Community Activity must never become a side channel for private content.

The following is a cross-endpoint invariant: when a Discussion is `HIDDEN`,
every anonymous public read path must treat it as unavailable. That includes
Discussion list/detail, Discussion-targeted Comment reads, and Community
Activity. No public endpoint may expose its title, body, comment count,
activity timestamp, author, existence, or moderation state. The same
hidden/nonexistent boundary applies to the Discussion detail route.

A resource is eligible only when its existing public-read contract permits it.

Therefore:

- hidden Discussions are excluded;
- non-approved Knowledge is excluded;
- Issue public visibility remains unchanged;
- private workflow/remediation data is excluded;
- Comment author identity follows the existing public Comment projection;
- report records and moderation internals are never projected.

The projection is allowed to reveal that a public resource has conversation
activity. It must not reveal private target existence or private workflow state.

## Consequences

### Positive

- Community becomes a real product surface rather than a decorative aggregation
  of existing pages.
- Independent user conversation has a proper domain owner.
- Existing Issue/Knowledge comment semantics remain intact.
- Activity remains a projection, avoiding duplicated lifecycle state.
- The existing V2 pagination and response conventions are reused.
- Discussion moderation can evolve without turning Comment into a moderation
  entity.

### Costs

- Community now requires a real Discussion model and API.
- Activity aggregation is more complex than reading one collection.
- Public visibility rules must be applied consistently across three source
  types.
- The Activity implementation needs explicit query-shape/N+1 testing.

## Rejected alternatives

### Generic Post model

Rejected. It collapses Discussion, Issue, Knowledge, and their ownership rules
into one artificial abstraction and makes domain authorization harder rather
than easier.

### Separate DiscussionComment collection

Rejected by default. It duplicates the existing Comment primitive and creates
parallel reply/authorization/indexing semantics. #165 may overturn this only
with concrete evidence.

### Persisted CommunityActivity collection

Rejected for MVP. Activity is derivable from canonical Discussion/Comment/
Issue/Knowledge data, and persisting it would introduce synchronization,
rebuild, and lifecycle consistency problems without a demonstrated need.

### Cursor pagination

Rejected for MVP. Existing public list contracts already use bounded offset
pagination, and Community has no demonstrated scale requirement that justifies
a second pagination model.

### One Activity row per comment

Rejected. Community is a discovery feed of conversations, not a raw comment
event stream. One row per canonical conversation keeps the feed readable and
preserves resource ownership.

## Implementation sequence

```text
#163  ADR-0009: domain + activity contract
  │
  ├── #164  Discussion persistence/service/routes/tests
  │
  ├── #165  Comment DISCUSSION investigation + safe extension
  │
  └── #167  Discussion visibility/reporting foundation
          │
          └──────────────┐
                         ↓
                   #166  Activity projection
                         │
                         ↓
                    #12  Community frontend
```

#164 and #165 may proceed in parallel after this ADR. #167 owns the concrete
reporting and moderation authorization/lifecycle contract and depends on the
Discussion visibility model from this ADR and the Discussion implementation
in #164. #166 requires finalized Discussion, Comment, and public-visibility
contracts; it does not need to wait for unrelated #167 work once those
contracts are settled. #12 starts its backend-dependent implementation slices
only after the API contracts are stable.

## Verification requirements for downstream issues

#164 must prove:

- public ACTIVE-only reads;
- authenticated creation;
- server-side authorization;
- deterministic pagination;
- explicit DTO redaction;
- index coverage.

#165 must prove:

- ISSUE/WIKI behavior remains passing;
- DISCUSSION target authorization is correct;
- cross-target replies remain rejected;
- reply-to-reply remains rejected;
- public visibility follows the target Discussion status.

#167 must define and prove:

- who may report a Discussion;
- duplicate-report and report-abuse controls;
- self-report behavior;
- who may hide/unhide a Discussion;
- whether authors may hide their own Discussions;
- what happens to existing comments when a Discussion becomes hidden;
- moderation authority and audit semantics;
- hidden Discussions disappear from every anonymous public read path,
  including Discussion detail, Comment threads, and Activity.

#166 must prove:

- all three source types appear correctly;
- latest public conversation activity determines ordering;
- comment counts agree with public visibility;
- pagination is deterministic;
- no private data leaks;
- N+1 behavior is absent.

## References

- Issue #12 — Design the Community Frontend Surface
- Issue #163 — Community architecture/contract
- Issue #164 — Independent Discussion domain
- Issue #165 — Comment polymorphism investigation
- Issue #166 — Community Activity projection
- Issue #167 — Discussion visibility/reporting foundation
- `server/src/models/Comment.js`
- `server/src/services/comment.service.js`
- `server/src/validation/shared/pagination.js`
- `docs/architecture/decision-register.md`
