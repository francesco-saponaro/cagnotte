# The domain

The cashback business in plain words: the glossary, the rules the code enforces, the state machines, and the settlement pipeline step by step with worked examples. `api.md` has the routes; `decisions/` has why things are the way they are.

## Glossary

**Merchant.** A shop that pays a commission for the sales a publisher brings it. Each merchant lives on one affiliate **network** and is known there by an **advertiser reference**; each has an **attribution window**, the number of days after a click during which the network still credits an order to it.

**Offer.** What a member sees: a merchant, a title, a rate (a percentage in basis points, or a fixed amount), the conditions (minimum spend, new customers only, a cap), and a **validation window**, the number of days the merchant takes to confirm a sale. Offers go through `draft → live → paused → ended`. A **boost** is a temporary higher rate on a live offer; boosts never overlap.

**Activation.** The click. A member taps Activate, the app records who, which offer, when, and the **rate in force** at that instant (the boost covering it, else the base rate), mints a 16-character **subId**, and sends the member to the merchant through a tracking link carrying it. The rate is snapshotted because boosts end and the member was promised the rate they saw.

**Network transaction.** The network's word about a sale: its own reference (unique per network; the deduplication key across files), the order reference, the advertiser, the subId when the click was tracked, the order amount excluding delivery, the commission it will pay, its status (`pending`, `approved`, `declined`), and when it last reported it. Its **match status** is ours: `unmatched`, `matched` to an activation, or `ignored` with a reason.

**Cashback.** The app's derived record: the member's reward for one transaction, computed from the activation's rate and the offer's rules, in cents. `pending` until the merchant confirms, then `validated`, or `refused`; a validated one can be `cancelled` after a return. `decidedBy` says who settled it: the network, a manager by hand, or a claim.

**Ledger entry.** One signed movement of cents in one of four **buckets** for one member: `pending` (reported, not confirmed), `available` (confirmed, spendable), `reserved` (a payout requested, not sent), `paid` (gone). Entries are append-only and reference what they are about (a cashback, a payout, a referral). A member's balance in a bucket is the sum of their entries in it, computed on each request. There is no balance column (decision record 5).

**Claim.** A member saying "I bought and nothing appeared", with the order reference, date, amount and the confirmation pasted as proof. It stands on an activation the member really made before the order, and an agent works it: `filed → acknowledged → raised → credited | declined`.

**Payout.** Available money leaving: a bank transfer (20 € minimum, in steps of 5 €), a gift card (15 €), a donation (5 €). `requested → checking → sent | failed`; the amount is reserved on request and either paid or returned.

**Referral.** A member signs up with another's code. Once the referee has collected 5 € of validated cashback the referral validates: 5 € to the referee, 20 € to the referrer, and for a year the referrer receives 10 % of each of the referee's validated cashbacks. A referee has 90 days to reach the threshold; a code works at most twenty times.

**Import batch.** One network file processed: how many rows, how many new, updated, matched, unmatched, and every row that could not be used with its line number.

## The state machines

Each is a table in `packages/domain/src/transitions.ts`; a use case asks the table before writing, so a forbidden move is a `409` and never a row. Every move writes an audit entry (who, what, before, after, why).

| Entity | Moves |
| --- | --- |
| Offer | `draft → live`; `live → paused → live`; `live \| paused → ended` |
| Cashback | `pending → validated \| refused \| cancelled`; `validated → cancelled` |
| Transaction match | `unmatched → matched \| ignored`; `ignored → matched` |
| Claim | `filed → acknowledged → raised → credited \| declined`; `filed \| acknowledged → declined` |
| Payout | `requested → checking → sent \| failed`; `requested → failed` |
| Referral | `pending → validated \| expired` |
| Import batch | `received → processed \| failed` |

## The settlement pipeline

The hard part of the domain, in `packages/domain/src/settlement/` (the pure steps) and `packages/domain/src/use-cases/{imports,settlement,transactions}.ts` (the steps that read and write). A manager uploads a network's export; the pipeline runs the file as one database transaction; the batch summary says what happened to every row.

### 1. Parse

Each network has its own format, as they do in reality. Linkpool exports a CSV with a header (`transaction_id, advertiser_id, click_ref, order_ref, transaction_date, sale_amount, commission_amount, status, last_updated`; quoted fields allowed; columns in any order). Affinet exports a JSON document with a `transactions` array of objects whose amounts are `{ value, currency }` and whose statuses are `PENDING`, `CONFIRMED`, `REJECTED`. Both become the same parsed row: reference, subId or null, order reference, advertiser, order date, order cents, commission cents, status, reported-at.

A row that cannot be read is an error with its line number (the 1-based line in the CSV, the 1-based index in the JSON array) and the message says which field and what was wrong: `sale_amount is not an amount: 12.9O`, `orderDate is not a date: not a date`, `amount.currency must be EUR: USD`, `status must be pending, approved or declined: cancelled`, `expected 9 columns, found 6`. Dates must be ISO 8601, because `09/11/2026` is a different day on each side of the Atlantic. Amounts go through the same parser as the app's forms, which refuses anything ambiguous. The rest of the file is still processed: one bad row must not hold up a fortnight of cashback. A file that cannot be read at all (not JSON, a header missing a column) is one error on line 0 and the batch is `failed`.

### 2. Deduplicate

A reference seen twice in one file keeps its first row and reports the second (`LP100007 appears twice in the file (first on line 2); the second row is ignored`). A reference already in the database from an earlier file is an **update**, not a new transaction: the network changed its mind about the status or the amount, and step 6 applies the change.

### 3. Resolve the merchant

The advertiser reference on the network names the merchant. An unknown one is an error row (`advertiser LP-nobody is not a merchant on linkpool`), because a transaction with no merchant cannot be matched, reported or claimed.

### 4. Match

The subId the tracking link carried names the activation. It is the match when the activation is at the same merchant, happened at or before the order, and the order is inside the merchant's attribution window. Otherwise the transaction stays `unmatched`, and the detail view says why: `no_sub_id` (the network tracked no click; nothing names a member), `unknown_sub_id` (a click we never made), `other_merchant` (a subId that names a click at another merchant is a mismatch, not a match), `after_order`, `outside_window`, or `click_already_used`: one click earns one cashback, and a second order on the same click is not attributed by itself, because the member should activate before each purchase.

Unmatched transactions are kept. They are what a claim can later supply the order number for, and what a manager can match by hand from the proposals: every click at that merchant inside the attribution window before the order, latest first, whatever their subId.

### 5. Compute and book

From the activation's snapshot and the offer's rules, in this order:

1. Order below the offer's minimum spend → the transaction is `ignored`, reason `below_minimum`.
2. New-customers-only offer and the member already has a validated cashback at that merchant → `ignored`, `not_new_customer`.
3. Percent offer: `round_half_up(orderCents × rateBps / 10000)`; fixed offer: the fixed amount.
4. Cap: the amount is held under the offer's cap.
5. **Margin rule:** the amount is held under the network's commission. A cashback larger than the commission behind it would mean paying people to shop. When this bites, the cashback carries `marginClamped: true` so the margin report and the offer's owner can see it.
6. An amount of zero books nothing: `ignored` with `no_commission` or `zero_amount`.

A cashback is created `pending` with `expectedValidationAt = orderedAt + validationDays`, and one entry: `cashback_pending +amount` in `pending`. If the network has already decided by the time the file arrives, the cashback moves at once: `approved` → `validated`, with `cashback_validated −amount` in `pending` and `+amount` in `available`; `declined` → `refused`, with `cashback_refused −amount` in `pending`. Every cashback's history starts with its pending entry, so the ledger reads as a story.

### 6. Apply the network's updates

For a reference already known:

- **Status.** `approved` on a pending cashback validates it (and runs step 7). `declined` on a pending one refuses it; on a validated one it is a return: the cashback is `cancelled` and `cashback_cancelled −amount` leaves `available`, but only while the member's available balance covers it. If they have already withdrawn the money, the cashback stays as it is and the batch says so (`LP1: only 1,50 € is still available; 6,50 € cannot be taken back`); a bucket never goes below zero. `approved` on a refused or cancelled cashback cannot revive it (those states are final); the batch says to credit it through a claim if it is due.
- **Amount.** The cashback is recomputed with the new order and commission. The difference is booked as `cashback_adjusted` in the bucket where the money is now: `pending` for a pending cashback, `available` for a validated one (a decrease again only while the balance covers it). If the new figures exclude the order altogether (now below the minimum, no commission), a pending cashback is refused and a validated one taken back.
- **A manager's or a claim's decision wins.** The network's later word on a cashback a human decided is not applied; the batch notes it (`LP1 is declined by the network but cashback cb_… was decided by a manager (validated); left as it is`).
- **A late click reference.** A transaction that arrived without a subId and is still unmatched is matched when a later file brings one.

### 7. Referral bonuses

On every validation from the network or a manager (claims excluded, as the terms exclude manual credits from the base):

- a pending referral whose window has passed is marked `expired`;
- a pending referral validates when the referee's validated total reaches 5 €: `referral_bonus +500` to the referee and `+2000` to the referrer, both in `available`, and `bonusUntil` is set a year ahead;
- a validated referral inside its year pays the referrer 10 % of the cashback, rounded half up, as `referral_bonus` noted `10 % of cb_…`. The cashback that validates the referral does not also pay the share.

### 8. Reconcile

`GET /reports/reconciliation` recomputes the whole book from the entries and compares it with the records:

- the `pending` bucket equals the sum of pending cashbacks;
- `available + reserved + paid` equals the sum of validated cashbacks plus the referral bonuses;
- every cashback's entries net to what its status says (pending: `+amount` in pending; validated: `+amount` in available; refused or cancelled: zero everywhere);
- every payout's entries net to its status (requested or checking: `−amount` available, `+amount` reserved; sent: `−amount` available, `+amount` paid; failed: zero);
- no member has a bucket below zero.

The report lists the ids that break a rule. The test suite checks the same invariants after every step of random histories generated with fast-check (files, corrections, decisions, payouts, claims, matches by hand), and then checks that the report agrees. That property test found the one-click-one-cashback rule on its first run.

## The other rules the API enforces

- **Claims.** Filed within 92 days of the order for online offers, against the member's latest activation of that offer at or before the order date. Crediting creates the cashback that should have existed: the activation's rate on the order the member reported (or the linked transaction's amount and commission when the network did report the order without a click), by the same rules as step 5, `validated` at once, booked as `manual_credit +amount` straight into `available`. A click that already has a cashback cannot be credited again. Only an agent or manager moves a claim; a member only files.
- **Payouts.** The minimum per method; transfers in steps of 5 €; never more than the available balance. The amount moves `available → reserved` on request, inside the same transaction as the balance check, so two requests cannot spend the same euro. Sending moves `reserved → paid`; failing moves `reserved → available`.
- **Manual decisions.** A manager can validate, refuse or cancel with a reason. The entries are the pipeline's; the referral bonus is paid the same way; the network cannot overturn the decision afterwards.
- **Offers.** Only live offers can be activated; a boost must beat the base rate and not overlap another; a rate change never touches past activations.
- **Money.** Integer cents, basis points, one half-up rounding where a rate is applied (decision record 2). No entry is ever zero.

## Worked examples

**A plain sale.** Marie activates "Maison Vernet: 6 % back on everything" during a boost to 9 %; the activation stores 900 bps and subId `k3j9d8s7f6g5h4j3`. Two days later Linkpool's file has `LP100007, LP-1037, k3j9d8s7f6g5h4j3, ORD-7F3K2M9Q, …, 129.90, 15.59, pending`. The merchant is Maison Vernet (advertiser `LP-1037`), the subId names her activation at that merchant, 2 days is inside the 30-day window: matched. `applyRate(12990, 900) = 1169`; no cap; 11,69 € < 15,59 € commission: not clamped. Cashback `pending`, 11,69 €, expected to validate 60 days after the order; ledger `cashback_pending +1169` pending. Sixty days on, the next file says `approved`: `cashback_validated −1169` pending, `+1169` available. Her wallet shows 11,69 € available.

**The margin rule.** Same offer, but the network reports a commission of 3,00 € on a 129,90 € order (a thin-margin category). 11,69 € would exceed it, so the cashback is 3,00 € with `marginClamped: true`. The margin report for Maison Vernet shows commission 3,00 € in, cashback 3,00 € out.

**A return.** The sale above was validated and Marie has 11,69 € available. The next file says `declined`: the cashback is `cancelled`, `cashback_cancelled −1169` leaves `available`. Had she already paid out 10 € (available 1,69 €), the pipeline would have left the cashback validated and written on the batch: `LP100007: only 1,69 € is still available; 11,69 € cannot be taken back`.

**A missing cashback.** Marie bought at Atelier Nord after activating, but the network's file has the order with no click reference: `unmatched`, reason `no_sub_id`. She files a claim with the order number. Sam acknowledges, finds the unmatched transaction with that order reference at that merchant, raises the claim linked to it, and credits: the cashback is computed from her activation's rate on the transaction's amount, held under its commission, created `validated` with `decidedBy: "claim"`, booked `manual_credit +amount` into `available`; the transaction becomes `matched` to her click.

**A referral.** Lucas signed up with Marie's code. His first validated cashback is 3,00 €: the referral stays pending. His second is 3,50 €: the total reaches 6,50 € ≥ 5 €, the referral validates, Lucas gets 5,00 € and Marie 20,00 €, both available at once. His third, 4,00 € a month later, pays Marie 0,40 € more. In fourteen months his cashbacks pay her nothing: the year is over.
