# Knowledge Taxonomy V1

This document records the application-owned Category and Topic vocabulary
implemented for Issue #228 under ADR-0011. The executable source of truth is
`server/src/domain/knowledge-taxonomy.js`; this table is checked against it
by `server/tests/knowledge-taxonomy.test.js`.

## Category

Every Knowledge article has exactly one primary Category.

| Slug | Display name | Status |
|---|---|---|
| `water_conservation` | Water conservation | ACTIVE |
| `water_supply` | Water supply and distribution | ACTIVE |
| `water_quality` | Water quality and treatment | ACTIVE |
| `groundwater` | Groundwater | ACTIVE |
| `wastewater_sanitation` | Wastewater and sanitation | ACTIVE |
| `agriculture_irrigation` | Agriculture and irrigation | ACTIVE |
| `flood_drainage` | Flooding and drainage | ACTIVE |
| `water_governance` | Water governance | ACTIVE |
| `community_practice` | Community and field practice | ACTIVE |
| `other` | Other water knowledge | ACTIVE |

## Topic

An article may have zero or more Topic tags.

| Slug | Display name | Status |
|---|---|---|
| `water_reuse` | Water reuse | ACTIVE |
| `efficient_irrigation` | Efficient irrigation | ACTIVE |
| `rainwater_harvesting` | Rainwater harvesting | ACTIVE |
| `sustainable_water_management` | Sustainable water management | ACTIVE |
| `groundwater_recharge` | Groundwater recharge | ACTIVE |
| `water_quality_monitoring` | Water quality monitoring | ACTIVE |
| `water_treatment` | Water treatment | ACTIVE |
| `wastewater_reuse` | Wastewater reuse | ACTIVE |
| `sanitation` | Sanitation | ACTIVE |
| `stormwater_management` | Stormwater management | ACTIVE |
| `water_distribution_networks` | Water distribution networks | ACTIVE |
| `water_rights` | Water rights | ACTIVE |
| `community_water_management` | Community water management | ACTIVE |
| `drought_management` | Drought management | ACTIVE |

The Topic vocabulary intentionally omits `water_conservation` because it is
already a Category. The former `water_supply_distribution` Topic was
narrowed to `water_distribution_networks`, which identifies a concrete
infrastructure subject rather than duplicating the `water_supply` Category.
Water quality monitoring remains a Topic because it is a narrower activity
within the broader water-quality Category.

## Identity and lifecycle

- Slugs are stable machine identities and must never be renamed or reused.
- Display names may be corrected without changing the slug.
- ACTIVE terms can be assigned, filtered, exposed through taxonomy metadata,
  and used by related-Knowledge scoring.
- RETIRED terms remain resolvable through rendering lookups using their
  canonical display name, but cannot be assigned, exposed as selectable filter
  options, or used for related scoring.
- The V1 production retired registries are empty. A term is added there only
  when an actual persisted identity is retired; synthetic placeholders must
  not be added to the authoritative vocabulary.
- Lifecycle behavior is tested with isolated retired fixtures through
  `createKnowledgeTaxonomyResolver`, without adding those fixtures to the
  production registries.
- The module makes the distinction explicit:
  - `getCategory` / `getTopic`: resolve known ACTIVE or RETIRED IDs for rendering.
  - `getAssignableCategory` / `getAssignableTopic`: ACTIVE terms only.
  - `getActiveCategories` / `getActiveTopics`: selectable metadata/filter terms.
  - `getCategoryDisplayName` / `getTopicDisplayName`: canonical labels, including retired terms.
- A semantic replacement or merge requires an explicit idempotent migration
  for persisted references. A retired slug remains in its original kind's
  registry for rendering; it is never reassigned to a different meaning.
- Taxonomy is application-owned and source-controlled. There is no runtime
  mutation API or taxonomy collection in V1.

## Alias handling

Category and Topic aliases are separate source-controlled maps. Each alias
target is validated against its own kind's canonical registry by tests.
Aliases use NFKC normalization, trimming, Unicode whitespace collapsing, and
locale-insensitive lowercasing.

Resolvers accept strings only. Null, undefined, non-string, and blank values
return `null`. Unknown values are not fuzzy-matched and are not silently
accepted.

## Migration contract (#230)

Existing Knowledge records are backfilled by the migration script
`server/scripts/migrate-knowledge-taxonomy.js`.

- Category/Topic classification is deterministic and source-controlled in
  `server/src/domain/knowledge-migration.js`.
- Every legacy record receives a valid Category; records with no narrower
  signal use the canonical `other` Category rather than remaining
  unclassified.
- Topic assignment is zero-or-more and is derived from explicit content
  signals. No Topic is invented from geography.
- Existing valid Category/Topic values are never overwritten.
- Existing unknown/retired values are preserved and reported unless an exact
  reviewed persisted-reference rewrite is present.
- Persisted Category and Topic rewrites are explicit source-controlled maps in
  `server/src/domain/knowledge-migration.js`. Rewrite targets must be ACTIVE;
  active slugs cannot be rewrite sources; rewrite chains/cycles are rejected.
  Applying a rewrite twice is a no-op because the canonical target is no longer
  a rewrite source.
- Invalid taxonomy does not block unrelated missing fields. For example, a
  missing `regionKey` is still backfilled when Category/Topic needs review.
- Topic rewrites preserve unresolved identities and deduplicate the resulting
  canonical list. Unresolved values remain visible in the audit report and are
  not silently discarded.
- Region display text is never modified. `regionKey` is generated only when
  missing through the shared ADR-0011 normalization utility.
- Blank Region values are reported separately. Non-blank normalized Region
  keys remain distinct unless a reviewed explicit alias exists.
- The migration uses native MongoDB updates that set only the new metadata
  fields, so lifecycle state, author, timestamps, and review history are not
  touched.
- Apply updates are guarded by the values observed during the scan. If a
  record changes between scan and write, the stale migration operation does
  not overwrite the newer field values; rerunning the migration resumes from
  the current state.
- The command is dry-run by default; `--apply` is required for mutation.
- A reviewable JSONL audit report is generated by default at
  `knowledge-taxonomy-migration-report.jsonl`; `--report <path>` selects
  another path. Each line contains the record ID, action, existing metadata,
  proposed metadata, classification, rewrites, and unresolved issues.
- Aggregate terminal output remains bounded to summary counts and Region-key
  inventory rather than dumping every record.
- Re-running the migration is idempotent because populated canonical metadata
  and already-applied rewrites are not changed.

The classification rules are intentionally reviewable source code rather than
an opaque model or LLM decision. The audit report exposes fallback Category
usage, proposed assignments, rewrites, and unresolved taxonomy identities
before mutation.

## Authoring validation (#231)

- Create requires exactly one ACTIVE canonical Category slug.
- Topic assignments are optional; each supplied value must be an ACTIVE canonical Topic slug. Duplicate Topic slugs are removed deterministically while preserving first-selected order.
- Revise remains partial. Supplied Category/Topic values use the same ACTIVE canonical validation as create. A rejected legacy record without an ACTIVE Category must receive one before returning to draft.
- Unknown and retired identities cannot be assigned through authoring. Historical values remain renderable; the separate #230 data migration is not run by this issue.
- `region` remains a free-form display value. `regionKey` is never accepted from a caller; create and revise derive it server-side from the effective display Region through `region-normalization.js`.
- Author, lifecycle status, and review history remain server-owned. Existing submit, approve, and reject moderation transitions are unchanged.
- Public read-only `GET /api/v1/knowledge/taxonomy` exposes ACTIVE `slug`/`displayName` pairs from the backend registry. The draft form consumes this endpoint rather than maintaining a second vocabulary.

## Region boundary

Region is not a Category or Topic. The existing single free-form
Knowledge.region field remains a separate geographic dimension governed by
ADR-0011 and its shared normalization/alias contract.

## Source basis

The vocabulary is intentionally focused on AquaVeda's water-domain scope and
the original SIH problem statement. The initial set prioritizes useful
discovery dimensions over a target number of terms.

This file and the executable module must be updated together for vocabulary
changes. The vocabulary tests enforce both the source-controlled identity
sets and the absence of rejected near-duplicate terms.
