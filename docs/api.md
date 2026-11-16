# The API

Fastify 5, JSON in and out, at `http://localhost:3001` under `docker compose` (`PORT` and `HOST` in `.env`). The rules behind the routes are in `domain.md`; this file is the shape of each request and answer.

## Conventions

**Authentication.** `POST /auth/sign-in` returns a token; send it as `Authorization: Bearer <token>`. Tokens are opaque, 48 characters, valid for `SESSION_HOURS` (72 by default), and die on sign-out. The sessions table holds only their SHA-256.

**Roles.** Each route names the least role it needs: `public`, `member` (any signed-in user), `agent`, `manager`. A manager can do everything an agent can, an agent everything a member can. The check runs before anything else, so a lower role gets `403` even for an id that does not exist. Routes under `/me` are always the caller's own data.

**Pages.** List routes take `page` (from 1) and `pageSize` (1 to 50, default 20) and answer `{ items, total, page, pageSize }`. Lists are newest first unless a `sort` says otherwise.

**Money and time.** Amounts are integer cents (`amountCents`), rates are integer basis points (`rateBps`, 500 = 5 %), instants are ISO 8601 strings in UTC.

**Errors.** Always `{ "error": { "code", "message", "details"? } }`:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid` | The body or query could not be read: wrong type, unknown enum value, missing field. `details` lists `{ path, message }` per field. Also a blank reason or a negative amount the use case refuses. |
| 401 | `unauthorized` | No token, an expired one, or a wrong email or password. |
| 403 | `forbidden` | The role is too low, or the record belongs to another member. |
| 404 | `not_found` | No such route or record. A member asking for an offer that is not live gets a 404, not a hint. |
| 409 | `conflict` | A transition the state machine forbids (`a payout cannot go from sent to failed`), a duplicate email or slug, an overlapping boost. |
| 422 | `rule` | A well-formed request a business rule refuses: a transfer under 20 €, more than the available balance, a claim with no activation before the order, a boost below the base rate. |
| 429 | `rate_limited` | More than 20 requests a minute from one address on `/auth/*`. |

The request schemas are zod objects in `packages/contracts`, the same ones the app's forms use. The routes themselves are a table in `packages/handlers` (method, path, least role, schema, use case, success status) that the Fastify server registers and that the browser demo dispatches on without a server, so the two answer the same statuses and the same error bodies.

## Auth

| Route | Role | Body | Answer |
| --- | --- | --- | --- |
| `POST /auth/sign-up` | public | `{ email, password, displayName, referralCode? }`. Password: 10+ characters with a lower-case letter, an upper-case letter and a digit. | `201 { user, token, expiresAt }`. `409` email taken; `422` unknown referral code or a code already used twenty times. |
| `POST /auth/sign-in` | public | `{ email, password }` | `200 { user, token, expiresAt }`; `401` otherwise, with the same message for a wrong password and an unknown email. |
| `POST /auth/sign-out` | member | — | `204`. The token is dead afterwards. |
| `GET /me` | member | — | The user: `{ id, email, displayName, role, referralCode, referredBy, createdAt }`. Never the password hash. |

## Offers and activations

| Route | Role | Query or body | Answer |
| --- | --- | --- | --- |
| `GET /offers` | member | `q` (title or merchant name), `merchant` (id), `kind` (`online`, `voucher`), `category`, `sort` (`rate` default, `newest`, `name`), `page`, `pageSize`, `all=1` (managers only: every status, not just live) | A page of offers, each with its `merchant`. |
| `GET /offers/:id` | member | — | The offer with `merchant`, `boosts` and `rateInForce: { rateBps, boosted }` for this instant. `404` for a member when the offer is not live. |
| `POST /offers/:id/activate` | member | — | `201` the activation: `{ id, offerId, subId, rateBps, boosted, activatedAt, trackingUrl }`. The rate is the one in force now and is what the cashback will be computed from. `422` when the offer is not live, has not started or is over. |
| `GET /me/activations` | member | `page`, `pageSize` | A page of activations, each with its `offer` and `offer.merchant`. |

## The wallet

| Route | Role | Query or body | Answer |
| --- | --- | --- | --- |
| `GET /me/wallet` | member | `page`, `pageSize` | `{ userId, balances: { pending, available, reserved, paid }, ledger }`. Balances are sums of the ledger entries, computed on each call; `ledger` is a page of entries `{ id, kind, bucket, amountCents, refType, refId, note, createdAt }`. |
| `GET /me/cashbacks` | member | `status` (`pending`, `validated`, `refused`, `cancelled`), `page`, `pageSize` | A page of cashbacks with their `offer`. |
| `GET /me/cashbacks/:id` | member | — | The cashback with `offer` and `entries`, its ledger entries in order. `403` for another member's. |
| `GET /users/:id/wallet` | agent | `page`, `pageSize` | Any member's wallet, for working a claim. |
| `GET /users/:id/cashbacks` | agent | as `/me/cashbacks` | Any member's cashbacks. |

## Payouts

| Route | Role | Query or body | Answer |
| --- | --- | --- | --- |
| `POST /me/payouts` | member | `{ method: transfer \| gift_card \| donation, amountCents, destination }` | `201` the payout, `requested`. The amount moves from `available` to `reserved` at once. `422` under the minimum (20 € transfer in multiples of 5 €, 15 € gift card, 5 € donation) or above the available balance. |
| `GET /me/payouts` | member | `status`, `page`, `pageSize` | Own payouts. |
| `GET /payouts` | manager | `status`, `page`, `pageSize` | The queue, each with `member: { id, email, displayName }`. |
| `POST /payouts/:id/check` | manager | — | `requested → checking`. |
| `POST /payouts/:id/send` | manager | — | `checking → sent`; `reserved → paid` in the ledger. `409` straight from `requested`. |
| `POST /payouts/:id/fail` | manager | `{ reason }` | `requested \| checking → failed`; `reserved → available`, the money is back. |

## Claims

| Route | Role | Query or body | Answer |
| --- | --- | --- | --- |
| `POST /me/claims` | member | `{ offerId, orderRef, orderedAt, orderCents, proofText }` | `201` the claim, `filed`. `422` when the member has no activation of that offer at or before `orderedAt`, or the order is more than three months old (online offers). `400` when the date is in the future. |
| `GET /me/claims` | member | `status`, `page`, `pageSize` | Own claims with `offer` and `member`. |
| `GET /me/claims/:id` | member | — | One claim; `403` for another member's. |
| `GET /claims` | agent | `status`, `assignee` (user id), `q` (order reference or member email), `page`, `pageSize` | The queue. |
| `GET /claims/:id` | agent | — | The claim with `offer`, `offer.merchant` and `member`. |
| `POST /claims/:id/assign` | agent | `{ assigneeId }` | Sets the assignee, who must be an agent or a manager (`422`), on any open claim (`409` once credited or declined). |
| `POST /claims/:id/acknowledge` | agent | — | `filed → acknowledged`; the caller becomes the assignee if there is none. |
| `POST /claims/:id/raise` | agent | `{ networkTransactionId? }` | `acknowledged → raised`. The optional transaction must be at the same merchant and not already matched (`422`). |
| `POST /claims/:id/decline` | agent | `{ reason }` from `no_activation_before_order`, `foreign_promo_code`, `outside_claim_window`, `order_not_found_at_network`, `order_returned` | `filed \| acknowledged \| raised → declined`. |
| `POST /claims/:id/credit` | agent | — | `raised → credited`. Computes the cashback from the click the claim stands on and the order the member reported (or the linked transaction's amount and commission, when there is one), by the offer's rules at activation time, creates it `validated` with `decidedBy: "claim"`, books a `manual_credit` entry straight into `available`, and marks the linked transaction `matched`. The answer carries `cashbackId`. `422` when that click already has a cashback or the offer's rules exclude the order (the message names the rule). |

## Decisions on a cashback

| Route | Role | Body | Answer |
| --- | --- | --- | --- |
| `POST /cashbacks/:id/validate` | manager | `{ reason }` | `pending → validated`; `pending → available` in the ledger. |
| `POST /cashbacks/:id/refuse` | manager | `{ reason }` | `pending → refused`; the pending entry is reversed. |
| `POST /cashbacks/:id/cancel` | manager | `{ reason }` | `pending \| validated → cancelled`. A validated one is taken back from `available`, and only while the balance covers it (`422`), so no bucket ever goes negative. |

Each writes `decidedBy: "manager"`, `decisionReason`, `decidedAt` and an audit row.

## Imports and the transactions queue

The settlement pipeline, run by hand from a network's export file. `domain.md` has the rules step by step.

| Route | Role | Query or body | Answer |
| --- | --- | --- | --- |
| `POST /imports` | manager | `{ network: linkpool \| affinet, filename, content }` where `content` is the file as text (the CSV for linkpool, the JSON document for affinet; up to a million characters) | `201` the batch: `{ id, network, filename, importedBy, status, rowCount, newCount, updatedCount, matchedCount, unmatchedCount, errorCount, errors: [{ line, message }], createdAt, processedAt }`. `status` is `processed` when the file was read, even with error rows, and `failed` when it could not be read at all (one error on line 0). The whole file is one transaction: either every row's effects land or none do. |
| `GET /imports` | manager | `page`, `pageSize` | Batches, newest first. |
| `GET /imports/:id` | manager | — | One batch with its errors. Its transactions: `GET /transactions?batch=<id>`. |
| `GET /transactions` | manager | `match` (`unmatched`, `matched`, `ignored`), `network`, `merchant` (id), `batch` (id), `page`, `pageSize` | Transactions newest reported first, each with `merchant`. |
| `GET /transactions/:id` | manager | — | The transaction with `merchant`, `activation` (the matched click with its `offer` and `member`, or null), `cashback` (or null), `noMatchReason` (`no_sub_id`, `unknown_sub_id`, `other_merchant`, `after_order`, `outside_window`, or null once matched) and `candidates`: the clicks at the merchant inside its attribution window before the order, latest first, each with `offer` and `member`, for a match by hand. |
| `POST /transactions/:id/match` | manager | `{ activationId }` | `unmatched \| ignored → matched`, booking the cashback exactly as the pipeline would (it can still end `ignored` with a reason if the offer's rules exclude the order). `422` when the click is at another merchant, after the order or outside the window; `409` when the click already has a cashback or the transaction is already matched. |
| `POST /transactions/:id/ignore` | manager | `{ reason }` | `unmatched → ignored` with the reason kept on the row. `409` once matched. An ignored transaction can still be matched later. |

## The catalogue

| Route | Role | Body | Answer |
| --- | --- | --- | --- |
| `GET /merchants` | agent | — | Every merchant, by name. |
| `POST /merchants` | manager | `{ slug, name, category, country, attributionDays, network: linkpool \| affinet, advertiserRef }` | `201`; `409` on a taken slug. |
| `POST /offers` | manager | `{ merchantId, kind, title, description?, rateKind: percent \| fixed, rateBps?, fixedCents?, minSpendCents?, newCustomersOnly?, capCents?, validationDays, startsAt, endsAt? }` | `201` the offer, `draft`. A percent offer has a rate and no fixed amount, a fixed one the reverse (`400`). |
| `PATCH /offers/:id` | manager | any of the fields above but `merchantId` | The offer. `409` once ended. A rate change never touches past activations, which carry their own snapshot. |
| `POST /offers/:id/publish` · `/pause` · `/resume` · `/end` | manager | — | `draft → live`, `live → paused`, `paused → live`, `live \| paused → ended` (`endsAt` set to now). `409` otherwise. |
| `POST /offers/:id/boosts` | manager | `{ rateBps, startsAt, endsAt }` | `201` the boost. The offer must be live and percent, the rate above the base (`422`), the window free of other boosts (`409`). |

## Reports and the audit log

| Route | Role | Query | Answer |
| --- | --- | --- | --- |
| `GET /reports/overview` | manager | — | `{ members, liveOffers, pendingCashbacks: { count, cents }, validatedCents, validatedLast30DaysCents, unmatchedTransactions, openClaims, payoutsWaiting }`. |
| `GET /reports/margin` | manager | `from`, `to` (default: the last 30 days) | `{ from, to, lines: [{ merchantId, merchantName, transactions, orderCents, commissionCents, cashbackCents, marginCents }], totals }`, by orders placed in the window, biggest commission first. Refused cashbacks count as zero out. |
| `GET /reports/reconciliation` | manager | — | The book recomputed from the entries: `{ at, buckets: { pending, available, reserved, paid }, cashbacks: { pendingCents, validatedCents }, bonusCents, checks: [{ name, expected, actual, ok }], cashbacksOutOfBalance: [id], payoutsOutOfBalance: [id], negativeBalances: [{ userId, bucket, amountCents }], ok }`. The two checks: the pending bucket equals the pending cashbacks; available + reserved + paid equals the validated cashbacks plus the referral bonuses. The lists name every cashback or payout whose entries do not net to its status and every member with a bucket below zero. `ok` is true when everything agrees. |
| `GET /audit` | manager | `entityType`, `entityId`, `actorId`, `page`, `pageSize` | A page of `{ id, actorId, action, entityType, entityId, before, after, reason, at }`. Every transition in this document writes one. |
