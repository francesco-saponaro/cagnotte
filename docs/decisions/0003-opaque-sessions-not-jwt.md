# 3. Opaque session tokens stored hashed, not JWT

Date: 2026-11-12

## Context

Members sign in on a phone and stay signed in for days; agents and managers sign in on a laptop. The API must know who is calling and be able to end a session: on sign-out, when a password changes, when an account is closed. The same sign-in code has to run in the browser demo, where there is no server and no secret to keep.

## Options considered

1. **JWT, signed with a server secret.** Stateless: the token carries the user id and role, the API verifies the signature and does no lookup. Revocation needs a deny list, which is a lookup again; the role inside the token goes stale when a user is promoted; the signing secret has to exist, which the browser demo cannot have.
2. **Opaque random tokens, stored in a `sessions` table as their SHA-256 with an expiry.** One lookup per request. Sign-out deletes the row; the role is read from the user row on each request so it is never stale; a leaked database gives nobody a usable token, because only the hash is stored.
3. **Cookie sessions** with the same table behind them. Fine for the web, awkward for a native app that keeps the token in secure storage and sends it as a header.

## Decision

Option 2. The client holds a 48-character random token and sends `Authorization: Bearer <token>`. The API hashes it, looks up the row, checks the expiry (72 hours by default, `SESSION_HOURS`), then loads the user and reduces it to an actor `{ id, role }`. Every route declares the least role it needs, and the check runs before any parsing or lookup, so a member probing a staff route gets 403 whether the id exists or not. Sign-in and sign-up share one rate limit per address so a brute force cannot split itself across the two routes, and a wrong password and an unknown email get the same answer.

## Consequences

One indexed read per request, which is nothing at this scale. The sessions table grows until expired rows are cleaned; a periodic delete is a one-liner left for later. In exchange, revocation is immediate, roles are never stale, the demo signs people in with the same code against PGlite, and there is no secret anywhere in the project.
