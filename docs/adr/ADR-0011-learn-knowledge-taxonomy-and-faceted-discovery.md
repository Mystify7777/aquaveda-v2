# ADR-0011: Learn Knowledge Taxonomy and Faceted Discovery

## Status

Accepted.

## Date

2026-11-21

## Context

The Learn surface exposes approved Knowledge articles. The current Knowledge model has a single free-form `region` string, but no persisted category or topic tags. Public Learn reads are restricted to approved content.

The product needs a durable discovery model that distinguishes broad subject, specific topics, and geographic relevance. It must support Learn filtering, article-card navigation, and deterministic related-knowledge discovery without changing Knowledge moderation.

## Decision

AquaVeda uses three separate discovery dimensions:

1. **Category:** exactly one primary category per Knowledge article.
2. **Topic tags:** zero or more canonical, reusable topic tags per article.
3. **Region:** a separate geographic facet; geography is not encoded as a topic tag.

The v1 Category and Topic vocabulary is application-owned and source-controlled. No dedicated taxonomy collection and no arbitrary user-created public tags are introduced.

## Term identity and lifecycle

Every Category and Topic has a stable immutable slug and a display name.

- **Active terms** may be assigned to new or revised articles, appear in taxonomy metadata, and be selected as filters.
- **Retired terms** cannot be newly assigned and are omitted from selectable filter metadata. Existing Knowledge records may retain retired IDs so article meaning and historical records are not silently rewritten.
- Retired terms remain renderable on existing article cards and detail pages using their canonical display name. They are excluded from filter options and related-knowledge scoring.
- A display-name correction/rename preserves the stable slug/identity.
- A semantic replacement or merge requires an explicit migration from old IDs to the chosen canonical replacement. Old IDs remain recognized for rendering during/after migration, become retired aliases, and are not newly selectable.
- Taxonomy additions, display-name changes, merges, and retirements require a reviewed code PR with vocabulary tests. A change that rewrites persisted references also requires an explicit, idempotent migration.
- No runtime user/admin taxonomy editing endpoint is part of v1. Any contributor may propose taxonomy changes through a PR; approval follows repository review/merge policy. The PR must document user-facing/content impact.

## Region compatibility and normalization

The existing `Knowledge.region` field is a single free-form string. V1 keeps one region value per article and does not invent an authoritative geographic hierarchy or silently convert the field to an array.

- Preserve the original region display value.
- Produce the filter key using one shared server-side normalization utility, used by both normal request handling and migration scripts.
- The utility applies Unicode NFKC normalization, trims leading/trailing whitespace, collapses each run of Unicode whitespace to one ASCII space, and applies the ECMAScript default Unicode-aware `toLowerCase()` operation. It must not use locale-sensitive lowercasing.
- This is a normalization key, not a universal Unicode caseless-matching implementation. Any future need for full Unicode case folding requires a separately selected library and migration/versioning decision.
- Do not assume different geographic descriptions refer to the same place. For example, `Bihar` and `Bihar, India` remain distinct unless an explicit, reviewed alias maps them together.
- Aliases are explicit, source-controlled mappings from known normalized input variants to one canonical matching key. Alias resolution is performed after base normalization and never overwrites the original display value.
- Empty/whitespace-only region is unclassified and is not a selectable region facet.
- Values not covered by aliases remain distinct under their normalized key. Migration reports blanks and distinct legacy values; it must not guess.
- Multi-region articles are out of scope for v1.

Required normalization test vectors include case variants, leading/trailing and repeated whitespace, non-breaking spaces, compatibility characters, accented Latin characters, and representative non-Latin text. Migration and API tests must consume the same utility and vectors.

## Facet composition and search semantics

The public Learn list combines distinct dimensions with **AND**:

`approved AND category AND topicFacet AND regionFacet AND search`

Within a facet:

- Category is single-select because each article has exactly one primary Category.
- Multiple selected Topic tags use **OR**: an article matches at least one selected active Topic.
- Multiple selected Region values use **OR**: an article's single normalized region key matches at least one selected region key.
- Category, Topic facet, Region facet, and search combine using AND.
- An empty facet imposes no restriction.
- Search matches the article `title` or `body` (case-insensitive text matching according to the API implementation) and is combined with metadata facets using AND.
- Unknown, malformed, or retired Category/Topic filter values are validation failures, not silently ignored. Unknown Region keys are valid filter values that produce no match; this avoids treating user-entered/stale geographic strings as server faults while preserving exact-match semantics.
- All filters apply only after the mandatory `status = approved` constraint; no query parameter may relax that constraint.

## Learn UX and URL state

Desktop uses a persistent filter sidebar; mobile uses a responsive drawer/sheet.

Learn combines:
- search;
- Category facet;
- Topic/Tag facet;
- Region facet;
- active filter chips;
- clear-all;
- result count;
- pagination.

Filter state is URL-addressable, shareable, refresh-safe, and browser-history compatible. Article cards expose Category and Topic metadata; term navigation leads to the corresponding filtered Learn view.

## Related Knowledge

Related candidates must:
- have `status = approved`;
- exclude the current article;
- contain at least one active Category or Topic identity;
- be scored using active Category/Topic identities and normalized Region keys.

The deterministic score is:
- same active Category: **+4**;
- each shared active Topic tag: **+2**, capped at **+6** total;
- same normalized Region key: **+1**.

Only candidates with score greater than zero qualify. A candidate with no matching Category/Topic may not qualify solely because it shares a Region. Sort by score descending, then `updatedAt DESC`, then `_id ASC` as a stable final tie-break. The API returns a bounded number of candidates. Retired terms do not contribute to the score. No AI/LLM ranking is introduced.

## Options rejected

- **Arbitrary free-form tags:** rejected because spelling variants and synonyms fragment discovery.
- **Category-only classification:** rejected because it cannot represent articles spanning multiple concepts.
- **Region-as-tag:** rejected because geography and subject matter are separate dimensions.
- **Dedicated taxonomy collections for v1:** rejected because a small application-owned vocabulary does not justify extra persistence/lifecycle complexity.
- **AI-generated public tags or AI ranking:** rejected for v1 because the discovery vocabulary and ordering must be deterministic and reviewable.
- **Followable topics/personalization:** deferred as a separate product decision.

## Consequences

### Positive

- predictable reusable taxonomy;
- composable and shareable discovery;
- deterministic related content;
- governed vocabulary changes;
- no premature taxonomy persistence subsystem.

### Costs

- existing Knowledge records need safe backfill;
- authoring contracts/UI need taxonomy selection;
- retirement/merge behavior requires maintenance;
- public filtering/related queries need targeted indexes and tests;
- free-form historic region values need conservative normalization and reporting.

## Compatibility

This ADR does not change Knowledge lifecycle states, review authority, author/reviewer rules, approved-only public visibility, authentication boundaries, or existing Knowledge route ownership. It extends Knowledge metadata and discovery behavior only.

## Implementation boundaries

Work is split across issues #228–#240. Backend and frontend work may proceed in parallel only after the canonical vocabulary and the API contracts they consume are locked. Final integration/regression verification is tracked by #239.
