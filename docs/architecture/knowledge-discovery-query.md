# Learn discovery query contract

Issue #232 implements the public Learn discovery query defined by ADR-0011.

## Public query keys

| Key | Meaning | Serialization |
| --- | --- | --- |
| `q` | title/body search | one string |
| `category` | one active canonical Category slug | one string |
| `topic` | active Topic slugs | repeated query key |
| `region` | canonical normalized Region keys | repeated query key |
| `page` | pagination page | existing pagination contract |
| `limit` | pagination size | existing pagination contract |

Example:

`/api/v1/knowledge?q=rainwater&category=water_conservation&topic=rainwater_harvesting&topic=water_reuse&region=bihar&region=jharkhand&page=1&limit=20`

Facet semantics are:

`approved AND category AND topic-facet AND region-facet AND search`

Topic and Region values are OR within their own facet.

## Search strategy

The current AquaVeda deployment uses self-managed MongoDB 7 rather than MongoDB Atlas Search. Issue #232 therefore uses MongoDB's built-in version-3 text index on `title` and `body`.

The query uses:

```js
{ $text: { $search: q, $caseSensitive: false, $diacriticSensitive: false } }
```

This gives token-based full-text matching over both fields and avoids an unbounded case-insensitive regex scan over article bodies. Search results are ordered by MongoDB text relevance first, then `updatedAt DESC`, then `_id ASC` for deterministic pagination.

Quoted multi-word strings are supported by MongoDB's `$text` parser as exact phrases. The search contract intentionally does not promise arbitrary substring matching.

MongoDB documents that `$text` is case-insensitive by default for version-3 text indexes and supports relevance sorting through `$meta: "textScore"`. MongoDB also documents the storage/write-performance cost of text indexes. See the MongoDB documentation referenced from the implementation review.

## Indexes

Knowledge now has these discovery indexes:

1. `knowledge_title_body_text`
   - `{ title: "text", body: "text" }`
   - owns title/body search.

2. `knowledge_approved_category_region_page`
   - `{ status: 1, category: 1, regionKey: 1, updatedAt: -1, _id: 1 }`
   - supports the approved-only Category/Region facet shape and deterministic page ordering.

3. `knowledge_approved_topic_page`
   - `{ status: 1, topics: 1, updatedAt: -1, _id: 1 }`
   - supports the approved-only Topic facet shape and deterministic page ordering.

No speculative taxonomy index or Region-only index is introduced.

## Performance evidence

The implementation exposes the query shape in a form that can be inspected with MongoDB `explain("executionStats")`. Before closing #232, run the discovery benchmark against a representative staging/fixture dataset and record:

- dataset size;
- selective Category/Topic/Region query;
- broad search query;
- `winningPlan`;
- `totalKeysExamined`;
- `totalDocsExamined`;
- `nReturned`;
- measured latency;
- scale boundary at which the text-index strategy should be revisited.

The benchmark must also confirm that approved-only filtering remains part of the same query and that no COLLSCAN-based case-insensitive regex is introduced.

## Scale boundary

This strategy is appropriate for the current small application-owned Knowledge corpus and the self-managed MongoDB deployment. Revisit it when measured broad-search latency or text-index storage/write cost becomes material for production traffic, or when the corpus/traffic grows enough that Atlas Search becomes operationally justified.

A migration to MongoDB Search/Atlas Search would be a separate architecture decision, not an incidental optimization inside #232.

## Taxonomy metadata (#233)

`GET /api/v1/knowledge/taxonomy` is public and read-only.

It returns:

- active Category terms;
- active Topic terms;
- Region options derived only from approved Knowledge;
- one Region option per canonical normalized `regionKey`;
- deterministic Region display labels;
- canonical query-key/serialization metadata.

The endpoint is cacheable for 60 seconds. Taxonomy terms remain source-controlled; there is no runtime taxonomy mutation endpoint.
