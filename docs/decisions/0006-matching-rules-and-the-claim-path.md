# 6. Match by the click reference, keep the rest for claims

Date: 2026-11-13

## Context

A network reports a sale with the identifier the tracking link carried (the `subId`), when the click was tracked at all. Cookies get refused, ad blockers run, a member taps a newsletter link in between; a real share of sales arrive with no reference or a reference we never issued. The pipeline has to decide which sales belong to which member, never give a sale to the wrong member, and still let a member who really bought get paid when the tracking failed.

## Options considered

1. **Match by `subId` only, drop the rest.** Simple and never wrong, but every untracked sale is lost: the member sees nothing and support has nothing to work with.
2. **Fuzzy matching:** when there is no `subId`, pick the most recent click at that merchant from any member inside the attribution window. This pays someone, often the wrong someone; two members who activated the same offer the same afternoon cannot be told apart by merchant and time, and a wrong attribution is a payment that cannot be taken back.
3. **Match by `subId` under the rules, keep everything else as `unmatched`,** with two human paths out: a member's **claim**, which carries the order number and stands on an activation they really made before the order, so support can tie the unmatched transaction to it; and a manager's **match by hand**, offered the clicks at that merchant inside the attribution window before the order, latest first, so a mistaken attribution requires a person to choose it.

## Decision

Option 3. The automatic match requires all of: the `subId` names one of our activations; that activation's offer is at the merchant the advertiser reference resolves to (a `subId` from another merchant is a mismatch, not a match); the click is at or before the order; the order is inside the merchant's attribution window (per merchant, 7 to 60 days in the seed); and the click has no cashback yet, because one click earns one cashback and the member is asked to activate before each purchase. Anything else is `unmatched` and the detail view says which rule failed.

Unmatched transactions are first-class rows, listed in the back office with the reason, because they are the raw material of the two human paths. A claim can be raised linked to one at the same merchant; crediting the claim computes the cashback from the claim's activation on the transaction's figures and marks it matched. A manager can match one directly to a proposed click. Both are audited with who did it.

The matching itself is a pure function (`chooseActivation`, `proposeActivations`) over a transaction and candidate clicks, with property tests that no match ever violates a rule whatever the candidates; the pipeline only decides which candidates to hand it (the one the `subId` names).

## Consequences

Nobody is ever paid for a sale the data does not tie to them, and the cost of that strictness is visible: the unmatched queue and the claims queue are where the untracked sales go, and the operations dashboard counts them. Support work is the price of correctness, as it is in the real product. A second purchase on one click is not paid automatically; the member files a claim, which is also the real rule. The rules live in one file a reviewer can read in a minute, and the queue can be explained line by line from the reasons it shows.
