import type { ImportBatchRow, MarginReportRow, OverviewRow, PayoutWithMemberRow, ProposalRow, ReconciliationRow, TransactionDetailRow, TransactionRow, UserRow } from "@/api/types";
import { activationVernet, cashbackPending, marie, offerVernet, payoutSent } from "./fixtures";

/*
 * Rows for the back office, shaped like the API's answers with the seed's names. Sam is the
 * agent, Nadia the manager; the transactions, batches and reports agree with each other the way
 * the pipeline makes them agree.
 */

export const sam: UserRow = { ...marie, id: "usr_sam", email: "sam@example.com", displayName: "Sam Girard", role: "agent", referralCode: "sam4x" };
export const nadia: UserRow = { ...marie, id: "usr_nadia", email: "nadia@example.com", displayName: "Nadia Benali", role: "manager", referralCode: "nadia9q" };

export const lucas = { id: "usr_lucas", email: "lucas@example.com", displayName: "Lucas Petit" };

export const batchProcessed: ImportBatchRow = {
  id: "imp_1",
  network: "linkpool",
  filename: "linkpool-transactions-2026-11-13.csv",
  importedBy: nadia.id,
  status: "processed",
  rowCount: 11,
  newCount: 5,
  updatedCount: 0,
  matchedCount: 3,
  unmatchedCount: 2,
  errorCount: 6,
  errors: [
    { line: 6, message: "sale_amount is not an amount: 12.9O" },
    { line: 7, message: "order_date is not an ISO 8601 date: 09/11/2026" },
    { line: 8, message: "unknown advertiser: LP-nobody" },
    { line: 9, message: "transaction_id is missing" },
    { line: 10, message: "6 columns, 8 expected" },
    { line: 11, message: "LP-DUP appears twice in this file; the second occurrence is skipped" },
  ],
  createdAt: "2026-11-13T21:00:00.000Z",
  processedAt: "2026-11-13T21:00:02.000Z",
};

export const batchFailed: ImportBatchRow = {
  ...batchProcessed,
  id: "imp_2",
  network: "affinet",
  filename: "affinet-2026-11-14.json",
  status: "failed",
  rowCount: 0,
  newCount: 0,
  updatedCount: 0,
  matchedCount: 0,
  unmatchedCount: 0,
  errorCount: 1,
  errors: [{ line: 0, message: "the file is not a JSON document" }],
  createdAt: "2026-11-14T08:00:00.000Z",
  processedAt: null,
};

export const txUnmatched: TransactionRow = {
  id: "ntx_unmatched",
  batchId: batchProcessed.id,
  network: "linkpool",
  networkRef: "LP-90001",
  subId: null,
  orderRef: "ORD-77213",
  merchantId: offerVernet.merchantId,
  orderedAt: "2026-11-02T10:00:00.000Z",
  orderCents: 6450,
  commissionCents: 774,
  networkStatus: "pending",
  reportedAt: "2026-11-13T21:00:00.000Z",
  matchStatus: "unmatched",
  activationId: null,
  ignoreReason: null,
  merchant: offerVernet.merchant,
};

export const txMatched: TransactionRow = {
  ...txUnmatched,
  id: "ntx_matched",
  networkRef: "LP-90002",
  subId: activationVernet.subId,
  orderRef: "ORD-77300",
  orderCents: 12990,
  commissionCents: 1559,
  matchStatus: "matched",
  activationId: activationVernet.id,
};

export const txIgnored: TransactionRow = {
  ...txUnmatched,
  id: "ntx_ignored",
  networkRef: "LP-90003",
  orderRef: "ORD-77400",
  orderCents: 1200,
  commissionCents: 144,
  matchStatus: "ignored",
  ignoreReason: "below_minimum",
};

export const proposalMarie: ProposalRow = { ...activationVernet, offer: offerVernet, member: { id: marie.id, email: marie.email, displayName: marie.displayName } };
export const proposalLucas: ProposalRow = { ...activationVernet, id: "act_lucas", userId: lucas.id, subId: "p9q8r7s6t5u4v3w2", activatedAt: "2026-11-01T18:00:00.000Z", offer: offerVernet, member: lucas };

export const txUnmatchedDetail: TransactionDetailRow = {
  ...txUnmatched,
  activation: null,
  cashback: null,
  noMatchReason: "no_sub_id",
  candidates: [proposalMarie, proposalLucas],
};

export const txMatchedDetail: TransactionDetailRow = {
  ...txMatched,
  activation: proposalMarie,
  cashback: { ...cashbackPending, networkTransactionId: txMatched.id, orderCents: 12990, amountCents: 1169 },
  noMatchReason: null,
  candidates: [],
};

export const payoutRequested: PayoutWithMemberRow = {
  ...payoutSent,
  id: "pay_req",
  amountCents: 2500,
  status: "requested",
  checkedAt: null,
  sentAt: null,
  requestedAt: "2026-11-14T09:00:00.000Z",
  member: { id: marie.id, email: marie.email, displayName: marie.displayName },
};

export const payoutChecking: PayoutWithMemberRow = {
  ...payoutRequested,
  id: "pay_chk",
  userId: lucas.id,
  method: "gift_card",
  amountCents: 1500,
  destination: "Librairie Centrale",
  status: "checking",
  checkedAt: "2026-11-14T10:00:00.000Z",
  member: lucas,
};

export const overview: OverviewRow = {
  members: 306,
  liveOffers: 68,
  pendingCashbacks: { count: 412, cents: 418_730 },
  validatedCents: 1_942_115,
  validatedLast30DaysCents: 238_440,
  unmatchedTransactions: 37,
  openClaims: 14,
  payoutsWaiting: 9,
};

/** Three merchants; the totals are the sums of the lines, as the report computes them. */
export const margin: MarginReportRow = {
  from: "2026-10-16T00:00:00.000Z",
  to: "2026-11-15T00:00:00.000Z",
  lines: [
    { merchantId: "mer_vernet", merchantName: "Maison Vernet", transactions: 41, orderCents: 512_300, commissionCents: 61_476, cashbackCents: 30_738, marginCents: 30_738 },
    { merchantId: "mer_lune", merchantName: "Papeterie Lune", transactions: 18, orderCents: 72_900, commissionCents: 8_748, cashbackCents: 9_000, marginCents: -252 },
    { merchantId: "mer_rive", merchantName: "Banque Rive", transactions: 6, orderCents: 0, commissionCents: 18_000, cashbackCents: 12_000, marginCents: 6_000 },
  ],
  totals: { transactions: 65, orderCents: 585_200, commissionCents: 88_224, cashbackCents: 51_738, marginCents: 36_486 },
};

export const reconciliationOk: ReconciliationRow = {
  at: "2026-11-15T20:00:00.000Z",
  buckets: { pending: 418_730, available: 612_040, reserved: 21_500, paid: 1_305_075 },
  cashbacks: { pendingCents: 418_730, validatedCents: 1_942_115 },
  bonusCents: 24_500,
  checks: [
    { name: "pending bucket = pending cashbacks", expected: 418_730, actual: 418_730, ok: true },
    { name: "available + reserved + paid = validated + bonuses + credits", expected: 1_938_615, actual: 1_938_615, ok: true },
  ],
  cashbacksOutOfBalance: [],
  payoutsOutOfBalance: [],
  negativeBalances: [],
  ok: true,
};
