# Geocoding provider comparison (#134) — production provider NOT selected

Status: **Open. The evidence below does not yet support choosing a production provider.**
Date of research: 2026-10-29. "Evidence" marks how each fact was sourced; anything not from the
provider's own pages must be re-verified against the provider's current Terms before adoption.

## Requirements derived from the accepted design
1. Forward geocoding of free text, submit-driven (<= ~20 searches/min/IP, app-wide spacing).
2. **We persist the chosen label** (and derived coordinates) in `Issue`. Terms must permit storing results.
3. Server-side key only; no client exposure.
4. Attribution compatible with the report form (a link under results).
5. Acceptable coverage for India (Bihar-first user base) — **untested for every candidate**.
6. Sending only user-typed query text; provider's data-handling/privacy terms acceptable.
7. Availability/SLA adequate for a form that degrades gracefully when it is down.

## Candidates
| Provider | Storage of results | Free tier / limits | Attribution | Evidence | Verdict |
|---|---|---|---|---|---|
| **OSMF public Nominatim** | OSM data (ODbL); policy requires caching | 1 req/s for the whole app, no autocomplete, identifying User-Agent, no bulk | © OpenStreetMap contributors | OSMF usage policy (search results), previously confirmed | **Dev only.** No SLA; policy forbids heavy use. Refused by config in production. |
| **Self-hosted Nominatim** | Unrestricted (own data) | None; ops cost (planet/regional import, RAM/disk, updates) | © OSM contributors | General knowledge; not benchmarked here | Viable but operationally heavy for a solo project; revisit if volume or privacy demands. |
| **LocationIQ** (Nominatim-compatible API) | Official pricing page: "store response data forever"; free plan may cache request/response pairs up to 48 h | Free: 5,000 req/day, 2 req/s, 60 req/min; paid from ~$100/mo for geocoding (third-party price listing) | Free plan requires a visible "Search by LocationIQ.com" link | **Official page** (storage/attribution); third-party (limits/prices) | **Shortlist.** Protocol-compatible with the adapter (`GEOCODER_BASE_URL`, `GEOCODER_API_KEY`, attribution env). Free-tier commercial use is "limited". |
| **Geoapify** | Not confirmed from official ToS | Free: 3,000 credits/day, 5 req/s; commercial use with attribution (third-party summaries) | "Powered by Geoapify" + data-source attribution | **Third-party only** | **Shortlist, unverified.** Different response schema => needs a second normalizer. |
| **OpenCage** | Free tier labelled testing-only | 2,500 req/day, 1 req/s | Required | Third-party only | Not suitable on the free tier for production use. |
| Google / Mapbox / HERE / TomTom | Temporary results generally may not be stored/cached; storage needs a separate paid "permanent" tier | Varies | Often tied to their maps | Third-party comparisons | **Rejected:** conflicts with persisting labels (D1) and costs. |

## What blocks a decision (to do before choosing)
1. Read the *official* Terms of the shortlisted providers (LocationIQ ToS; Geoapify ToS/FAQ) for: storage of
   derived labels/coordinates, commercial use on the chosen plan, attribution wording, data-processing/privacy.
2. Run a small coverage test: ~20 real Bihar/India queries (localities, landmarks, streets) per provider;
   compare hit rate and label quality against public Nominatim.
3. Confirm the expected volume (searches/day) fits the plan, with the per-instance throttle/cache in mind.
4. Decide on SLA expectations (the UI already degrades to coordinate entry when unavailable).

## Open conditions before enabling any hosted provider in production (review of #134)
- **Privacy disclosure:** the form discloses at the point of use that the typed search text goes to a third-party
  place-search service and device location does not. The privacy documentation must also name the selected provider
  and its data handling before enabling it. Search text must never be described as staying inside AquaVeda.
- **Cache vs. storage are separate permissions.** LocationIQ's official page allows storing response data, but the
  free plan allows caching request/response pairs for only 48 h. Our in-memory cache TTL (24 h default, configurable via
  `GEOCODER_CACHE_TTL_MS`) is within that; persisting chosen labels is a separate "store response data" question that
  must be confirmed against the current ToS (https://locationiq.com/tos) for the selected plan.
- **Public Nominatim testing:** its policy warns against submitting personal/confidential information. Use synthetic
  queries (landmarks, public places) when testing against the public instance; never real home addresses.
- Attribution wording must be confirmed per provider and set via `GEOCODER_ATTRIBUTION_TEXT/URL`.
- #134 is not complete in production until a provider is selected, configured, and smoke-tested.

## Interim behavior (implemented)
- Development: public Nominatim, compliant (>=1.1 s spacing, UA, cache, no autocomplete).
- Production with no `GEOCODER_BASE_URL`: **place search disabled** (503 `GEOCODER_UNAVAILABLE`); the form
  still works via current location or manual coordinates. Production pointing at the public OSMF host is a startup error.
- Switching provider is configuration-only for any Nominatim-compatible API; a non-compatible provider needs one
  additional normalizer in `server/src/services/geocoder.js`.
