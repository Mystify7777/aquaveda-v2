# Recommendation Service

The backend recommendation foundation is the request-time
`getRecommendationsForIssue(issueId)` service in
`server/src/services/recommendation.service.js`. It reads the Issue's
persisted `category` and `severity`, applies a fixed ordered rule set, and
returns a snapshot. It has no HTTP route yet; the future API and UI surfaces
are follow-up work.

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
  returns `contextStatus: "insufficient_context"` and no recommendations.
- A valid classification for which no rule matches returns
  `contextStatus: "classified"` and an empty recommendation list. The
  service does not infer facts from free-text title or description.
- A well-formed but missing Issue ID throws `NOT_FOUND`.
- A malformed Issue ID throws `VALIDATION_FAILED`, following the existing
  service error contract.

## Boundary and limitations

Recommendations are derived output, not persisted data. The service does not
mutate Issues or Knowledge, perform moderation, establish verification,
make authorization decisions, or call external providers. Guidance is not
verified Knowledge and must not override expert-reviewed content.

Rules are local data in `recommendation.service.js`. To add a rule, add one
entry to the ordered `RULES` list with a stable `id`, a classification
predicate, an actionable `suggestion`, and a context-grounded `reason`.
This changes guidance only; it does not change Issue domain authority,
lifecycle, persistence, or authentication policy.
