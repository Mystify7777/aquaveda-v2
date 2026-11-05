# Dashboard backend read contract (#53)

Consumed by the Dashboard frontend (#54). Everything is computed server-side; the browser performs no cross-domain aggregation.

## Provenance of this contract

**No approved metric list existed in the repository.** The evidence found was only: Dashboard data stays "fully derived via aggregation, no persistence" (decision register); the F4 plan names "role/issue/project aggregation views"; the persistence design mentions a user-specific "my reported Issues" view; the `(protected)` layout names Dashboard as an authenticated page. The contract below is bounded to that evidence plus the explicit product decisions recorded in DSH-L1..L6. It is not a derived product requirement: any metric not listed here is not approved. In particular, **counts of users by role were deliberately left out** (no approved source authorizes exposing them).

## Endpoint

`GET /api/v1/dashboard`

- **Authentication:** an authenticated session (the existing access-token cookie). Any role; there are no role variants and no new permission. Anonymous callers get `401 UNAUTHORIZED`.
- **Caching:** `Cache-Control: private, no-store` (the response is per user).
- **Parameters:** none. The caller is always the session's actor; query or body parameters cannot select another user.
- **Envelope:** the shared one. Success `{ success: true, data, message: "Dashboard retrieved" }`. Failure `{ success: false, data: null, message, code }` (`UNAUTHORIZED`, or the generic 500).
- **Methods:** `GET` only.

## Response `data`

```text
{
  platform: {
    issues:    { total, byStatus: { open, acknowledged, in_progress, resolved, verified } },
    knowledge: { approved },
    projects:  { total }
  },
  mine: {
    issuesReported: { total, byStatus: { open, acknowledged, in_progress, resolved, verified } },
    knowledge:      { total, byStatus: { draft, pending_review, approved, rejected } },
    projects:       { created, contributing }
  }
}
```

Every field is a non-negative integer and is always present; an empty dataset yields zeros, never `null` or a missing key. There are no ids, documents, timestamps or Mongoose metadata.

## Metric definitions

| Field | Definition |
|---|---|
| `platform.issues.byStatus.<s>` | Issues currently in status `s`, all reporters. |
| `platform.issues.total` | Sum of `byStatus`. A record whose status is outside the five documented values is ignored, so `total` always equals the sum. |
| `platform.knowledge.approved` | Knowledge articles with status `approved` (the publicly readable set). |
| `platform.projects.total` | All Projects (Project has no status in V2). |
| `mine.issuesReported.*` | Same as `platform.issues`, restricted to Issues whose `reportedBy` is the caller. |
| `mine.knowledge.*` | Knowledge articles whose `author` is the caller, by status (`total` = sum of `byStatus`). |
| `mine.projects.created` | Projects whose `creator` is the caller. |
| `mine.projects.contributing` | Projects where the caller is listed in `contributors` and is **not** the creator. Disjoint from `created`: a project is counted once, under the role the caller holds in it; a repeated entry in `contributors` does not double count. |

## Authorization semantics

- `platform` contains only aggregates of data that is already publicly readable (the Issue list, approved Knowledge, the Project list). It reveals nothing about any individual.
- `mine` is scoped strictly to the session's actor. It is a read of the caller's own records; it confers and implies no authority (no role, reporter, creator or contributor status is treated as permission to do anything). D-3a is untouched.
- The `platform` block is limited to `issues`, `knowledge` and `projects`. It must not grow into users-by-role, activity, trends, remediation, recommendations, comments, leaderboards or recent activity without a new explicit decision.

## Implementation

`server/src/services/dashboard.service.js` (`getDashboard(actorContext)`), `server/src/routes/dashboard.routes.js`. Seven read queries run in parallel (`Issue.aggregate` ×2, `Knowledge.aggregate`, and `countDocuments` for approved Knowledge and three Project counts). The query count is not part of the contract. No collection, model or index was added.

## Failure behavior

- Anonymous, invalid, expired or tampered session: `401 UNAUTHORIZED`.
- A session whose actor id is not a valid identifier: `401 UNAUTHORIZED`.
- Any unexpected error: the shared generic 500, with no detail.

## Performance note and revisit trigger

The Project `creator` / `contributors` counts scan the collection (no index; the persistence design deliberately defers them). Acceptable at current volume. Revisit when profiling shows Dashboard latency attributable to these queries, or when the Project collection is large enough for that to matter; then add the indexes as a performance change with evidence, not speculatively.

## Relationship to #54

#54 renders this response as-is. Field names and semantics above are the contract; changing a field, adding a metric or exposing another user's data requires a new decision recorded in the decision register.
