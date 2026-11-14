# Community Discussion API

Status: Implemented in #164 against ADR-0009.

This document records the concrete HTTP contract for the first-class Discussion
resource. It does not define Community Activity; that remains #166.

## GET /api/v1/discussions

Anonymous-accessible public list.

Query:

- page: positive integer, default 1
- limit: positive integer, default 20, maximum 50

Only ACTIVE Discussions are returned.

Ordering:

createdAt DESC, _id DESC

Response data:

    {
      items: PublicDiscussion[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }

An empty public result is successful with items: [], total: 0, and totalPages: 0.

## GET /api/v1/discussions/:discussionId

Anonymous-accessible public detail.

- malformed id -> VALIDATION_FAILED (400)
- nonexistent id -> NOT_FOUND (404)
- hidden id -> the same NOT_FOUND (404) boundary

A hidden Discussion is therefore not distinguishable from a nonexistent public
Discussion.

## POST /api/v1/discussions

Authenticated creation.

Request:

    {
      title: string;
      body: string;
      category: "QUESTION" | "DISCUSSION" | "IDEA";
    }

The server owns author, status, createdAt, and updatedAt. Client-supplied
values for those fields are not accepted as domain input.

Anonymous creation -> UNAUTHORIZED (401).

Invalid request shape -> VALIDATION_FAILED (400).

## Public DTO

    interface PublicDiscussion {
      _id: string;
      title: string;
      body: string;
      category: "QUESTION" | "DISCUSSION" | "IDEA";
      status: "ACTIVE";
      author: {
        _id: string;
        name: string;
        role: "USER" | "EXPERT" | "ADMIN";
      } | null;
      createdAt: string;
      updatedAt: string;
    }

No email, password hash, moderation internals, report records, or other
storage fields are public.

## Non-goals

- Discussion edits/deletion
- Discussion moderation/reporting implementation (#167)
- Discussion comments (#165)
- Community Activity (#166)
- social-network features
