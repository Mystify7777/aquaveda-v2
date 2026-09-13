# Issue #48 — backend public read contracts: implementation notes

**Status: implemented, pending real-MongoDB test confirmation.** This
document records the concrete contracts produced, since #48 explicitly
asked for them to be documented, not just implemented.

---

## Locked decision

`docs/architecture/decision-register.md` §"Locked — Routes", ROUTE-L2
amendment. Summary: 8 new public GET routes, no `requireActor`/
`requireRole` anywhere in them (genuinely anonymous-accessible, not
merely unenforced), Knowledge reads hard-coded to `approved` only,
actor references populated with `{_id, name, role}` only.

---

## Endpoints

### `GET /api/v1/issues`

Query: `?status=<one of the 5 Issue statuses>&page=<int>&limit=<int, max 50>`
(all optional; `page` defaults to 1, `limit` defaults to 20).

```json
{
  "success": true,
  "data": {
    "items": [ /* Issue documents, reportedBy populated to {_id,name,role} */ ],
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  },
  "message": "Issues retrieved"
}
```

Sort: `createdAt` descending (newest first). No geospatial (`$near`)
query yet — not requested by #48 or the frontend plan; the `2dsphere`
index on `location` already exists for when it is.

### `GET /api/v1/issues/:issueId`

Returns a single Issue (same population as above). `404 NOT_FOUND` for
a well-formed but nonexistent id; `400 VALIDATION_FAILED` for a
malformed one (CastError translation, same pattern as every write
route).

### `GET /api/v1/knowledge`

Query: `?page=<int>&limit=<int, max 50>`. **No `status` parameter
exists at all** — the service layer unconditionally filters to
`status: "approved"`; there is no code path that can return anything
else, regardless of what a caller requests. No `region` filter either
(not requested, not indexed — would be an invented feature).

Same envelope shape as Issues, `author` populated to `{_id,name,role}`.

### `GET /api/v1/knowledge/:knowledgeId`

Returns a single **approved** Knowledge article. `404 NOT_FOUND` — not
`403 FORBIDDEN` — for a real article that exists but isn't approved,
and for one that doesn't exist at all. These two cases are
deliberately indistinguishable to the caller: revealing "exists but
you can't see it" would confirm a specific draft/pending_review/
rejected article's existence to an anonymous prober.

### `GET /api/v1/projects`

Query: `?originIssue=<ObjectId>&page=<int>&limit=<int, max 50>`. No
status filter — Project has no status/lifecycle field at all.
`originIssue` is a real, indexed access pattern (an Issue detail page
listing its related Projects).

`creator` and `contributors` both populated to `{_id,name,role}`.

### `GET /api/v1/projects/:projectId`

Single Project, same population. `404`/`400` same pattern as Issue
detail.

### `GET /api/v1/comments`

Query: `?refType=ISSUE|WIKI&refId=<ObjectId>` (both required). **Query
params, not a path segment** — matches the locked v1 precedent already
cited in `Comment.js`'s own schema comment.

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "refType": "ISSUE",
      "refId": "...",
      "author": { "_id": "...", "name": "...", "role": "USER" },
      "body": "...",
      "parentComment": null,
      "createdAt": "...",
      "replies": [
        { "_id": "...", "parentComment": "<parent's _id>", "...": "..." }
      ]
    }
  ],
  "message": "Comment thread retrieved"
}
```

Top-level comments only at the array root, ordered oldest-first; each
carries its (at most one level of, per D-COMMENT-1) replies nested
under `replies`, also oldest-first. `404 TARGET_NOT_FOUND` if `refId`
doesn't resolve to a real Issue/Knowledge document — reuses
`targetExists()`, the same check `createComment` already performs, so
read and write agree on what counts as a valid target.

No pagination on threads — a fixed `MAX_THREAD_COMMENTS = 500` safety
bound exists in the service layer, not exposed as a caller-controlled
parameter; nothing in the current product plan calls for paging within
a single thread.

---

## Cross-cutting decisions

- **Every one of the 8 routes is genuinely public** — no
  `requireActor`/`requireRole` call anywhere in any of them. This
  matters as a distinct fact from "nobody happened to add an auth
  check" — it's the deliberate mechanism behind the public-read
  boundary.
- **Actor population is uniform**: `{_id, name, role}`, never email or
  `passwordHash`, across all 4 read surfaces (`reportedBy`, `author`,
  `creator`, `contributors`). No approved policy permits exposing a
  contributor's email to an anonymous visitor.
- **Pagination**: one shared Zod primitive
  (`server/src/validation/shared/pagination.js`), `page`/`limit`,
  `limit` capped at 50 — a V2-scale placeholder, not derived from any
  approved capacity document, kept deliberately small since nothing in
  the current product plan needs large pages.
- **D-3a untouched**: none of these 8 functions read, write, or reason
  about Issue status authority.
- **No new error codes**: `VALIDATION_FAILED`/`NOT_FOUND`/
  `TARGET_NOT_FOUND`/`INVALID_STATE` (for an unrecognized `?status=`/
  `?refType=`) are all pre-existing, reused as-is.

## Testing

Both service-layer (`*.service.test.js`, direct function calls) and
route-layer (`*.routes.test.js`, real HTTP against a locally-mounted
Express app) tests were added for all 8 endpoints — success, filtering,
pagination boundaries, 404/400 paths, and (for Knowledge/Comment/
Project) the actor-population privacy assertions (`email`/
`passwordHash` confirmed `undefined` on the returned shape, using a
real `User.create()` fixture rather than the synthetic `fakeActor()`
helper, since `fakeActor()` doesn't correspond to a real document for
`.populate()` to resolve).

No `mongod` is available in the sandbox this implementation was done
in — every test was confirmed via `node --check` (syntax) and, for the
one file checked in isolation, confirmed the only failures are
`cancelledByParent` (the standard cascading failure when
`TEST_MONGO_URI` isn't set), not real logic failures. **A real
`npm test` run against actual MongoDB is required to confirm pass
counts** — same discipline as every prior milestone in this project.
