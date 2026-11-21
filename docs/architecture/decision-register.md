## 🔒 Locked — Learn Knowledge Taxonomy and Faceted Discovery (ADR-0011; recorded by #226)

**Status: accepted.** Full decision: `docs/adr/ADR-0011-learn-knowledge-taxonomy-and-faceted-discovery.md`. Knowledge lifecycle and approved-only public visibility remain unchanged.

- **LRN-L1 — Cardinality.** One primary Category per article; zero or more Topic tags; one Region string per article in v1.
- **LRN-L2 — Controlled identity.** Stable immutable slugs and display names. Active terms may be assigned/filtered; retired terms remain renderable on existing articles but cannot be newly assigned, filtered, or used for related scoring.
- **LRN-L3 — Rename vs merge.** Display-name rename preserves identity. Semantic merge requires migration to a canonical slug; retired old slugs remain recognized for rendering.
- **LRN-L4 — Governance.** Source-controlled vocabulary. Additions/renames/merges/retirement require reviewed PRs and tests; persisted-reference rewrites require idempotent migration. No runtime editor in v1.
- **LRN-L5 — Region.** Preserve original free-form display string. A shared server-side utility applies NFKC, Unicode whitespace trimming/collapse, and ECMAScript default Unicode-aware `toLowerCase()`, not locale-sensitive casing. This is explicitly not full Unicode case folding. Explicit aliases only; no inferred equivalence between `Bihar` and `Bihar, India`. Blank is unclassified. Unknown values remain distinct and are reported. No multi-region support.
- **LRN-L6 — Facet composition.** Category single-select. Multiple Topics OR; multiple Regions OR. Category, Topic facet, Region facet, and title/body search combine with AND. Invalid/retired Category/Topic filters fail validation; unknown Region keys validly return no matches.
- **LRN-L7 — Public visibility.** Every public Learn query retains mandatory `status=approved`.
- **LRN-L8 — URL/UX.** URL-addressable state; desktop sidebar, mobile drawer/sheet; active chips, clear-all, counts, search, pagination.
- **LRN-L9 — Related Knowledge.** Candidates approved-only, exclude source, and must contain at least one active Category/Topic. Score: same active Category +4; each shared active Topic +2 (max +6); same normalized Region +1. No region-only candidates with no active taxonomy. Sort score DESC, `updatedAt DESC`, `_id ASC`; bounded result count.
- **LRN-L10 — V1 exclusions.** No taxonomy collection, arbitrary user tags, AI tagging/ranking, followable topics, or runtime editor.
- **LRN-L11 — Existing governance.** Lifecycle, review authority, author/reviewer rules, anonymous read boundary, and approved-only visibility remain unchanged.

