import type { CashbackDetailRow, CashbackRow, ClaimDetailRow, ClaimRow, OfferDetailRow, OfferRow, PayoutRow, ReferralsRow, UserRow, WalletRow } from "@/api/types";

/*
 * Rows shaped like the API's answers, with the seed's names. The amounts agree with each other the
 * way the ledger makes them agree: the wallet's buckets are the sums of its entries.
 */

export const marie: UserRow = { id: "usr_marie", email: "marie@example.com", displayName: "Marie Dubois", role: "member", referralCode: "marie7k", referredBy: null, createdAt: "2026-01-02T00:00:00.000Z" };

const vernet = { id: "mer_vernet", slug: "maison-vernet", name: "Maison Vernet", category: "fashion", country: "FR", attributionDays: 30, network: "linkpool" as const, advertiserRef: "LP-vernet" };
const lune = { id: "mer_lune", slug: "papeterie-lune", name: "Papeterie Lune", category: "home", country: "FR", attributionDays: 30, network: "affinet" as const, advertiserRef: "AF-lune" };

export const offerVernet: OfferRow = {
  id: "ofr_vernet",
  merchantId: vernet.id,
  kind: "online",
  title: "Maison Vernet: 6 % back on everything",
  description: "Cashback on every order, delivery excluded. The rate in force when you tap applies.",
  rateKind: "percent",
  rateBps: 600,
  fixedCents: 0,
  minSpendCents: 0,
  newCustomersOnly: false,
  capCents: null,
  validationDays: 60,
  status: "live",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  merchant: vernet,
};

export const offerLune: OfferRow = {
  ...offerVernet,
  id: "ofr_lune",
  merchantId: lune.id,
  title: "Papeterie Lune: 5,00 € back from 30 €",
  description: "A fixed amount on any order of thirty euros or more.",
  rateKind: "fixed",
  rateBps: 0,
  fixedCents: 500,
  minSpendCents: 3000,
  newCustomersOnly: true,
  capCents: 500,
  validationDays: 30,
  merchant: lune,
};

export const offerVernetDetail: OfferDetailRow = {
  ...offerVernet,
  boosts: [{ id: "bst_1", offerId: offerVernet.id, rateBps: 900, startsAt: "2026-11-10T00:00:00.000Z", endsAt: "2026-11-20T00:00:00.000Z", createdBy: "usr_nadia" }],
  rateInForce: { rateBps: 900, boosted: true },
};

export const activationVernet = {
  id: "act_1",
  userId: marie.id,
  offerId: offerVernet.id,
  subId: "k3f9a1b2c4d5e6f7",
  rateBps: 900,
  boosted: true,
  activatedAt: "2026-11-12T10:00:00.000Z",
  trackingUrl: "https://track.linkpool.example/go?adv=LP-vernet&sub=k3f9a1b2c4d5e6f7",
};

export const cashbackPending: CashbackRow = {
  id: "cb_pending",
  userId: marie.id,
  offerId: offerVernet.id,
  activationId: activationVernet.id,
  networkTransactionId: "ntx_1",
  orderCents: 12990,
  rateBps: 900,
  amountCents: 1169,
  marginClamped: false,
  status: "pending",
  decidedBy: null,
  decisionReason: null,
  expectedValidationAt: "2027-01-13T10:00:00.000Z",
  validatedAt: null,
  decidedAt: null,
  createdAt: "2026-11-14T10:00:00.000Z",
  offer: offerVernet,
};

export const cashbackValidated: CashbackRow = {
  ...cashbackPending,
  id: "cb_validated",
  offerId: offerLune.id,
  orderCents: 4200,
  rateBps: 0,
  amountCents: 500,
  status: "validated",
  decidedBy: "network",
  expectedValidationAt: "2026-10-01T10:00:00.000Z",
  validatedAt: "2026-10-02T10:00:00.000Z",
  decidedAt: "2026-10-02T10:00:00.000Z",
  createdAt: "2026-09-01T10:00:00.000Z",
  offer: offerLune,
};

export const cashbackRefused: CashbackRow = {
  ...cashbackPending,
  id: "cb_refused",
  orderCents: 8000,
  amountCents: 720,
  status: "refused",
  decidedBy: "network",
  decisionReason: "order returned",
  decidedAt: "2026-10-20T10:00:00.000Z",
  createdAt: "2026-09-20T10:00:00.000Z",
};

const entry = (id: string, kind: CashbackDetailRow["entries"][number]["kind"], bucket: CashbackDetailRow["entries"][number]["bucket"], amountCents: number, createdAt: string, refType = "cashback", refId = "cb_validated") => ({
  id,
  userId: marie.id,
  kind,
  bucket,
  amountCents,
  refType,
  refId,
  note: null,
  createdBy: null,
  createdAt,
});

export const cashbackValidatedDetail: CashbackDetailRow = {
  ...cashbackValidated,
  entries: [
    entry("led_1", "cashback_pending", "pending", 500, "2026-09-01T10:00:00.000Z"),
    entry("led_2", "cashback_validated", "pending", -500, "2026-10-02T10:00:00.000Z"),
    entry("led_3", "cashback_validated", "available", 500, "2026-10-02T10:00:00.000Z"),
  ],
};

/** 11,69 € pending; 5,00 € validated then 20,00 € reserved for a payout that was sent: the sums below. */
export const wallet: WalletRow = {
  userId: marie.id,
  balances: { pending: 1169, available: 16910, reserved: 0, paid: 2000 },
  ledger: {
    items: [
      entry("led_9", "cashback_pending", "pending", 1169, "2026-11-14T10:00:00.000Z", "cashback", "cb_pending"),
      entry("led_8", "payout_sent", "paid", 2000, "2026-11-01T10:00:00.000Z", "payout", "pay_1"),
      entry("led_7", "payout_sent", "reserved", -2000, "2026-11-01T10:00:00.000Z", "payout", "pay_1"),
      entry("led_6", "payout_reserved", "reserved", 2000, "2026-10-30T10:00:00.000Z", "payout", "pay_1"),
      entry("led_5", "payout_reserved", "available", -2000, "2026-10-30T10:00:00.000Z", "payout", "pay_1"),
      entry("led_4", "manual_credit", "available", 18410, "2026-10-10T10:00:00.000Z", "claim", "clm_old"),
      entry("led_3", "cashback_validated", "available", 500, "2026-10-02T10:00:00.000Z"),
      entry("led_2", "cashback_validated", "pending", -500, "2026-10-02T10:00:00.000Z"),
      entry("led_1", "cashback_pending", "pending", 500, "2026-09-01T10:00:00.000Z"),
    ],
    total: 9,
    page: 1,
    pageSize: 50,
  },
};

export const payoutSent: PayoutRow = {
  id: "pay_1",
  userId: marie.id,
  method: "transfer",
  amountCents: 2000,
  destination: "FR76 •••• 4421",
  status: "sent",
  requestedAt: "2026-10-30T10:00:00.000Z",
  checkedAt: "2026-10-31T10:00:00.000Z",
  sentAt: "2026-11-01T10:00:00.000Z",
  failedReason: null,
};

export const claimFiled: ClaimRow = {
  id: "clm_1",
  userId: marie.id,
  offerId: offerVernet.id,
  orderRef: "ORD-77213",
  orderedAt: "2026-11-02T10:00:00.000Z",
  orderCents: 6450,
  proofText: "Order ORD-77213 confirmed, total 64,50 €.",
  status: "filed",
  assigneeId: null,
  networkTransactionId: null,
  cashbackId: null,
  declineReason: null,
  filedAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  offer: offerVernet,
  member: { id: marie.id, email: marie.email, displayName: marie.displayName },
};

export const claimDeclined: ClaimDetailRow = {
  ...claimFiled,
  id: "clm_2",
  orderRef: "ORD-66001",
  status: "declined",
  declineReason: "order_returned",
  updatedAt: "2026-11-08T10:00:00.000Z",
};

export const referrals: ReferralsRow = {
  code: "marie7k",
  remaining: 18,
  referees: [
    { displayName: "Lucas Petit", status: "validated", createdAt: "2026-06-01T10:00:00.000Z", validatedAt: "2026-07-15T10:00:00.000Z", expiresAt: null },
    { displayName: "Inès Moreau", status: "pending", createdAt: "2026-10-20T10:00:00.000Z", validatedAt: null, expiresAt: "2027-01-18T10:00:00.000Z" },
  ],
  bonusCents: 2000,
};
