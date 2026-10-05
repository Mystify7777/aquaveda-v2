# Public Issue discovery contract (Issue #41)

Status: **Locked** with Issue #41. Extends `GET /api/v1/issues` (#40/#48);
there is no parallel discovery endpoint. A request with none of the new
parameters behaves exactly as before.

## Endpoint

`GET /api/v1/issues` — public, anonymous (no `requireActor`), read-only.

## Query parameters

All optional, all combinable (logical AND). Unknown parameters are ignored,
as on every other list route.

| Parameter | Type | Default | Bounds / rule |
|---|---|---|---|
| `page` | integer | `1` | `>= 1` (unchanged) |
| `limit` | integer | `20` | `1..50` (unchanged) |
| `status` | enum | — | `open`, `acknowledged`, `in_progress`, `resolved`, `verified` (unchanged) |
| `category` | enum | — | a value of `ISSUE_CATEGORIES` (`domain/issue-classification.js`) |
| `severity` | enum | — | a value of `ISSUE_SEVERITIES` (`domain/issue-classification.js`) |
| `q` | string | — | trimmed; 2–100 characters; at most 10 whitespace-separated terms |
| `bbox` | string | — | `west,south,east,north` (see below) |

`category` / `severity` match the stored value exactly. Unclassified issues
(`""`) are never matched by either filter; "unclassified" is not a filterable
value (no new semantics are invented).

### `q` — text search

- Searches Issue `title` and `description` only.
- Terms are separated by whitespace and double quotes (quotes carry no
  query syntax; `-term` and phrases have no special meaning). 2–100
  characters after trimming, at least one and at most 10 terms.
- **Every** term is required (AND), and each must appear **as a whole
  word** in the title or the description (each term may come from either
  field). A term matches literally: regex/query metacharacters are data,
  a letter or digit may not directly precede or follow it, punctuation
  may. No stemming, no prefix or substring matching ("leak" does not match
  "Leaking", "main" does not match "maintenance").
- Case-insensitive, including non-ASCII letters; Unicode letters/digits
  (e.g. Devanagari) are word characters. **Diacritics are significant**
  ("cafe" does not match "Café").
- **Searchable terms.** Candidate selection is index-based, so only a term
  containing at least one letter or digit can *locate* documents
  (`50%`, `a.c`, `main-road` qualify: the index holds their word parts,
  and the exact check then requires the literal term). A term made only
  of punctuation or symbols (`--`, `?!`, `%%`) has no index token, so it
  can never select candidates by itself:
  - a query consisting **only** of such terms is accepted (`200`) and
    always returns an empty result — no scan is ever used to find them;
  - alongside at least one searchable term it is still **required**, like
    every term: it is checked literally (bounded only by the absence of
    an adjacent letter or digit) on the documents the searchable terms
    selected, so it can narrow a result but never widen it or be dropped.
  Consequence: a stray standalone symbol silently over-constrains a query
  (`main - road` matches only documents that contain a standalone `-`,
  typically none). Clients should strip standalone punctuation before
  sending; the server deliberately does not drop terms silently, because
  that would change which terms are required. Ignoring symbol-only terms
  server-side would be a possible later contract change; locating them
  would need a collection scan and is excluded.
- Mechanism (two cooperating parts, because neither alone is correct):
  1. `$text` over the text index selects *candidates*. Each term is
     quoted (neutralizing query syntax). MongoDB ANDs multiple quoted
     terms, but quoted-phrase matching is a *substring* test applied to
     whatever the index scan returned, and that scan is an OR over the
     terms' tokens. Alone, "main" would therefore match "maintenance"
     whenever another term (e.g. "handpump") supplied the candidate.
  2. Per term, an exact whole-word check (`$regex`, escaped literal with
     letter/digit boundaries, case-insensitive) is applied to those
     candidates only. It never drives a scan, so cost stays index-bound.

### `bbox` — geographic bounding box

- One representation: `bbox=west,south,east,north`, decimal degrees,
  **longitude first** (GeoJSON order, same as the persisted coordinates).
  This is exactly Leaflet's `map.getBounds().toBBoxString()`.
- Applies to the Issue's **affected location** (`Issue.location`), never the
  reporter's position.
- `-180 <= west < east <= 180`; `-85 <= south < north <= 85` (the Web
  Mercator limit of the viewport this API serves). Strictly increasing:
  degenerate boxes and antimeridian-crossing boxes (`west >= east`) are
  rejected.
- **Bounded:** `east - west <= 10` and `north - south <= 10` degrees. A
  larger box is a 400, not a clamp, so a client can never silently get a
  different area than it asked for.
- Edges are **inclusive** (a point exactly on any edge or corner matches).
  The box is a plane lng/lat rectangle, i.e. what a map viewport shows.
- No radius/proximity parameter: a "near me" client computes a bbox. Radius
  (`$near`-style) semantics would force distance ordering and break counted,
  stable pagination; it can be added later without changing this contract.

## Ordering and pagination

- Order is always `createdAt` descending, then `_id` descending: total and
  stable under every filter combination, so offset pagination never skips
  or repeats a record that already existed. No relevance or distance sort.
- `total` / `totalPages` are computed with the same filter as `items`.
- Results are bounded per request by `limit <= 50`; geographic scope by the
  10-degree cap.

## Response

Unchanged canonical success envelope; `data` is
`{ items, page, limit, total, totalPages }` and `items` are the same public
Issue documents the list already returned (same populated `reportedBy`
public-actor fields). No new fields (no distance, no score).

- No match → `200` with `items: []`, `total: 0`, `totalPages: 0`.
- Any invalid parameter → `400`, `code: "VALIDATION_FAILED"`, canonical error
  envelope; `message` names the first problem. Nothing is clamped, defaulted, or
  silently dropped for a *recognized* parameter.

## MongoDB strategy

| Need | Mechanism | Index |
|---|---|---|
| `status` | equality | existing `{status: 1}` |
| `category`, `severity` | equality | none — low-cardinality enums, always combined with another filter or a page-bounded sort; no access pattern justifies one |
| `q` | `$text` | **new** `{title: "text", description: "text"}`, `default_language: "none"` |
| `bbox` | `$geoWithin` + exact bounds | existing `{location: "2dsphere"}` |

`bbox` is two cooperating conditions, because no single operator is both
index-assisted and exact:

1. `$geoWithin: {$centerSphere: [center, radius]}` lets the planner use the
   2dsphere index. The circle is centered on the box and its radius reaches
   the farthest corner plus ~0.1 degree, so it always **strictly encloses**
   the box. It is only a candidate filter; its own boundary behavior is
   never relied upon.
2. Exact planar bounds on `location.coordinates.0` / `.1`
   (`$gte`/`$lte`, i.e. longitude/latitude) trim the candidates to the
   precise, edge-inclusive lng/lat rectangle.

Why not a single operator (verified against a real `mongod`, see the tests):

- A GeoJSON `$geometry` polygon built from the corners has great-circle
  edges that bow off the parallels: it dropped points exactly on the south
  edge and admitted points just north of the north edge.
- The legacy `$box` is exact and inclusive but plans as a `COLLSCAN` on a
  `2dsphere` index.

`$text` cannot be combined with `$near`; this contract uses neither `$near`
nor `$nearSphere`, so `q` composes with every other filter.

## Not in this contract

Radius search, distance/relevance ordering, fuzzy or prefix text search,
multi-value filters (`status=a,b`), cursor pagination, antimeridian
crossing.

## Frontend adoption: `/explore` (Issue #82)

The contract above is unchanged; this records how Explore consumes it.
Code: `src/lib/issues/discovery.ts` (state), `src/app/explore/page.tsx`.

- **URL is the only state.** `/explore?status&category&severity&q&bbox&page`,
  parsed and serialized in one place. Serialization is deterministic (fixed
  key order, inactive filters and `page=1` omitted); status links, filter
  form and pagination all emit canonical URLs. Changing any filter resets
  `page`. No global/client state.
- **Nothing is re-implemented.** Category/severity come from
  `issue-classification.js`; `q` and `bbox` are validated with the backend's
  own `issue-search.js` (`searchTextProblem`, `parseBbox`, `bboxProblem`), reached through the single boundary file `src/lib/issues/discovery-contract.ts` (same pattern as `classification.ts`).
  `q` is sent trimmed, otherwise as typed; there is no client-side matching,
  stripping of punctuation, or normalization beyond the trim.
- **Unknown values.** Unrecognized `status`/`category`/`severity` are ignored
  (as `status` always was). A `q`/`bbox` that breaks the contract is **not
  sent and not dropped silently**: Explore shows the backend's wording and no
  results.
- **Filter form** is a native GET form (no JS needed). Blank fields submit as
  `?q=&category=`; the page redirects those (and padded `q`) to the canonical
  URL. "Clear filters" clears category/severity/`q`/`bbox` and keeps `status`
  (which has its own "All").
- **Area search (`bbox`).** The map offers an explicit "Search this area"
  (Leaflet bounds are exactly the contract order). Not automatic, so panning
  never refetches or loops. The viewport is rounded to 5 decimals and validated
  after rounding; a viewport the API would reject (over 10 degrees, outside the
  world map) disables the button with a hint and is never clamped. With an
  active `bbox` the map fits that area and stays visible when the area has no
  issues. The map still plots only the current page's issues.
- **Limitations.** No radius/"near me" (per contract). Standalone punctuation
  in `q` over-constrains results (see contract); the form hints that every
  word must match but does not alter the query. A fitted bbox view can be
  slightly larger than the bbox itself (Leaflet zoom snapping).
