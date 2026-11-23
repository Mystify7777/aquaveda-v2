# Knowledge Taxonomy V1

This document records the application-owned Category and Topic vocabulary
implemented for Issue #228 under ADR-0011.

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
| `water_supply_distribution` | Water supply and distribution | ACTIVE |
| `water_conservation` | Water conservation | ACTIVE |
| `water_rights` | Water rights | ACTIVE |
| `community_water_management` | Community water management | ACTIVE |
| `drought_management` | Drought management | ACTIVE |

## Identity and lifecycle

- Slugs are stable machine identities and must never be renamed or reused.
- Display names may be corrected without changing the slug.
- ACTIVE terms can be assigned, filtered, exposed through taxonomy metadata,
  and used by related-Knowledge scoring.
- RETIRED terms remain resolvable for rendering existing records but cannot be
  newly assigned, exposed as selectable filters, or used for related scoring.
- Semantic replacement or merge requires an explicit idempotent persisted-data
  migration.
- Taxonomy is application-owned and source-controlled. There is no runtime
  mutation API or taxonomy collection in V1.

## Alias handling

Aliases are explicit source-controlled mappings to canonical slugs. They are
used only to recognize known historical/synonym spellings; they do not create
new taxonomy terms.

Unknown values are not fuzzy-matched and are not silently accepted.

## Region boundary

Region is not a Category or Topic. The existing single free-form
Knowledge.region field remains a separate geographic dimension governed by
ADR-0011 and its shared normalization/alias contract.

## Source basis

The vocabulary is intentionally small and grounded in the existing AquaVeda
water-domain vocabulary and the original SIH knowledge scope, including water
reuse, efficient irrigation, rainwater harvesting, and sustainable water
management. The more specific Topic concepts also align with the existing
Expert-domain vocabulary where applicable.

This file and server/src/domain/knowledge-taxonomy.js must be updated together
for vocabulary changes.
