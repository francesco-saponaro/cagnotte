/*
 * The entities as the use cases see them. They mirror the rows in `packages/postgres` field for
 * field (that package checks the two stay assignable both ways), so an adapter passes rows through
 * without mapping, and the browser demo gets the same shapes from PGlite.
 */

export type UserRole = "member" | "agent" | "manager";
export type OfferKind = "online" | "voucher";
export type RateKind = "percent" | "fixed";
export type OfferStatus = "draft" | "live" | "paused" | "ended";
export type Network = "linkpool" | "affinet";
export type NetworkStatus = "pending" | "approved" | "declined";
export type MatchStatus = "unmatched" | "matched" | "ignored";
export type CashbackStatus = "pending" | "validated" | "refused" | "cancelled";
export type DecidedBy = "network" | "manager" | "claim";
export type ClaimStatus = "filed" | "acknowledged" | "raised" | "credited" | "declined";
export type PayoutMethod = "transfer" | "gift_card" | "donation";
export type PayoutStatus = "requested" | "checking" | "sent" | "failed";
export type ReferralStatus = "pending" | "validated" | "expired";
export type BatchStatus = "received" | "processed" | "failed";
export type LedgerBucket = "pending" | "available" | "reserved" | "paid";
export type LedgerKind =
  | "cashback_pending"
  | "cashback_validated"
  | "cashback_refused"
  | "cashback_adjusted"
  | "cashback_cancelled"
  | "manual_credit"
  | "referral_bonus"
  | "payout_reserved"
  | "payout_sent"
  | "payout_failed";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  referralCode: string;
  referredBy: string | null;
  createdAt: Date;
}

/** A user as the API returns it: never the password hash. */
export type PublicUser = Omit<User, "passwordHash">;

export interface Session {
  /** The SHA-256 of the token the client holds. */
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface Merchant {
  id: string;
  slug: string;
  name: string;
  category: string;
  country: string;
  attributionDays: number;
  network: Network;
  advertiserRef: string;
}

export interface Offer {
  id: string;
  merchantId: string;
  kind: OfferKind;
  title: string;
  description: string;
  rateKind: RateKind;
  rateBps: number;
  fixedCents: number;
  minSpendCents: number;
  newCustomersOnly: boolean;
  capCents: number | null;
  validationDays: number;
  status: OfferStatus;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferBoost {
  id: string;
  offerId: string;
  rateBps: number;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
}

export interface Activation {
  id: string;
  userId: string;
  offerId: string;
  subId: string;
  rateBps: number;
  boosted: boolean;
  activatedAt: Date;
  trackingUrl: string;
}

export interface ImportBatch {
  id: string;
  network: Network;
  filename: string;
  importedBy: string;
  status: BatchStatus;
  rowCount: number;
  newCount: number;
  updatedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  errorCount: number;
  errors: { line: number; message: string }[];
  createdAt: Date;
  processedAt: Date | null;
}

export interface NetworkTransaction {
  id: string;
  batchId: string;
  network: Network;
  networkRef: string;
  subId: string | null;
  orderRef: string;
  merchantId: string;
  orderedAt: Date;
  orderCents: number;
  commissionCents: number;
  networkStatus: NetworkStatus;
  reportedAt: Date;
  matchStatus: MatchStatus;
  activationId: string | null;
  ignoreReason: string | null;
}

export interface Cashback {
  id: string;
  userId: string;
  offerId: string;
  activationId: string | null;
  networkTransactionId: string | null;
  orderCents: number;
  rateBps: number;
  amountCents: number;
  marginClamped: boolean;
  status: CashbackStatus;
  decidedBy: DecidedBy | null;
  decisionReason: string | null;
  expectedValidationAt: Date;
  validatedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface Claim {
  id: string;
  userId: string;
  offerId: string;
  orderRef: string;
  orderedAt: Date;
  orderCents: number;
  proofText: string;
  status: ClaimStatus;
  assigneeId: string | null;
  networkTransactionId: string | null;
  cashbackId: string | null;
  declineReason: string | null;
  filedAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  kind: LedgerKind;
  bucket: LedgerBucket;
  amountCents: number;
  refType: string;
  refId: string;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface Payout {
  id: string;
  userId: string;
  method: PayoutMethod;
  amountCents: number;
  destination: string;
  status: PayoutStatus;
  requestedAt: Date;
  checkedAt: Date | null;
  sentAt: Date | null;
  failedReason: string | null;
}

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;
  code: string;
  status: ReferralStatus;
  createdAt: Date;
  expiresAt: Date | null;
  validatedAt: Date | null;
  bonusUntil: Date | null;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  at: Date;
}

/** Who is calling a use case: the signed-in user, reduced to what the rules need. */
export interface Actor {
  id: string;
  role: UserRole;
}

export const CLAIM_DECLINE_REASONS = ["no_activation_before_order", "foreign_promo_code", "outside_claim_window", "order_not_found_at_network", "order_returned"] as const;
export type ClaimDeclineReason = (typeof CLAIM_DECLINE_REASONS)[number];

export const PAYOUT_MINIMUM_CENTS: Record<PayoutMethod, number> = { transfer: 2000, gift_card: 1500, donation: 500 };
/** A transfer is requested in whole multiples of this. */
export const TRANSFER_STEP_CENTS = 500;
