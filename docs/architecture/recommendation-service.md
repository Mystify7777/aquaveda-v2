# Recommendation Service

The backend recommendation foundation is the request-time
`getRecommendationsForIssue(issueId)` service in
`server/src/services/recommendation.service.js`. It reads the Issue's
persisted `category` and `severity`, applies a fixed ordered rule set, and
returns a snapshot. The service is exposed through the public HTTP read route
`GET /api/v1/issues/:issueId/recommendations`.

## HTTP contract

The `issueId` path parameter must be a valid MongoDB Issue identifier. A
malformed identifier returns HTTP `400` with the standard failure envelope and
`code: "VALIDATION_FAILED"`. A well-formed identifier for a missing Issue
returns HTTP `404` with `code: "NOT_FOUND"`.

This is an anonymous/public read, matching `GET /api/v1/issues/:issueId`.
It does not require an access cookie, role, ownership check, or other
authorization decision.

Successful responses use the canonical envelope:

```json
{
  "success": true,
  "data": {
    "issueId": "507f1f77bcf86cd799439011",
    "contextStatus": "classified",
    "recommendations": [
      {
        "id": "leakage-wastage",
        "suggestion": "Inspect the reported area for the source of the leak, and arrange a repair or shutoff as soon as it is safe.",
        "reason": "The Issue is classified as \"leakage_wastage\", which indicates visible leaking, overflowing, or wasted water."
      }
    ]
  },
  "message": "Recommendations retrieved"
}
```

Unexpected service failures use the existing generic HTTP `500` behavior;
internal or database details are not exposed. Each recommendation always
includes a stable `id`, actionable `suggestion`, and context-grounded
`reason`.

Failures use the canonical envelope:

```json
{
  "success": false,
  "data": null,
  "message": "Issue 507f1f77bcf86cd799439011 not found",
  "code": "NOT_FOUND"
}
```

The `code` is `VALIDATION_FAILED` for malformed IDs, `NOT_FOUND` for missing
Issues, and unexpected failures use the generic `500` message without a
service or database error detail.

## Supported use case

The service provides short, actionable water-conservation or safety guidance
for an individual Issue. Each returned recommendation contains:

- `suggestion`: an action the reader can take;
- `reason`: an explanation grounded in the Issue's canonical classification;
- `id`: a stable rule identifier for consumers and tests.

Category rules cover `leakage_wastage`, `supply_shortage`,
`water_quality`, `flooding_drainage`, and `damaged_infrastructure`.
High and critical severity add an escalation rule. The `other` category is
intentionally supported as a valid classification but has no category rule.

## Context and failure behavior

- An existing Issue with both `category` and `severity` unclassified (`""`)
  returns `contextStatus: "insufficient_context"` and no recommendations
  through the HTTP `data` object.
- A valid classification for which no rule matches returns
  `contextStatus: "classified"` and an empty recommendation list. The service
  does not infer facts from free-text title or description. These two states
  remain distinct in the API contract.
- A well-formed but missing Issue ID throws `NOT_FOUND`.
- A malformed Issue ID throws `VALIDATION_FAILED`, following the existing
  service error contract.

## Boundary and limitations

Recommendations are derived at request time and are not persisted data. The
endpoint does not mutate Issues or Knowledge, perform moderation, establish
verification, make authorization decisions, or call external providers.
Recommendations are guidance only, not verified Knowledge, and must not
mutate or override approved Knowledge.

Rules are local data in `recommendation.service.js`. To add a rule, add one
entry to the ordered `RULES` list with a stable `id`, a classification
predicate, an actionable `suggestion`, and a context-grounded `reason`.
This changes guidance only; it does not change Issue domain authority,
lifecycle, persistence, or authentication policy.
