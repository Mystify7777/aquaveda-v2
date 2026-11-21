## 🔒 Locked — Learn Knowledge Taxonomy and Faceted Discovery (ADR-0011; recorded by #226)

**Status: accepted.** Full decision: `docs/adr/ADR-0011-learn-knowledge-taxonomy-and-faceted-discovery.md`. This extends Knowledge metadata/discovery only; existing Knowledge lifecycle and approved-only public visibility remain unchanged.

- **LRN-L1 — Cardinality.** One primary Category per article; zero or more Topic tags; one Region string per article in v1.
- **LRN-L2 — Controlled identity.** Category/Topic terms have stable immutable slugs and display names. Active terms may be assigned and filtered; retired terms may remain on existing articles and render there, but cannot be newly assigned, selected as filters, or used for related scoring.
- **LRN-L3 — Rename vs merge.** Display-name rename preserves the slug. Semantic merge/replacement requires explicit migration to a canonical slug; retired old slugs remain recognized for rendering.
- **LRN-L4 — Vocabulary governance.** Vocabulary is application-owned/source-controlled. Additions, renames, merges, and retirement require reviewed PRs and tests; persisted reference rewrites require idempotent migration. No runtime taxonomy editor in v1.
- **LRN-L5 — Region semantics.** Preserve the original free-form display string. Matching key uses Unicode NFKC, trim, locale-independent case-folding/lowercase, and internal-whitespace collapse. No inferred equivalence between `Bihar` and `Bihar, India`; only explicit reviewed aliases map variants. Blank is unclassified. Unmapped historic values remain distinct and are reported. No multi-region support in v1.
- **LRN-L6 — Facet composition.** Category is single-select. Multiple Topic selections OR together; multiple Region selections OR together. Category, Topic facet, Region facet, and title/body search combine with AND. Empty facets impose no restriction. Invalid/retired Category/Topic filters are validation failures; unknown Region keys validly match no records.
- **LRN-L7 — Public visibility.** Every public Learn query retains mandatory `status=approved`; filters cannot relax it.
- **LRN-L8 — URL/UX.** Filter state is URL-addressable. Desktop sidebar, mobile drawer/sheet; active chips, clear-all, result count, search, pagination.
- **LRN-L9 — Related Knowledge.** Approved-only; exclude source article. Score: same active Category +4; each shared active Topic +2 (max +6); same normalized Region +1. Require score >0. Sort score DESC, `updatedAt DESC`, `_id ASC`. Bounded result count; retired terms do not score; no AI ranking.
- **LRN-L10 — V1 exclusions.** No taxonomy collection, arbitrary user tags, AI tagging/ranking, followable topics, or runtime taxonomy editor.
- **LRN-L11 — Existing governance.** Knowledge lifecycle, review authority, author/reviewer rules, anonymous public read boundary, and approved-only visibility remain unchanged.

The application-owned vocabulary and exact API semantics are implementation contracts; tasks #228–#240 must conform to ADR-0011.