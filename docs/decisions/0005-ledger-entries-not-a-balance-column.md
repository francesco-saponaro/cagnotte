# 5. A ledger of entries, not a balance column

Date: 2026-11-13

## Context

A member's pot moves for many reasons: a cashback is reported, confirmed weeks later, sometimes reversed after a return; a claim is credited by hand; a referral pays a bonus; a payout reserves money, then sends it or gives it back. The wallet shows four numbers (pending, available, reserved, paid) and they must always add up: what is available is exactly what was validated and not yet reserved or paid, to the cent, for every member, after every one of those events in any order. The margin report and the finance team depend on the same figures.

## Options considered

1. **Balance columns on the user** (`pending_cents`, `available_cents`, …), updated in place by each use case. Reading a wallet is one row. But every bug is silent: a step that forgets to decrement, or decrements twice, leaves a number nobody can explain, and the only way to find it is to replay history by hand. Concurrency needs careful locking on the user row.
2. **A ledger of append-only entries**, each a signed amount in one bucket for one member, referencing what it is about, and balances as sums. Reading a wallet is a `sum … group by bucket` over the member's entries (indexed by member and bucket). A wrong step leaves evidence: an entry that does not belong, a cashback whose entries do not net to its status. Nothing is ever updated or deleted.
3. **Both:** entries as the source of truth plus cached balance columns refreshed by the writes. The read is fast and the history exists, at the price of two things that can disagree, which brings back the reconciliation problem the ledger was meant to remove.

## Decision

Option 2. `ledger_entries` has `kind`, `bucket`, a signed `amount_cents` that is never zero (a check constraint), and `ref_type`/`ref_id` naming the cashback, payout or referral behind it. Only three shapes of movement exist, in one module (`ledgerWriterCreator`): a credit (`+x` into a bucket), a reversal (`−x` out of one), a transfer (`−x` from one bucket, `+x` into another). Every use case that moves money uses them inside the same database transaction as the record it changes.

The rules this makes checkable, and `GET /reports/reconciliation` checks: the pending bucket equals the pending cashbacks; available + reserved + paid equals the validated cashbacks plus the bonuses; each cashback's and each payout's entries net to what its status says; no bucket is ever below zero. The test suite asserts the same after every step of random histories.

A member's balance is read on each request. At this scale (a few hundred entries per member, an index on member and bucket) that is a sub-millisecond query; if it ever mattered, a materialised view or a cached column that the reconciliation report verifies would be added without changing a single use case.

## Consequences

Money can only be explained by its history, which is the point: an auditor or a support agent can open a cashback and read every entry about it. Reversals never go below zero, so a return on money already paid out is refused and reported rather than booked (the pipeline writes it on the batch). Reads do a sum; writes do inserts only, so there is no row contention on the user. The ledger has ten kinds of entry rather than four buckets' worth of columns, and every new money-moving feature has to say which of the three movements it is before it can be written.
