# Account State Enforcement

Status: Implemented in #173.

## Authoritative state

The current account lifecycle is persisted on `User.accountState` and uses:

- `ACTIVE`
- `MUTED`
- `HARD_SUSPENDED`
- `DELETION_PENDING`
- `PERMANENTLY_DELETED`

Missing `accountState` on legacy User documents is interpreted as `ACTIVE` by the authentication boundary.

The JWT never carries account state. Every authenticated request resolves the current User from persistence.

## Authenticated request boundary

`authMiddleware` resolves both:

- `req.actorContext = { id, role }`
- `req.accountState`

The actor context contract remains unchanged.

After the auth router, `accountStateMiddleware` blocks application/domain routes for:

- `HARD_SUSPENDED`
- `DELETION_PENDING`
- `PERMANENTLY_DELETED`

`MUTED` remains authenticated and read-capable. Contribution enforcement belongs to #174.

The auth router remains reachable for `/me`, logout, and refresh because those operations are part of the account/session recovery boundary.

## Stable errors

Blocked lifecycle states use stable machine-readable errors:

| State | Error code | HTTP |
|---|---|---:|
| `HARD_SUSPENDED` | `ACCOUNT_SUSPENDED` | 403 |
| `DELETION_PENDING` | `ACCOUNT_DELETION_PENDING` | 403 |
| `PERMANENTLY_DELETED` | `ACCOUNT_PERMANENTLY_DELETED` | 403 |

`/me` exposes the current `accountState` separately from `user` so the client can render an appropriate boundary without treating frontend routing as authorization.

## Session invalidation

Refresh is checked against current persisted account state before rotation.

When a refresh request belongs to a blocked account:

1. all persisted refresh sessions for that user are deleted;
2. no replacement session is issued;
3. the stable blocked-account error is returned.

A later recovery to `ACTIVE` therefore cannot reuse a pre-blocking refresh token. Recovery/session issuance itself belongs to the dedicated account-deletion/suspension follow-up issues.

`PERMANENTLY_DELETED` also removes remaining session records when encountered through refresh.

## Security boundary

A valid JWT is not sufficient to authorize an authenticated request. Cryptographic validity establishes only token validity; current account state establishes current eligibility.

Public anonymous browsing remains available when no valid authenticated identity is presented. This implementation does not attempt to identify a person after logout through browser, device, IP, or other heuristic signals.