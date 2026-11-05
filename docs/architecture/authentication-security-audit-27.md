# Authentication security & abuse-resistance audit (#27)

Audited: `main` @ 792642d. Scope: implementation vs. locked architecture (L1–L17, `authentication-architecture-decision-report.md`). No redesign; D-3a untouched.
Method: code reading of token/service/model/middleware/route/config/limiter, review of existing tests, then **executed probes against the real app + real MongoDB 8.3.7** before any finding was recorded.

**Release assessment: CONDITIONAL PASS** (see end). Two confirmed defects were fixed with regression tests; one deployment setting (`TRUSTED_PROXY_HOPS`) must be configured, and the cross-origin browser flow is still unverified (#29).

## Authentication flow map
- **register/login** (`auth.routes.js` → `auth.service.js`): per-IP limiter → Zod (`auth.validation.js`) → service (scrypt hash/verify, `Session` row created, access+refresh JWT issued before DB writes) → two HttpOnly cookies (`access_token` path `/`; `refresh_token` path `/api/v1/auth`).
- **request auth** (`middleware/auth.js`): verify access JWT (HS256-pinned, `exp` required, secret A) → load User from DB each request (role is never trusted from the token) → `req.actorContext = { id, role }`; any failure ⇒ anonymous (null).
- **refresh**: limiter → verify refresh JWT (secret B, distinct, enforced at startup) → atomic `Session.findOneAndDelete({_id, userId, tokenHash, expiresAt>now})` → issue new pair/session (rotation; single-use guaranteed by the atomic delete).
- **logout**: delete session by `sid`, clear both cookies with identical Path/Domain/SameSite.
- **browser boundary** (`app.js`): CORS allowlist (callback `false`, never wildcard) → `csrfOriginGuard` on POST/PUT/PATCH/DELETE: exact Origin match, else Referer origin match, else 403; empty allowlist ⇒ all mutations rejected. Security headers first (#129).
- **abuse**: in-memory sliding-window limiter per IP (login 10/min, register 5/min, refresh 10/min).
- Password reset: **not implemented** (nothing to audit).

## Findings
| ID | Severity | Class | Area | Status | Where |
|---|---|---|---|---|---|
| F-01 | **High** | Confirmed vulnerability (exposure depends on proxy behavior: unverified deployment dependency) | Abuse resistance | **Fixed** | `middleware/rate-limiter.js` `resolveClientIp` |
| F-02 | Medium | Confirmed correctness gap | Abuse resistance | **Fixed** | `middleware/rate-limiter.js` reaper |
| F-03 | Low | Defense-in-depth (info disclosure; channel already open by design) | Credentials | Documented | `auth.service.js` `login` |
| F-04 | Low | Defense-in-depth | Credentials | Follow-up decision | `auth-tokens.js` `SCRYPT_PARAMS` |
| F-05 | Informational | Defense-in-depth | JWT | **Fixed (#139)** | `auth-tokens.js` verify calls |
| F-06 | Informational | Defense-in-depth | Abuse resistance | Documented | limiter is per-IP only |
| F-07 | Informational | Defense-in-depth | Sessions | Documented | `auth.service.js` session creation |

### F-01 — Rate limiting bypass via forged `X-Forwarded-For` / `X-Real-IP` (High, fixed)
- **Behavior:** the limiter keyed clients by the *first* `X-Forwarded-For` entry, then `X-Real-IP`, with no notion of which proxies are trusted. Both are ordinary request headers. Many platform proxies *append* to a client-supplied `X-Forwarded-For`, so even behind a proxy the first entry is attacker-controlled. The pre-existing `docs/planning/issue-42-rate-limiting.md` noted the risk as a deployment caveat but nothing enforced it, and an existing test asserted the first-entry behavior as intended.
- **Reproduced (real app, one socket):** 14 bad logins with no header ⇒ blocked at the 11th (control). 40 bad logins with a different forged `X-Forwarded-For` each ⇒ **never throttled**. 12 registrations with rotating forged headers (limit 5) ⇒ **all accepted**.
- **Impact:** removes the only brute-force/credential-stuffing, account-spam and CPU (scrypt) exhaustion control on login/register/refresh (and the geocode/expert-application limiters). Also unbounded limiter-map growth from attacker-chosen keys.
- **Fix:** `TRUSTED_PROXY_HOPS` (0..10). `resolveClientIp` believes only the entry appended by the Nth trusted proxy from the right; 0 ⇒ socket address; `X-Real-IP` never trusted; a non-IP candidate falls back to the socket address (no junk keys). Production startup **fails** if the variable is unset (an explicit decision is required: unset-and-ignore would merge all users behind a proxy into one bucket; unset-and-trust is the vulnerability).
- **Tests (red before / green after):** `tests/auth.abuse-resistance.test.js` (real HTTP, login/register/refresh × forged XFF / forged X-Real-IP / trusted-hops semantics; DB-free), `tests/rate-limiter.test.js` (`resolveClientIp` matrix), `tests/env.config.test.js` (parsing + production requirement).
- **Deployment dependency:** the correct value is a fact about the real host chain and cannot be verified from the repo. Too high ⇒ bypass; too low ⇒ one shared bucket (fail-safe). Verify against the real platform (see Deferred).

### F-02 — Reaper evicted live rate-limit counters (Medium, fixed)
- **Behavior:** the cleanup interval deleted any key whose newest hit was `< now` — always true — so every counter was wiped each tick (60 s) regardless of its window. Comment claimed it only removed abandoned keys.
- **Reproduced:** 10 hits with a 1-hour window, wait two ticks ⇒ 0 live entries; next hit counted as 1 (should be 12).
- **Impact:** auth limiters (60 s windows) could be exceeded up to ~2× around a tick; any limiter with a window longer than the tick (e.g. hourly limits) was effectively reset every minute.
- **Fix:** track each key's window; evict only when `newest + window <= now`. **Tests:** reaper keeps live counters, evicts elapsed keys, keeps per-key windows independent (`tests/rate-limiter.test.js`).

### F-03 — Login timing reveals whether an email exists (Low, not changed)
Measured median 1.9 ms (unknown email, no hash computed) vs 30.8 ms (known email). Not fixed: `register` already returns `EMAIL_ALREADY_REGISTERED` (409) by design, so existence is disclosed through a supported channel, and both are rate limited (now effectively, after F-01). Adding a dummy hash adds cost without closing the disclosure. Revisit if registration ever becomes non-disclosing.

### F-04 — scrypt cost parameters (Low, follow-up decision)
`N=16384, r=8, p=1`. This is below current OWASP guidance for scrypt (verify the current figure when deciding; it recommends a larger N). Raising N multiplies memory per hash (≈128·N·r bytes) and latency, which interacts with concurrent-login capacity and limiter values, so it needs a capacity decision. The stored hash format is self-describing (`scrypt:N:r:p:salt:hash`), so an upgrade with rehash-on-login is non-breaking. Not changed: no exploit, and passwords are rate-limited.

### F-05 — JWT verification does not pin algorithms or require `exp` (Informational)
Probed: `alg=none`, wrong-secret HS256 and a refresh-secret-signed token are **rejected**. A token signed with HS384 using the correct secret, and a correctly signed token with no `exp`, are **accepted** (library default allows HS256/384/512; `exp` is not required at verify time). Both require possession of the secret, which is what the model already assumes; our issuer always sets HS256 + `exp`. Optional hardening: pass `algorithms: ["HS256"]` and `maxAge`. No claim/issuer/audience changes are recommended: separate secrets already give access/refresh type separation (enforced distinct at startup).

**Resolution (#139):** issued tokens use `HS256` (now passed explicitly via `JWT_ALGORITHM`); both `verifyAccessToken` and `verifyRefreshToken` are pinned to `algorithms: ["HS256"]` and require a numeric, unexpired `exp` (checked explicitly after `jwt.verify`, since the library has no option to require it). Tokens that violate either contract are rejected with the same generic failures as before. `maxAge` was deliberately not used: it needs `iat` and would add a second lifetime rule. Regression tests: `server/tests/auth-tokens.verification.test.js`. See AUD-L4.

### F-06 — No per-account throttle (Informational)
Limiter is per-IP by explicit Issue #42 rule (no account lock-out). A distributed attacker (many real IPs) can still try one account's password many times. Mitigations present: scrypt cost, per-IP limits. A per-account *slow-down* (not lock-out) would be a separate design decision.

### F-07 — Sessions per user are not capped (Informational)
Each login creates a `Session` until its TTL expires. Growth is bounded by the (now effective) login limiter. A cap/oldest-eviction policy is optional.

## Verified as correct (no finding)
- Password compare is constant-time (`timingSafeEqual`); `passwordHash` is `select:false` and never in DTOs; no password/token/cookie in logs (request logger logs method/path/status only; unexpected errors are logged server-side and returned as a fixed generic 500).
- Registration ignores client-supplied `role` (probed: `role: "ADMIN"` ⇒ `USER`); email lookups use validated strings (no operator injection); JSON-cookie (`j:`) values fail JWT verification safely.
- Refresh is single-use via one atomic delete (existing concurrency test); expiry enforced in the query; expired/foreign/consumed sessions all collapse to one `REFRESH_FAILED`.
- Cookies: HttpOnly always; `Secure` in production or whenever `SameSite=None`; refresh cookie scoped to `/api/v1/auth`; clearing uses identical attributes; tokens not reachable from JS.
- CORS: exact allowlist, no wildcard with credentials. CSRF: origin/referer guard fail-closed on missing/malformed/`null` origins and on an empty allowlist; preflights unaffected.
- Error envelopes: no stack/DB detail; only known mapped codes forward their message.

## By design (locked decisions, not findings)
- **L14**: refresh-token reuse is not detected/family-revoked — only the single-use guarantee. **L17**: an already-issued access token remains valid until expiry (default 15 m) after logout/session deletion; the middleware re-reads the User each request, so deleted users and role changes take effect immediately. Both are accepted trade-offs of the locked architecture.

## Deferred / needs separate decision or environment
1. **Set `TRUSTED_PROXY_HOPS` for the real host chain and verify** (send a forged `X-Forwarded-For` to the deployed API; the limiter must still throttle by the real address). Required before production start (startup now enforces the variable is set).
2. **#29** — real cross-origin browser verification of cookies/CSRF; **#129** — hosting-level headers. No browser test was run in this audit.
3. F-04 scrypt parameter/capacity decision; F-06/F-07 optional hardening (F-05 fixed in #139) (separate issues if wanted).
4. Distributed rate limiting is not needed yet; the in-memory store is per instance (N instances ⇒ N× the limit).

## Release assessment: CONDITIONAL PASS
No confirmed critical/high vulnerability remains in the audited code: the High (F-01) and the Medium (F-02) are fixed and covered. The pass is conditional because (a) F-01's real-world protection depends on `TRUSTED_PROXY_HOPS` matching the host, which only a deployed check can confirm, and (b) browser-level cross-origin behavior (#29) has not been exercised. Green tests alone do not establish either.
