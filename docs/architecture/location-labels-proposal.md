# Human-readable locations (#134) — Phase 2 decision proposal

Status: **ACCEPTED with amendments (2026-10-29), implemented in #134.** Amendments to the proposal as written:
- D2 provider: public Nominatim is a dev-only default; production has **no default** and place search is disabled until a
  provider is configured (`geocoding-provider-comparison.md`; production provider intentionally not chosen).
- D5 (and #134's own "reverse-geocoding" wording): **no reverse geocoding anywhere**, no exact or rounded device
  coordinates to any provider; GPS/manual-coordinate reports stay unlabeled.
- D7: label is untrusted plain text, never described as a verified address (detail page says so).
- UX: place search is the primary location input; manual lat/lng is a collapsed "Enter coordinates" section.

## Findings (verified against `main` @ d395901)
- No location label/address/place field exists in `Issue` model, Zod schemas, DTO types, UI, or docs.
- Canonical location = GeoJSON Point `[lng, lat]` (2dsphere index). Consumers: map markers, `bbox` filter (#41/#82), report form.
- Report form takes raw lat/lng text + "use my location" (browser GPS). No map-pin selection exists in the form today.
- Persistence is locked at five collections (no cache collection). Rate limiter is in-memory, per-IP.
- Map tiles already use `tile.openstreetmap.org` (OSM attribution present).

## Provider constraints (OSMF public Nominatim)
- ≤1 req/s for the *whole application*, identifying User-Agent, results must be cached, **no autocomplete/type-ahead**, no bulk/batch use, violators get 403/IP block.
- => Per-card read-time reverse geocoding on Explore is prohibited by policy and scales O(cards). Rejected.
- => Place search must be submit-driven (button/Enter), not per-keystroke.
- Attribution: "© OpenStreetMap contributors" when displaying results.
- Production alternatives: hosted Nominatim-compatible (LocationIQ, Geoapify, OpenCage, Geofabrik) or self-hosted. Terms/pricing must be checked for the chosen one at adoption time.

## Proposed decisions
| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Store a label at report time**: optional `Issue.locationLabel` (string, trimmed, ≤200). Never resolved at read time. | Zero provider calls on Explore; no per-card requests; works when provider is down. Additive, no migration, no index. |
| D2 | **Forward geocoding only**, via backend proxy `GET /api/v1/geocode/search?q=` (auth required, rate-limited, global ≤1 rps throttle, in-process TTL cache, `limit≤5`). | No keys/provider URL in client; user IP not sent to provider; abuse bounded to authenticated reporters. |
| D3 | **Provider behind a small adapter**, config: `GEOCODER_BASE_URL`, `GEOCODER_USER_AGENT`, optional `GEOCODER_API_KEY` (validated in `config/env.js`). Default = public Nominatim for dev/low volume. | Swappable without code change; prod target is an open decision (see Q2). |
| D4 | **Privacy**: only the user-typed query text leaves the system, server-side. Device GPS and any precise coordinates are **never** sent to a provider. | Satisfies the "no precise coords to third party" constraint without a privacy exception. |
| D5 | **GPS-derived reports get no label** (fallback display). No reverse geocoding anywhere. | Avoids D4 exception; reverse geocoding can be a later, separately-decided feature. |
| D6 | **Fallback display**: no label → "Location not named" + coordinates as secondary text (detail page); card shows "Location not named". Legacy issues behave the same. | Never blocks list/map. |
| D7 | **Label trust**: client sends `locationLabel` with coordinates; server treats it as untrusted display text (trim, length cap, rendered as plain text via existing user-text policy). Coordinates remain the only authoritative geometry. | Proportionate (L3). Label/coord mismatch is a cosmetic risk, not a security one. Alternative (server re-derives label) costs a 2nd provider call + reverse geocode of non-device coords. |

## Rejected
- Client-side direct provider calls (key exposure, IP leak, uncontrolled rate).
- Read-time reverse geocoding per card (policy violation, latency, failure coupling).
- Persisted geocode cache collection (breaks five-collection lock; in-process TTL cache sufficient).
- Google/Mapbox geocoding (storage-restriction ToS, cost, key management) for this scale.
- Embedding label into `q` search / bbox logic (out of scope; #41 contract untouched).

## Contract impact (additive only)
`POST /api/v1/issues` accepts optional `locationLabel`; `Issue` DTO/type gains `locationLabel?: string`; new `GET /api/v1/geocode/search`. Existing consumers unaffected (optional field).

## Known limitations
- In-process cache + throttle are per-instance (same as current rate limiter).
- Existing issues have no label until a (separate) backfill is decided.
