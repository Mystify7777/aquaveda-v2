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
- optional category
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
