# Community Activity

Status: Implemented in #166 against ADR-0009.

## Purpose

Community Activity is a derived read model over canonical conversation owners:

- DISCUSSION
- ISSUE
- KNOWLEDGE

It is computed at request time. No Activity collection, event bus, or
synchronization worker is introduced.

## Public API

GET /api/v1/community/activity?page=1&limit=20

The endpoint is anonymous-accessible and uses the standard V2 response envelope.

The payload is:

    {
      items: CommunityActivityItem[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }

Each item contains:

- id: deterministic <type-lowercase>:<resourceId>
- type: DISCUSSION | ISSUE | KNOWLEDGE
- activityAt: latest public comment timestamp, or Discussion createdAt
  when there are no comments
- title
- category: string | null (always present; null when the source has none —
  Knowledge and Issues without a category)
- commentCount
- resource: { type, id }
- author: { _id, name, role } | null

## Source visibility

The projection applies source visibility before activity calculation:

- Discussions: ACTIVE only.
- Knowledge: approved only.
- Issues: existing public Issue visibility is unchanged.

Issue and Knowledge items exist only when at least one public Comment exists.
Discussion items exist even without comments so a newly created Discussion is
discoverable immediately.

For Knowledge, Comment's canonical target discriminator remains WIKI; the
Activity public source type is KNOWLEDGE.

## Ordering and pagination

The internal total-order comparator is:

    activityAt DESC, sourceType ASC, resourceObjectId DESC

The public id is not the pagination tie-breaker.

The implementation performs the three-source merge, comment counting, latest
comment selection, ordering, pagination, and total-count calculation inside
MongoDB aggregation. The application does not load the eligible source
population into memory or issue one query per Activity item.

Pagination uses the established V2 bounds: page >= 1 and 1 <= limit <= 50,
default limit 20.

## Data access and scaling characteristics

Verified against a real MongoDB (see `server/tests/community-activity.hardening.test.js`):

- One database operation per request (`discussions.aggregate`), independent of
  source population size; no per-item queries (no N+1).
- Application memory is bounded by `limit` (<= 50 rows returned); the eligible
  population is never materialized in the application.
- Comment stats are `$sum` / `$max` per target (no per-target sort). Every
  comment lookup is index-backed (`refType_1_refId_1`, zero collection scans,
  confirmed via `explain("executionStats")`).
- The global `$sort` runs over one small projected row per eligible source
  document and is the only stage whose working set grows with the data. The
  aggregation sets `allowDiskUse: true` so that stage can spill instead of
  failing when it exceeds the in-memory sort limit.

Known limitation (accepted, not a contract violation): the projection is
derived at request time, so each request is O(eligible source documents)
**database-side** work (all ACTIVE Discussions, all Issues, all approved
Knowledge are scanned to compute activity). This is bounded for the
application and correct, but not free at large scale. A materialized or cached
read-optimized projection is a possible future option; it is a separate
architecture decision (ADR-0009 §11 currently forbids it for MVP) and is not
introduced here.

## Privacy

Actor hydration is batched inside the same aggregation and is explicitly
allowlisted to _id, name, and role. No email, password hash, workflow,
remediation, review, report, or moderation fields are projected.

A hidden Discussion therefore cannot leak title, body, comment count,
activity timestamp, author, existence, or moderation state through Activity.

## Non-goals

- persisted Activity state
- real-time updates
- notifications
- trending/ranking
- likes/reactions/follows/reputation
- frontend implementation
