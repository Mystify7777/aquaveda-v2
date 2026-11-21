# ADR-0010: Learn Knowledge Taxonomy and Faceted Discovery

## Status

Accepted.

## Date

2026-11-21

## Context

The Learn surface exposes approved Knowledge articles, but article discovery is primarily list/search oriented. The Knowledge model already contains a free-form `region` field, while public reads are restricted to approved content.

The product now needs a durable discovery model that can answer three different questions without conflating them:

1. What broad subject does an article belong to?
2. What specific topics does the article cover?
3. Which articles are relevant to a geographic region?

The same model should support Learn filtering, article-card navigation, and deterministic related-knowledge discovery.

The current Knowledge moderation lifecycle and approved-only public visibility are already established architecture and must remain unchanged.

## Decision

AquaVeda will introduce a controlled Knowledge taxonomy with three distinct discovery dimensions:

### 1. Category

Each article has exactly one primary category.

Category represents the article's broad subject area and is intentionally small and curated.

### 2. Tags / Topics

Each article may have zero or more canonical topic tags.

Tags represent specific concepts discussed by the article and are reusable across articles.

Tags are controlled vocabulary, not arbitrary user-created strings. Synonyms and duplicate concepts resolve to one canonical term.

### 3. Region

Region remains a separate geographic facet.

Existing region semantics are preserved and will be migrated to the taxonomy-compatible representation only where required by implementation. Geographic values must not be encoded as generic topic tags.

## Controlled vocabulary

The initial implementation will keep the vocabulary application-owned rather than introducing a dedicated taxonomy collection.

Each canonical term has:

- stable identifier/slug;
- human-readable name;
- active/inactive lifecycle as required by the implementation;
- explicit ownership by the application taxonomy rather than by individual authors.

The initial vocabulary should remain deliberately small. Taxonomy expansion, renaming, merging, or retirement is a governed content-model change, not an incidental result of article creation.

## Knowledge representation

Conceptually:

```text
Knowledge
├── category: CategoryId
├── tags: TagId[]
├── region: RegionId / compatible existing region value
└── status: existing Knowledge lifecycle
```

The exact persistence representation, validation boundary, and migration mechanism are implementation concerns and must not introduce a new Knowledge lifecycle.

## Learn discovery

The public Learn surface will support faceted discovery composed with existing search and pagination.

Desktop:

- persistent filter sidebar;
- Category facet;
- Topics/Tags facet;
- Region facet;
- active filter chips;
- clear-all action;
- result count.

Mobile:

- the same filters are presented through a responsive filter drawer/sheet rather than a permanent sidebar.

Search and filters compose rather than replacing one another.

Filtered state is represented in the URL so filtered views are:

- shareable;
- refresh-safe;
- browser-history compatible;
- directly addressable.

## Article-card navigation

Article cards expose the canonical category and topic tags.

Canonical category/tag terms are navigable and lead to the corresponding filtered Learn view.

This makes taxonomy useful both as metadata and as a discovery mechanism.

## Related knowledge

The taxonomy is also the deterministic basis for related-article discovery.

The initial relation signal is:

1. same category;
2. shared topic tags;
3. compatible region.

No AI recommendation system is introduced by this ADR.

## Governance rules

- One primary category per article.
- Tags are canonical and reusable.
- No arbitrary user-created public taxonomy terms.
- Duplicate/synonymous terms are merged into a canonical term.
- Geography is kept separate from generic topics.
- Categories remain intentionally small.
- Taxonomy changes are explicit and reviewable.
- Existing approved-only visibility and Knowledge moderation rules remain authoritative.

## Options rejected

### Arbitrary free-form tags

Rejected because spelling variants, synonyms, and near-duplicates would rapidly fragment filtering.

### Category-only classification

Rejected because one broad category cannot express the multiple concepts an article may cover.

### Region as a generic tag

Rejected because geography is a distinct discovery dimension and will otherwise contaminate topic semantics.

### Dedicated taxonomy database collection for v1

Rejected because the initial vocabulary is small and application-owned. A separate collection would add lifecycle, API, persistence, and governance complexity before there is evidence that dynamic taxonomy management requires it.

This decision can be revisited if taxonomy management becomes user/admin-editable or materially exceeds application-owned configuration.

### AI-generated taxonomy

Rejected for the initial system. The public filter vocabulary must be deterministic, reviewable, and stable.

### User-followable topics

Deferred. The taxonomy is a discovery mechanism first; personalization/following is a separate product decision.

## Consequences

### Positive

- Learn becomes substantially easier to browse.
- Multiple discovery dimensions can be combined.
- URLs can represent meaningful filtered views.
- Article cards can link into related content.
- Related knowledge can be implemented deterministically.
- Taxonomy remains governed rather than becoming an uncontrolled tag pile.

### Negative

- Existing Knowledge records require migration.
- Authors/editors need to select category and tags.
- The application must maintain the controlled vocabulary.
- Public list queries become more complex than the current approved-only pagination query.
- Additional indexes and query tests will be required.

## Implementation boundaries

The implementation is intentionally decomposed into small, independently deliverable tasks:

1. taxonomy contract and canonical vocabulary;
2. Knowledge persistence shape and migration;
3. create/revise validation and authoring support;
4. public filtering query contract;
5. taxonomy metadata read contract;
6. frontend URL/filter state;
7. Learn filter sidebar;
8. article-card taxonomy presentation;
9. related knowledge;
10. cross-layer integration and regression coverage.

Backend contract work and frontend state/UI work may proceed in parallel once the API contracts are locked.

## Compatibility

This ADR does not change:

- Knowledge lifecycle states;
- review authority;
- approved-only public visibility;
- existing author/reviewer rules;
- authentication boundaries;
- existing Knowledge route ownership.

It extends the metadata and discovery capabilities of the existing Knowledge domain.
